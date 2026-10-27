/** TUI-004/REC-007/PR-002: one `oma`'s tenure over a society.
 *
 * The host used to keep its ownership in loose variables -- a lease here, the
 * engine there, a `brokerReady` flag, a `disowned` flag -- and the invariants
 * between them lived in the order of statements in the entrypoint. Every audit
 * of that arrangement found the same class of defect in a different place: a
 * release that ran before the thing it was releasing had stopped, a delivery
 * that ran before the registration that authorised it, a write that ran with
 * no ownership at all. Those are not four bugs. They are one structure in
 * which "may I do this" is answered by reading whichever flag the author of
 * that line happened to remember.
 *
 * So the flags are gone. A tenure is the single object that exists exactly as
 * long as this process owns the society, and every permission the ownership
 * confers is asked of it:
 *
 *  - Nothing this tenure pays for is started without the fence, so nothing it
 *    pays for can outlive the lease (`fence`).
 *  - Delivery is open only while a live broker of this host's has accepted
 *    this host's engine as the Principal (`deliverable`), and both facts are
 *    withdrawn by the events that make them untrue.
 *  - The society is written only where there is a tenure to write it
 *    (`assertOwned`), so a Control Panel over someone else's society cannot
 *    mutate it by reaching a port that forgot to ask.
 *  - It ends in one place, which closes the engine and waits for the operating
 *    system to say it is gone before giving the lease up.
 *  - What else it paid for -- the Principal's provider path -- it holds, and
 *    closes as it ends, before the lease is given up (`hold`).
 */
import { tryHoldSociety, type SocietyLease } from "./society-lease.js";
import { StoreError } from "@oma/domain/errors";

import type { FencedEngine } from "@oma/contracts/runtime";

/** Something other than the engine that a tenure paid for (P0V-114, G04-01):
 * the Principal's provider path, whose forwarder listens at a name in the
 * society's run directory. `close()` ends it; its name is gone when `close()`
 * returns, the rest may follow. */
export interface TenureHolding {
  close(): Promise<void>;
}

/** How long a polite teardown waits for the engine before giving up its own
 * hold on the lease. Giving up is safe at any time -- the engine's inherited
 * descriptor keeps the society held until it really exits -- so this bounds
 * how long quitting can take, not how long the invariant lasts. */
const ENGINE_EXIT_GRACE_MS = 5000;

export class HostTenure {
  /** Takes the society, or answers null when another `oma` -- or an engine or
   * broker outliving one -- still holds it. Throws when the lease could not be
   * evaluated at all, which is not the same answer and must not be read as
   * one.
   *
   * The society is named by the state tree it owns, not by the run directory
   * it is coordinated through: the tree is the thing that must not have two
   * writers, and a run directory is per-boot, per-session and replaceable. */
  static take(stateRoot: string, graceMs: number = ENGINE_EXIT_GRACE_MS): HostTenure | null {
    const lease = tryHoldSociety(stateRoot);
    return lease === null ? null : new HostTenure(lease, graceMs);
  }

  private engine: FencedEngine | null = null;
  private readonly holdings = new Set<TenureHolding>();
  private ending: Promise<void> | null = null;
  private over = false;
  private brokerLive = false;
  private generation = 0;
  private principalLive = false;

  private constructor(private readonly lease: SocietyLease, private readonly graceMs: number) {}

  /** The descriptor every process started on the strength of this tenure must
   * inherit. Reading it after the tenure is over is a bug in the caller: it
   * would be about to start something nothing is holding the society for. */
  get fence(): number {
    this.assertOwned("society lease");
    return this.lease.fence;
  }

  get held(): boolean { return !this.over; }

  /** The one check a mutating path makes. It throws rather than answering,
   * because a caller that gets `false` here has no correct thing left to do
   * with it, and the product shows the reason where the refusal happened. */
  assertOwned(what: string): void {
    if (this.over) throw new StoreError("BROKER_UNAVAILABLE", `This process does not own this society: ${what}`);
  }

  /** The engine this tenure runs. One at a time, and only while the tenure
   * holds: an engine adopted after the lease was given up would be a second
   * engine on a society this process no longer owns. */
  adopt(engine: FencedEngine): void {
    this.assertOwned("Principal engine");
    if (this.engine !== null) throw new StoreError("INTERNAL_ERROR", "a tenure runs one engine at a time");
    this.engine = engine;
    void engine.exited.then(() => {
      if (this.engine !== engine) return;
      this.engine = null;
      this.principalLive = false;
    });
  }

  /** Starting needs a live broker and the actual end of the previous engine,
   * not an RPC error, a timeout, or a stop request. */
  get canStartEngine(): boolean { return !this.over && this.brokerLive && this.engine === null; }

  /** The owned, private conversation can load while the broker prepares. Its
   * credential and delivery remain closed until brokerReady + registration. */
  get canPrepareEngine(): boolean { return !this.over && this.engine === null; }

  /** A failed setup still owns the terminal until the acquired child is gone. */
  get engineExited(): Promise<void> { return this.engine?.exited ?? Promise.resolve(); }

  /** P0V-114 (G04-01), P0-4: a resource opened because this process owns the
   * society is the tenure's from then on, and ends with it. One handed over
   * after the tenure is over has no owner and is closed at once; the answer
   * says whether the tenure took it. */
  async hold(holding: TenureHolding): Promise<boolean> {
    if (this.over) { await holding.close(); return false; }
    this.holdings.add(holding);
    return true;
  }

  /** What this tenure holds is closed before the lease is given up: a name in
   * the run directory removed after the society changed hands could be the
   * next owner's. Each close removes its name before it returns a promise. */
  private closeHoldings(): Promise<unknown> {
    const closing = [...this.holdings].map(holding => {
      try { return holding.close().catch(() => undefined); } catch { return Promise.resolve(); }
    });
    this.holdings.clear();
    return Promise.all(closing);
  }

  /** A broker of this host's is listening, so a registration may be attempted.
   * A readiness is always a fresh broker: whatever the previous one accepted
   * is not accepted by this one until it is registered again. */
  brokerReady(): void {
    this.generation += 1;
    this.brokerLive = true;
    this.principalLive = false;
  }

  /** A broker of this host's ended. Everything it authorised ends here. */
  brokerLost(): void {
    this.generation += 1;
    this.brokerLive = false;
    this.principalLive = false;
  }

  /** WP10.04: which broker readiness a registration was asked of. An answer
   * that arrives after another readiness or loss belongs to a broker that no
   * longer speaks for this host, and must change nothing. */
  get brokerGeneration(): number { return this.generation; }

  /** The live broker minted a credential for this host's engine and the engine
   * has it. Only this makes delivery possible. */
  principalRegistered(): void {
    if (!this.brokerLive || this.engine === null || this.over) return;
    this.principalLive = true;
  }

  /** The registration was refused, superseded, or never answered. */
  principalUnregistered(): void { this.principalLive = false; }

  /** PR-002: whether mail may be pushed into the engine right now.
   *
   * Every term is required and none of them is "the broker was ready once".
   * Delivery writes into an engine using authority a specific live broker
   * granted to that specific engine; if any of the three -- tenure, broker,
   * registration -- is not current, there is no authority to deliver under. */
  get deliverable(): boolean {
    return !this.over && this.brokerLive && this.principalLive && this.engine !== null;
  }

  /** Ends the tenure: the engine stops, and the lease is given up only after
   * the operating system says the engine is gone.
   *
   * The wait is bounded because quitting must finish, and bounding it is safe:
   * the engine inherited the lease's descriptor, so a release that runs before
   * a stubborn engine has died hands the society to nobody until it does. */
  end(): Promise<void> {
    // Every path that ends the tenure waits for the same end: a quit during a
    // disown must not exit while the engine it is waiting for still runs.
    if (this.ending !== null) return this.ending;
    if (this.over) return Promise.resolve();
    this.over = true;
    this.brokerLive = false;
    this.principalLive = false;
    const live = this.engine;
    this.engine = null;
    this.ending = (async () => {
      try {
        if (live !== null) {
          try { live.close(); } catch { /* the engine is ending either way */ }
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              live.exited,
              new Promise<void>(resolve => { timer = setTimeout(resolve, this.graceMs); timer.unref?.(); }),
            ]);
          } finally { clearTimeout(timer); }
        }
        await this.closeHoldings();
      } finally { this.lease.release(); }
    })();
    return this.ending;
  }

  /** Ends the tenure on a path that cannot wait: an unhandled exception, where
   * the next statement is `process.exit`. The engine is asked to stop and the
   * lease is dropped without waiting -- and the society still does not change
   * hands until the engine is actually gone, because the fence is the
   * kernel's. This is the whole reason the fence is not a call order. */
  abandon(): void {
    if (this.over) return;
    this.over = true;
    this.brokerLive = false;
    this.principalLive = false;
    const live = this.engine;
    this.engine = null;
    try { live?.close(); } catch { /* the engine is ending either way */ }
    void this.closeHoldings();
    this.lease.release();
  }
}
