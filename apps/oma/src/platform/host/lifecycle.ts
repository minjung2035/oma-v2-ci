import type { Socket } from "node:net";
/** The VM's life as the host sees it (macos-platform §5.1, MAC-301..331).
 *
 * One state machine owns every transition; UIs only ask for one. The VM
 * itself is behind `VmDriver` -- Virtualization.framework through the Swift
 * helper in production, the guest services on this machine in tests. Time and
 * timers are injected, so what is decided here (when a guest is hung, when a
 * stop is forced, when restarts give up) is tested without waiting.
 */
import type { FramedPeer } from "../rpc.js";
import { PlatformError } from "@oma/protocol/host-errors";
import type { GuestLink } from "./guest-link.js";
import type { VmDriver, VmStopCause } from "@oma/contracts/platform-lifecycle";
export type VmState = "stopped" | "booting" | "handshaking" | "ready" | "draining" | "forced" | "crashed" | "failed";

export interface LifecycleOptions {
  readonly driver: VmDriver<Socket>;
  readonly link: GuestLink;
  /** Monotonic milliseconds (MAC-650). */
  readonly now: () => number;
  /** The Mac's wall clock, which the guest is stepped to (§9.2). */
  readonly wallClock: () => number;
  readonly after: (ms: number, run: () => void) => { cancel(): void };
  readonly handshakeDeadlineMs: number;
  readonly handshakeRetryMs: number;
  /** MAC-320: the whole stop, from the first drain to the power going. */
  readonly drainDeadlineMs: number;
  /** MAC-330: how often health is asked, and how long without an answer is hung. */
  readonly healthEveryMs: number;
  readonly hungAfterMs: number;
  /** MAC-331: at most `max` automatic restarts within `windowMs`. */
  readonly restarts: { readonly max: number; readonly windowMs: number; readonly backoffMs: number };
  /** What the host keeps in its record (`host-record`), for the next start's one line. */
  readonly record: (event: "clean" | "forced" | "crashed" | "failed") => void;
  /** Mandatory persistence after the handshake, before ready is published.
   * A failure rejects startup and ends the VM; observers cannot replace it. */
  readonly ready?: () => void;
}

/** P0-4: continuations, peers and timers belong to one phase, never its successor. */
class VmPhase {
  private readonly controller = new AbortController();
  private readonly timers = new Set<{ cancel(): void }>();
  private readonly peers = new Set<FramedPeer>();
  control: FramedPeer | null = null;
  constructor(private readonly options: LifecycleOptions) {}
  get active(): boolean { return !this.controller.signal.aborted; }
  assertActive(): void { this.controller.signal.throwIfAborted(); }
  cancel(reason: unknown = unavailable("the engine phase ended")): void {
    if (!this.active) return;
    this.controller.abort(reason);
    for (const timer of this.timers) timer.cancel();
    this.timers.clear();
    for (const peer of this.peers) peer.close();
    this.peers.clear(); this.control = null;
  }
  after(ms: number, run: () => void): { cancel(): void } {
    this.assertActive();
    const timer = this.options.after(ms, () => {
      this.timers.delete(timer);
      if (this.active) run();
    });
    this.timers.add(timer);
    return { cancel: () => { timer.cancel(); this.timers.delete(timer); } };
  }
  observe<T>(work: Promise<T>): Promise<T> {
    const signal = this.controller.signal;
    return new Promise<T>((resolve, reject) => {
      const abort = (): void => { reject(signal.reason); };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      void work.then(value => { if (signal.aborted) reject(signal.reason); else resolve(value); }, reject)
        .finally(() => { signal.removeEventListener("abort", abort); });
    });
  }
  delay(ms: number): Promise<void> {
    return this.observe(new Promise<void>(resolve => { this.after(ms, resolve); }));
  }
  open(channel: "control" | "society"): Promise<FramedPeer> {
    this.assertActive();
    return this.observe(this.options.link.json(channel, this.controller.signal).then(peer => {
      if (!this.active) { peer.close(); this.assertActive(); }
      this.peers.add(peer);
      return peer;
    }));
  }
  close(peer: FramedPeer): void { this.peers.delete(peer); peer.close(); }
  request(peer: FramedPeer, method: string, params: Record<string, unknown>, key?: string): Promise<Record<string, unknown>> {
    this.assertActive();
    return this.observe(peer.request(method, params, key));
  }
}
function unavailable(message: string): PlatformError {
  return new PlatformError({ code: "ENGINE_UNAVAILABLE", message, retry: "same-key" });
}
interface VmRun {
  phase: VmPhase;
  readonly stopped: Promise<VmStopCause>;
  ended(cause: VmStopCause): void;
  cause: VmStopCause | null;
}

export class VmLifecycle {
  private current: VmState = "stopped";
  private readonly listeners: ((state: VmState) => void)[] = [];
  private run: VmRun | null = null;
  private restart: VmPhase | null = null;
  private restartTimes: number[] = [];
  private starting: Promise<void> | null = null;
  private launching: Promise<void> | null = null;
  private forcing: Promise<void> | null = null;
  private closing: Promise<"stopped" | "forced"> | null = null;

  constructor(private readonly options: LifecycleOptions) {
    options.driver.onStopped(cause => { this.stoppedByDriver(cause); });
  }

  get state(): VmState { return this.current; }
  onState(listener: (state: VmState) => void): void { this.listeners.push(listener); }
  private enter(state: VmState): void {
    if (this.current === state) return;
    this.current = state;
    // Optional observers describe a committed transition. Mandatory ready
    // persistence lives in options.ready and can reject boot before this.
    for (const listener of this.listeners) {
      try { listener(state); }
      catch (error) { try { console.error("VM state observer failed", error); } catch { /* best-effort observation */ } }
    }
  }

  /** The durable note of how a stop ended, where no caller can be told it
   * failed. `record` throwing here must neither escape a callback nor be
   * silent: the engine it could not describe is marked for repair (NB-23). */
  private report(event: "clean" | "forced" | "crashed" | "failed"): void {
    try { this.options.record(event); }
    catch { this.enter("failed"); }
  }

  /** Brings the VM to `ready`. Idempotent while starting or ready. */
  start(): Promise<void> {
    if (this.closing !== null) return Promise.reject(unavailable("the engine is stopping"));
    if (this.current === "ready") return Promise.resolve();
    if (this.starting !== null) return this.starting;
    if (this.current === "failed")
      return Promise.reject(new PlatformError({ code: "ENGINE_UNAVAILABLE", message: "the engine needs repair", retry: "after-repair" }));
    if (this.run !== null || this.launching !== null || this.forcing !== null)
      return Promise.reject(unavailable("the previous engine has not finished"));
    this.restart?.cancel(); this.restart = null;
    let ended!: (cause: VmStopCause) => void;
    const run: VmRun = { phase: new VmPhase(this.options), stopped: new Promise(resolve => { ended = resolve; }),
      ended: cause => ended(cause), cause: null };
    this.run = run;
    const phase = run.phase;
    const starting = Promise.resolve().then(() => this.boot(run, phase)).finally(() => {
      if (this.starting === starting) this.starting = null;
    });
    this.starting = starting;
    return starting;
  }

  private async boot(run: VmRun, phase: VmPhase): Promise<void> {
    phase.assertActive();
    this.enter("booting");
    let readinessFailed = false;
    try {
      const launching = Promise.resolve().then(() => { phase.assertActive(); return this.options.driver.start(); })
        .finally(() => { if (this.launching === launching) this.launching = null; });
      this.launching = launching;
      await phase.observe(launching);
      phase.assertActive();
      this.enter("handshaking");
      const deadline = phase.after(this.options.handshakeDeadlineMs,
        () => phase.cancel(unavailable("the engine did not answer after starting")));
      for (;;) {
        try { phase.control = await phase.open("control"); break; }
        catch (error) {
          phase.assertActive();
          if (error instanceof PlatformError && error.failure.code === "ENGINE_VERSION_SKEW") throw error;
          await phase.delay(this.options.handshakeRetryMs);
        }
      }
      // §9.2: the guest has no clock source of its own.
      await phase.request(phase.control, "time.set", { wallMs: this.options.wallClock() });
      phase.assertActive(); deadline.cancel();
      try { this.options.ready?.(); }
      catch (error) { readinessFailed = true; throw error; }
      phase.assertActive();
      this.enter("ready"); this.watch(run, phase);
    } catch (error) {
      if (this.run === run && run.phase === phase && this.closing === null) {
        phase.cancel();
        const incompatible = error instanceof PlatformError && error.failure.code === "ENGINE_VERSION_SKEW";
        const event = incompatible || readinessFailed ? "failed" : "crashed";
        this.enter(event);
        // NB-23: the record write can fail where only the caller sees it, but
        // it must never skip the force -- the VM's power comes first, then
        // both failures are told together.
        let recorded: unknown = null;
        try { this.options.record(event); }
        catch (recordError) { recorded = recordError; }
        try { await this.force(run); }
        catch (cleanup) {
          throw new AggregateError(recorded === null ? [error, cleanup] : [error, recorded, cleanup],
            "Engine startup and stop failed");
        }
        if (recorded !== null) throw new AggregateError([error, recorded], "Engine startup failed and its stop could not be recorded");
        throw error;
      }
      throw error;
    }
  }

  /** §9.1: after a wake the guest's wall clock is behind. A step that cannot
   * be made is not silence -- it is the same unknown a hang is (NB-26). */
  async woke(): Promise<void> {
    const run = this.run;
    if (this.current !== "ready" || run === null) return;
    const phase = run.phase;
    for (let attempt = 0; attempt < 3 && phase.active; attempt++) {
      try {
        if (phase.control === null || phase.control.isClosed) {
          if (phase.control !== null) phase.close(phase.control);
          phase.control = await phase.open("control");
        }
        await phase.request(phase.control, "time.set", { wallMs: this.options.wallClock() });
        return;
      } catch {
        if (!phase.active) return;
        try { await phase.delay(this.options.handshakeRetryMs); } catch { return; }
      }
    }
    if (!phase.active) return;
    // The clock-step invariant could not be made: this boot cannot stand.
    phase.cancel(); this.enter("crashed"); this.report("crashed");
    void this.force(run).catch(() => undefined);
  }

  private watch(run: VmRun, phase: VmPhase): void {
    phase.after(this.options.healthEveryMs, () => {
      const hung = phase.after(this.options.hungAfterMs, () => {
        // MAC-330 authorizes a forced stop; silence is not proof of death.
        phase.cancel(); this.enter("crashed"); this.report("crashed");
        void this.force(run).catch(() => undefined); // force retains a failed owner on error.
      });
      void this.healthy(phase).then(() => {
        hung.cancel(); if (phase.active) this.watch(run, phase);
      }, () => undefined);
    });
  }

  private async healthy(phase: VmPhase): Promise<void> {
    for (;;) {
      phase.assertActive();
      try {
        if (phase.control === null || phase.control.isClosed) {
          if (phase.control !== null) phase.close(phase.control);
          phase.control = await phase.open("control");
        }
        await phase.request(phase.control, "health.get", {});
        return;
      } catch { phase.assertActive(); await phase.delay(this.options.handshakeRetryMs); }
    }
  }

  /** MAC-320: one stop owner, with its budget beginning even during startup. */
  stop(): Promise<"stopped" | "forced"> {
    if (this.closing !== null) return this.closing;
    this.restart?.cancel(); this.restart = null;
    const run = this.run;
    // No new stop happened: do not turn an earlier forced/crashed fact into clean.
    if (run === null) return Promise.resolve("stopped");
    run.phase.cancel();
    const phase = run.phase = new VmPhase(this.options);
    const closing = Promise.resolve().then(() => this.drain(run, phase)).finally(() => {
      phase.cancel(); if (this.closing === closing) this.closing = null;
    });
    this.closing = closing;
    return closing;
  }

  private async drain(run: VmRun, phase: VmPhase): Promise<"stopped" | "forced"> {
    this.enter("draining");
    const deadline = phase.delay(this.options.drainDeadlineMs).then(() => null, error => {
      if (run.cause !== null) return run.cause;
      throw error;
    });
    // A failed drain is not success: wait for observed death or the stop policy.
    void this.drainGuest(phase).catch(() => undefined);
    const cause = await Promise.race([run.stopped, deadline]);
    phase.cancel();
    if (cause === null) {
      this.enter("forced");
      // NB-23: the power before the bookkeeping, and the bookkeeping's own
      // failure told to the stop's caller -- never an orphan VM.
      await this.force(run);
      try { this.options.record("forced"); } finally { this.enter("stopped"); }
    } else {
      try { this.options.record(cause === "guest" ? "clean" : "crashed"); }
      finally { this.enter("stopped"); }
    }
    return cause === null ? "forced" : "stopped";
  }

  private async drainGuest(phase: VmPhase): Promise<void> {
    const society = await phase.open("society");
    try {
      await phase.request(society, "maintenance.begin", {}, "power-off");
      const listed = await phase.request(society, "society.list", {}) as { societies: { society: string; running: boolean }[] };
      for (const entry of listed.societies)
        if (entry.running) await phase.request(society, "society.close", { society: entry.society, mode: "stop" });
    } finally { phase.close(society); }
    const control = await phase.open("control");
    await phase.request(control, "power.off", {});
  }

  private force(run: VmRun): Promise<void> {
    if (this.forcing !== null) return this.forcing;
    const forcing = Promise.resolve().then(async () => {
      if (run.cause === null) {
        await this.options.driver.forceStop();
        // A command reply alone is not the stopped observation -- but waiting
        // for it is bounded too: a helper that never reports is the engine
        // being unanswerable about death, which `failed` states (NB-29).
        const observation = { cancel: () => {} };
        try {
          await Promise.race([run.stopped, new Promise<never>((_, reject) => {
            const deadline = this.options.after(this.options.drainDeadlineMs, () =>
              reject(new PlatformError({ code: "ENGINE_UNAVAILABLE", message: "the engine's end could not be observed", retry: "same-key" })));
            observation.cancel = () => deadline.cancel();
          })]);
        } finally { observation.cancel(); }
      }
    }).catch(error => {
      if (this.run === run) { this.enter("failed"); this.report("failed"); }
      throw error;
    }).finally(() => { if (this.forcing === forcing) this.forcing = null; });
    this.forcing = forcing;
    return forcing;
  }

  private stoppedByDriver(cause: VmStopCause): void {
    const run = this.run;
    if (run === null) return;
    run.cause = cause; run.ended(cause); run.phase.cancel(); this.run = null;
    if (this.closing !== null || this.current === "failed") return;
    if (this.current !== "crashed") { this.enter("crashed"); this.report("crashed"); }
    this.afterCrash();
  }

  /** MAC-331: restart only after the previous driver operations have returned. */
  private afterCrash(): void {
    this.restart?.cancel();
    const phase = this.restart = new VmPhase(this.options);
    void phase.observe(Promise.allSettled([this.starting, this.launching, this.forcing])).then(() => {
      phase.assertActive();
      const now = this.options.now();
      this.restartTimes = this.restartTimes.filter(at => now - at < this.options.restarts.windowMs);
      if (this.restartTimes.length >= this.options.restarts.max) {
        phase.cancel(); this.enter("failed"); this.report("failed"); return;
      }
      this.restartTimes.push(now);
      const backoff = this.options.restarts.backoffMs * 2 ** (this.restartTimes.length - 1);
      phase.after(backoff, () => { void this.start().catch(() => undefined); });
    }).catch(() => undefined);
  }
}
