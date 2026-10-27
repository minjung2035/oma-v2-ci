/** WP23/D04: unit status for display is diagnostic observation, collected
 * off the event loop and never used as authority.
 *
 * One refresh runs at a time. A caller asking while one runs gets the single
 * follow-up that starts when it ends, shared with everyone else who asked
 * meanwhile, so the answer never predates the question and the work in hand is
 * at most one refresh plus one follow-up however many callers there are. A
 * caller waits at most `budgetMs`: past that it gets an unknown snapshot
 * carrying the time it asked, while a slow observation keeps its place (a
 * command the manager does not answer is not started again beside itself).
 *
 * Nothing here decides an effect. Peer authentication, run admission,
 * confirmDead and lifecycle actions observe the unit again, synchronously, at
 * the moment they act (WP23.04).
 */
import type { Actor, ExecutionObservation } from "@oma/contracts";

import type { StatusSnapshot } from "@oma/contracts/runtime";
export type StatusObserver = (agents: readonly Actor[]) => Promise<ReadonlyMap<Actor, ExecutionObservation | "no-unit">>;

/** Status answers for up to 256 listed agents fit well inside this; beyond it
 * a caller is told unknown rather than kept waiting. */
export const STATUS_OBSERVATION_BUDGET_MS = 2_000;

export class StatusRefresh {
  private running: Promise<StatusSnapshot> | null = null;
  private following: Promise<StatusSnapshot> | null = null;
  constructor(
    private readonly agents: () => readonly Actor[],
    private readonly observe: StatusObserver,
    private readonly budgetMs: number = STATUS_OBSERVATION_BUDGET_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** A snapshot that starts no earlier than this call, within the budget. */
  request(): Promise<StatusSnapshot> {
    const askedAtMs = this.now();
    // P0V-53, P0-2: a follow-up already scheduled is the one refresh for
    // everyone who asks until it starts. Between the end of a run (which
    // clears `running`) and the follow-up's start there is a moment when
    // nothing runs; a caller arriving then shares the follow-up rather than
    // starting a second observation beside it.
    const refresh = this.following ?? (this.running === null ? this.start() : (this.following = this.running.then(() => {
      this.following = null;
      return this.start();
    })));
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(Object.freeze({ observedAtMs: askedAtMs, units: new Map(), failure: "timeout" })), this.budgetMs);
      void refresh.then(snapshot => { clearTimeout(timer); resolve(snapshot); });
    });
  }

  private start(): Promise<StatusSnapshot> {
    const observedAtMs = this.now();
    const run: Promise<StatusSnapshot> = (async () => {
      try {
        const units = await this.observe(this.agents());
        return Object.freeze({ observedAtMs, units, failure: null });
      } catch {
        return Object.freeze({ observedAtMs, units: new Map<Actor, ExecutionObservation>(), failure: "unavailable" as const });
      }
    })().finally(() => { if (this.running === run) this.running = null; });
    this.running = run;
    return run;
  }
}
