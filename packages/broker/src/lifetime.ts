import { StoreError } from "@oma/domain/errors";
import { NODE_ALARMS } from "./connection.js";
import { preparationShutdownBarrier } from "@oma/process/preparation";

export interface LifetimeLock { close(): void }
export interface LifetimeRuntime { closeAdmission(): void; drainAndClose(): Promise<void> }
export interface StartupSteps {
  recover(): Promise<void>;
  listen(): Promise<void>;
  notify(): void;
  activate(): Promise<void>;
}
export type LifetimePhase = "acquired" | "recovering" | "listening" | "ready" | "draining" | "closed";

/** A dispatched request may finish with an unknown native outcome. That does
 * not permit Store/lock release. Both logical tasks and native preparation must
 * settle within the existing grace, otherwise process termination is required.
 */
export async function settleWithin(tasks: Iterable<Promise<unknown>>, seconds: number): Promise<void> {
  let expired = false;
  let alarm: ReturnType<typeof NODE_ALARMS.after> | undefined;
  const timeout = new Promise<void>(resolve => {
    alarm = NODE_ALARMS.after(seconds, () => { expired = true; resolve(); });
  });
  try {
    const completed = Promise.allSettled([...tasks]).then(() => preparationShutdownBarrier());
    await Promise.race([completed, timeout]);
    if (expired) throw new StoreError("DEADLINE_EXCEEDED", "durable shutdown handoff exceeded its grace period; writer resources remain held");
  } finally { alarm?.cancel(); }
}

/** AV31 -- D03, LIFE-006: every way this broker's host can go away ends it
 * through its drain, which revokes every run and stops the Residents. Asked to
 * stop (SIGTERM), interrupted (SIGINT), or its terminal hung up (SIGHUP: the
 * product's `oma` was the session leader and exited, or its window closed). An
 * unhandled SIGHUP killed a draining broker outright and left Residents
 * running with no broker, until systemd's start limit stopped them.
 *
 * P0V-81, R6-07: the list is the termination signals a process can catch
 * (glibc's "Termination Signals"; SIGKILL is the one it cannot), and it is the
 * list for every process of this product that has a drain -- the `oma` TUI's
 * shutdown and terminal restore, the Mac's attach client, a Resident's runner,
 * the Mac service, a guest's session holder. SIGQUIT was missing: its default
 * action ends a process with none of that, as SIGHUP's did. */


export class BrokerLifetime {
  private current: LifetimePhase = "acquired";
  private stopping = false;
  private runtime: LifetimeRuntime | null = null;
  private fallbackClose: (() => void) | null = null;
  private nativeClose: (() => Promise<void>) | null = null;
  private starting: Promise<void> | null = null;
  private closing: Promise<void> | null = null;
  constructor(private readonly lock: LifetimeLock, private readonly graceSeconds: () => number) {}
  get phase(): LifetimePhase { return this.current; }
  get permitsActivation(): boolean { return !this.stopping && this.current === "ready"; }
  retainStore(close: () => void): void { this.fallbackClose = close; }
  retainNative(close: () => Promise<void>): void {
    if (this.nativeClose !== null || this.stopping) throw new StoreError("BROKER_UNAVAILABLE", "native execution owner is already retained or draining");
    this.nativeClose = close;
  }
  attach(runtime: LifetimeRuntime): void {
    if (this.runtime || this.stopping) throw new StoreError("INTERNAL_ERROR", "broker runtime lifetime already attached or draining");
    this.runtime = runtime;
  }
  start(steps: StartupSteps): Promise<void> {
    if (this.starting || this.stopping) return Promise.reject(new StoreError("BROKER_UNAVAILABLE", "broker lifetime cannot start twice"));
    const assertStarting = () => {
      if (this.stopping) throw new StoreError("BROKER_UNAVAILABLE", "startup was interrupted by shutdown");
    };
    this.starting = (async () => {
      assertStarting(); this.current = "recovering"; await steps.recover();
      assertStarting(); this.current = "listening"; await steps.listen();
      assertStarting(); steps.notify(); this.current = "ready";
      assertStarting(); await steps.activate();
    })();
    return this.starting;
  }
  shutdown(): Promise<void> {
    if (this.closing) return this.closing;
    this.stopping = true; this.current = "draining";
    this.runtime?.closeAdmission();
    const native = this.nativeClose === null ? undefined : Promise.resolve().then(this.nativeClose);
    if (native !== undefined) void native.catch(() => {});
    this.closing = (async () => {
      if (this.starting || native) await settleWithin([...(this.starting ? [this.starting] : []), ...(native ? [native] : [])], this.graceSeconds());
      // Startup failure can be drained, but an unconfirmed native owner cannot
      // release writer resources merely because its close promise settled.
      await native;
      if (this.runtime) await this.runtime.drainAndClose();
      else if (this.fallbackClose) {
        await settleWithin([], this.graceSeconds());
        this.fallbackClose();
      }
      // Before configuration/Store acquisition there is no native preparation
      // and no loaded grace policy to query; release only the acquired lock.
      this.lock.close(); this.current = "closed";
    })();
    return this.closing;
  }
}
