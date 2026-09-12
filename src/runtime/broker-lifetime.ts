import { StoreError } from "../domain/errors.js";
import { NODE_ALARMS } from "../broker/connection.js";
import { preparationShutdownBarrier } from "../process/preparation.js";

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

export class BrokerLifetime {
  private current: LifetimePhase = "acquired";
  private stopping = false;
  private runtime: LifetimeRuntime | null = null;
  private fallbackClose: (() => void) | null = null;
  private starting: Promise<void> | null = null;
  private closing: Promise<void> | null = null;
  constructor(private readonly lock: LifetimeLock, private readonly graceSeconds: () => number) {}
  get phase(): LifetimePhase { return this.current; }
  get permitsActivation(): boolean { return !this.stopping && this.current === "ready"; }
  retainStore(close: () => void): void { this.fallbackClose = close; }
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
    this.closing = (async () => {
      if (this.starting) await settleWithin([this.starting], this.graceSeconds());
      if (this.runtime) await this.runtime.drainAndClose();
      else {
        await settleWithin([], this.graceSeconds());
        this.fallbackClose?.();
      }
      this.lock.close(); this.current = "closed";
    })();
    return this.closing;
  }
}
