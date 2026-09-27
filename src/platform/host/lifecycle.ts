/** The VM's life as the host sees it (macos-platform §5.1, MAC-301..331).
 *
 * One state machine owns every transition; UIs only ask for one. The VM
 * itself is behind `VmDriver` -- Virtualization.framework through the Swift
 * helper in production, the guest services on this machine in tests. Time and
 * timers are injected, so what is decided here (when a guest is hung, when a
 * stop is forced, when restarts give up) is tested without waiting.
 */
import type { FramedPeer } from "../rpc.js";
import { PlatformError } from "../rpc.js";
import type { GuestLink, GuestPorts } from "./guest-link.js";

export interface VmDriver extends GuestPorts {
  /** Boots the VM; resolves once it is running (not yet answering). */
  start(): Promise<void>;
  /** Pulls the power: `VZVirtualMachine.stop()`. */
  forceStop(): Promise<void>;
  /** The VM stopped, whoever stopped it: the guest powered off, it crashed,
   * or `forceStop` pulled the power. */
  onStopped(listener: () => void): void;
}

export type VmState = "stopped" | "booting" | "handshaking" | "ready" | "draining" | "forced" | "crashed" | "failed";

export interface LifecycleOptions {
  readonly driver: VmDriver;
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
  readonly record: (event: "forced" | "crashed" | "failed") => void;
}

export class VmLifecycle {
  private current: VmState = "stopped";
  private readonly listeners: ((state: VmState) => void)[] = [];
  private control: FramedPeer | null = null;
  private watchdog: { cancel(): void } | null = null;
  private restartTimes: number[] = [];
  private stoppedWaiter: (() => void) | null = null;
  private starting: Promise<void> | null = null;

  constructor(private readonly options: LifecycleOptions) {
    options.driver.onStopped(() => { this.stoppedByDriver(); });
  }

  get state(): VmState { return this.current; }
  onState(listener: (state: VmState) => void): void { this.listeners.push(listener); }
  private enter(state: VmState): void {
    if (this.current === state) return;
    this.current = state;
    for (const listener of this.listeners) listener(state);
  }

  /** Brings the VM to `ready`. Idempotent while starting or ready. */
  start(): Promise<void> {
    if (this.current === "ready") return Promise.resolve();
    if (this.starting !== null) return this.starting;
    if (this.current === "failed")
      return Promise.reject(new PlatformError({ code: "ENGINE_UNAVAILABLE", message: "the engine needs repair", retry: "after-repair" }));
    this.starting = this.boot().finally(() => { this.starting = null; });
    return this.starting;
  }

  private async boot(): Promise<void> {
    this.enter("booting");
    // A VM that never started sends no stop, so its restart is decided here;
    // every other crash is decided where the driver reports the stop.
    try { await this.options.driver.start(); }
    catch (error) { this.enter("crashed"); this.options.record("crashed"); this.afterCrash(); throw error; }
    this.enter("handshaking");
    const deadline = this.options.now() + this.options.handshakeDeadlineMs;
    for (;;) {
      try { this.control = await this.options.link.json("control"); break; }
      catch (error) {
        // A guest of another image is not a slow guest: it is not retried.
        if (error instanceof PlatformError && error.failure.code === "ENGINE_VERSION_SKEW") {
          this.enter("failed"); this.options.record("failed");
          await this.options.driver.forceStop();
          throw error;
        }
        if (this.options.now() >= deadline) {
          this.enter("crashed"); this.options.record("crashed");
          await this.options.driver.forceStop();
          throw new PlatformError({ code: "ENGINE_UNAVAILABLE", message: "the engine did not answer after starting", retry: "same-key" });
        }
        await new Promise<void>(resolve => { this.options.after(this.options.handshakeRetryMs, resolve); });
      }
    }
    // §9.2: the guest has no clock source of its own.
    await this.control.request("time.set", { wallMs: this.options.wallClock() });
    this.enter("ready");
    this.watch();
  }

  /** §9.1: after a wake the guest's wall clock is behind; health says whether it lives. */
  async woke(): Promise<void> {
    if (this.current !== "ready" || this.control === null) return;
    await this.control.request("time.set", { wallMs: this.options.wallClock() });
  }

  /** MAC-330: an answer that is late is not a dead VM; no answer for
   * `hungAfterMs` is. Only then is the power pulled. */
  private watch(): void {
    this.watchdog = this.options.after(this.options.healthEveryMs, () => {
      this.watchdog = null;
      if (this.current !== "ready") return;
      // Only the silence of `hungAfterMs` judges. A refused answer or a lost
      // connection is asked again meanwhile; it is not proof of a dead VM.
      const hung = this.options.after(this.options.hungAfterMs, () => {
        if (this.current !== "ready") return;
        this.enter("crashed"); this.options.record("crashed");
        void this.options.driver.forceStop();
      });
      void this.healthy().then(() => { hung.cancel(); if (this.current === "ready") this.watch(); }, () => undefined);
    });
  }

  private async healthy(): Promise<void> {
    for (;;) {
      if (this.current !== "ready") throw new Error("no longer watched");
      try {
        if (this.control === null || this.control.isClosed) this.control = await this.options.link.json("control");
        await this.control.request("health.get", {});
        return;
      } catch {
        await new Promise<void>(resolve => { this.options.after(this.options.handshakeRetryMs, resolve); });
      }
    }
  }

  /** MAC-320: drain every society, then power off; past the deadline the
   * power is pulled and the stop is `forced`. */
  async stop(): Promise<"stopped" | "forced"> {
    if (this.current === "stopped" || this.current === "failed" || this.current === "crashed") return "stopped";
    if (this.starting !== null) await this.starting.catch(() => undefined);
    this.watchdog?.cancel(); this.watchdog = null;
    this.enter("draining");
    const stopped = new Promise<boolean>(resolve => { this.stoppedWaiter = () => { resolve(true); }; });
    const deadline = new Promise<boolean>(resolve => { this.options.after(this.options.drainDeadlineMs, () => { resolve(false); }); });
    const drain = async (): Promise<void> => {
      const society = await this.options.link.json("society");
      try {
        await society.request("maintenance.begin", {}, "power-off");
        const listed = await society.request("society.list", {}) as { societies: { society: string; running: boolean }[] };
        for (const entry of listed.societies)
          if (entry.running) await society.request("society.close", { society: entry.society, mode: "stop" });
      } finally { society.close(); }
      const control = this.control ?? await this.options.link.json("control");
      await control.request("power.off", {});
    };
    // A drain that fails still ends at the deadline; what it did is not
    // assumed, the guest's own recovery settles it on the next boot.
    void drain().catch(() => undefined);
    const clean = await Promise.race([stopped, deadline]);
    this.stoppedWaiter = null;
    if (!clean) {
      this.enter("forced"); this.options.record("forced");
      await this.options.driver.forceStop();
    }
    this.control?.close(); this.control = null;
    this.enter("stopped");
    return clean ? "stopped" : "forced";
  }

  private stoppedByDriver(): void {
    this.control?.close(); this.control = null;
    this.watchdog?.cancel(); this.watchdog = null;
    if (this.stoppedWaiter !== null) { this.stoppedWaiter(); return; }
    if (this.current === "draining" || this.current === "forced" || this.current === "stopped" || this.current === "failed") return;
    if (this.current !== "crashed") { this.enter("crashed"); this.options.record("crashed"); }
    this.afterCrash();
  }

  /** MAC-331: a crashed VM restarts with back-off, at most `max` times in
   * `windowMs`; after that it is `failed` and waits for the Human. */
  private afterCrash(): void {
    const now = this.options.now();
    this.restartTimes = this.restartTimes.filter(at => now - at < this.options.restarts.windowMs);
    if (this.restartTimes.length >= this.options.restarts.max) {
      this.enter("failed"); this.options.record("failed");
      return;
    }
    this.restartTimes.push(now);
    const backoff = this.options.restarts.backoffMs * 2 ** (this.restartTimes.length - 1);
    this.options.after(backoff, () => { if (this.current === "crashed") void this.start().catch(() => undefined); });
  }
}
