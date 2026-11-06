import type { ReconcileLedger, ReconcileMail, ReconcileGit, ReconcileReview, ReconcileUnits, ReconcileLifecycle, ReconcileEffects } from "./ports.js";
// REC-001/002: operation counts, process observations and activation are distinct facts.
import { AsyncLocalStorage } from "node:async_hooks";
import type { Actor } from "@oma/contracts";
import { StoreError, classifyError, errorCodeOf } from "@oma/domain/errors";
import { assertNever } from "@oma/domain/exhaustive";
import type { RecoveryCounts, PreacceptCollection } from "@oma/contracts/runtime";
import { OperationRecovery, type RecoveryRow } from "./operations.js";
import { ReconcileLane } from "./lane.js";
import { preacceptEvent } from "./preaccept-event.js";

export interface ReconcilePaths {
  stateRoot: string; hasGoal: () => boolean; activationAllowed(): boolean;
  /** Ephemeral fresh provisioning observation, under this same society lease. */
  freshVerifiedMain?: string;
  /** Existing host receiptWaitSeconds; not a new configuration/wire field. */
  sweepBudgetSeconds?: number;
}
export interface UnitRecoveryDiagnostic { readonly agent: string; readonly outcome: "observed" | "started" | "stopped" | "unknown"; readonly reason: string | null }
const recoveryActivation = new AsyncLocalStorage<boolean>();
const sweepScope = new AsyncLocalStorage<ReconcileModule>();
export class ReconcileModule {
  private starting = false;
  private inFlight: Promise<RecoveryCounts> | null = null;
  private readonly operations: OperationRecovery;
  private readonly reviewLane: ReconcileLane;
  private readonly unitLanes = new Map<Actor, ReconcileLane>();
  private closed = false;
  private corrupt = false;
  private freshVerifiedMain: string | undefined;
  private diagnostics: readonly UnitRecoveryDiagnostic[] = [];
  private readonly waiting = new Map<Actor, { incarnation: number; specHash: string; messages: ReadonlySet<string> }>();
  private readonly resuming = new Map<Actor, { incarnation: number; specHash: string; invocationId: string; messages: ReadonlySet<string> }>();
  constructor(private readonly store: ReconcileLedger, private readonly mail: ReconcileMail, private readonly git: ReconcileGit | null,
    private readonly reviews: ReconcileReview | null,
    private readonly units: ReconcileUnits, private readonly lifecycle: ReconcileLifecycle, private readonly paths: ReconcilePaths, private readonly effects: ReconcileEffects) {
    if (typeof paths.activationAllowed !== "function")
      throw new StoreError("UNSUPPORTED_PROFILE", "recovery requires an explicit activation gate");
    this.reviewLane = new ReconcileLane(async () => { if (this.git !== null) await this.reviews?.advanceAll(); },
      error => this.retainRecoveryFailure(error));
    this.freshVerifiedMain = paths.freshVerifiedMain;
    this.operations = new OperationRecovery({ snapshot: () => store.recoverableOperations(), read: id => store.getOperationById(id),
      recover: operation => this.recover(operation, recoveryActivation.getStore() !== false), failure: error => this.retainRecoveryFailure(error),
      ...(paths.sweepBudgetSeconds === undefined ? {} : { budgetSeconds: paths.sweepBudgetSeconds }) });
  }
  get operationOutcomes() { return this.operations.lastOutcomes; }
  /** DR10: what the last startup collected of the artifacts made before an
   * acceptance that never happened, and what it kept and why. */
  get preacceptCollection(): PreacceptCollection | null { return this.collected; }
  private collected: PreacceptCollection | null = null;
  get unitDiagnostics(): readonly UnitRecoveryDiagnostic[] { return this.diagnostics; }
  /** Wait suppresses only the batch handed to this run and earlier waits
   * inherited by this exact automatic invocation. Unhanded mail stays runnable,
   * even if it arrived before wait or exceeded the current batch's capacity. */
  wait(actor: Actor, incarnation: number, handedMessages: readonly string[]): void {
    const agent = this.store.getAgent(actor);
    if (!agent || agent.role !== "resident" || agent.incarnation !== incarnation)
      throw new StoreError("STALE_RUN", "wait scheduling requires the current Resident incarnation");
    const previous = this.waiting.get(actor);
    if (previous?.incarnation === incarnation && previous.specHash === agent.specHash) return;
    const deferred = new Set([...(this.deferredWork(actor, incarnation) ?? []), ...handedMessages]);
    const pending = this.effects.pendingWork(actor);
    this.waiting.set(actor, { incarnation, specHash: agent.specHash,
      messages: new Set([...deferred].filter(message => pending.has(message))) });
  }
  /** Only an automatic fresh-work activation may defer the waited batch.
   * Explicit starts and a recovered broker retain ordinary oldest-first delivery. */
  deferredWork(actor: Actor, incarnation: number): ReadonlySet<string> | undefined {
    const resume = this.resuming.get(actor), agent = this.store.getAgent(actor);
    return resume?.incarnation === incarnation && agent?.incarnation === incarnation && resume.specHash === agent.specHash &&
      resume.invocationId === this.units.observe(actor).invocationId ? resume.messages : undefined;
  }
  private hasRunnableWork(agent: { name: Actor; incarnation: number; specHash: string }): boolean {
    const waiting = this.waiting.get(agent.name);
    if (waiting && (waiting.incarnation !== agent.incarnation || waiting.specHash !== agent.specHash)) this.waiting.delete(agent.name);
    const ignored = this.waiting.get(agent.name)?.messages;
    for (const message of this.effects.pendingWork(agent.name)) if (!ignored?.has(message)) return true;
    return false;
  }
  private activation(allowed = true): boolean { return !this.corrupt && !this.closed && allowed && recoveryActivation.getStore() !== false && this.paths.activationAllowed() === true && this.store.societyOpen(); }
  /** Every resident gets its stop attempt; one unconfirmed death does not skip the rest. */
  private async quiesceResidents(): Promise<void> {
    await this.effects.quiesceResidents();
  }
  /** D03: the drain of a broker whose Residents are bound to no unit. The
   * same per-resident stop and death proof as startup, so a later startup finds
   * nothing it has to stop. */
  async quiesceForShutdown(): Promise<void> {
    this.closed = true;
    // Physical owners receive cancellation through the broker lifetime before
    // this drain. A cancellation request is never treated as death proof.
    const joined = await Promise.allSettled([this.inFlight, this.reviewLane.close(), ...[...this.unitLanes.values()].map(lane => lane.close())]);
    const failures: unknown[] = [];
    for (const outcome of joined) if (outcome.status === "rejected") failures.push(outcome.reason);
    try { await this.quiesceResidents(); } catch (error) { failures.push(error); }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "recovery shutdown failed");
  }
  /** Fast triggers reach each resource owner even while recovery is blocked. */
  pulse(): void {
    if (this.closed || this.corrupt || this.starting) return;
    this.reviewLane.request();
    for (const agent of this.store.listAgents()) {
      if (agent.role !== "resident" || agent.desired === "retired") continue;
      let lane = this.unitLanes.get(agent.name);
      if (!lane) {
        lane = new ReconcileLane(() => this.observeUnit(agent.name), error => this.retainRecoveryFailure(error));
        this.unitLanes.set(agent.name, lane);
      }
      lane.request();
    }
  }
  async startup(allowActivation = true, prepare?: () => Promise<void>): Promise<void> {
    if (this.starting || this.inFlight) throw new StoreError("BROKER_UNAVAILABLE", "startup cannot share an active recovery pass");
    this.starting = true;
    try {
      await this.quiesceResidents();
      await this.effects.validateRecoveryArtifacts?.();
      // DR10: before any request is admitted, and before bootstrap freezes its
      // own briefs. The state root is the Store's (store.ts planContext).
      this.collected = this.effects.collectUnacceptedArtifacts();
      const preaccept = preacceptEvent(this.collected, this.paths.stateRoot);
      if (preaccept !== null) console.error(JSON.stringify(preaccept));
      if (this.git) {
        const fresh = this.freshVerifiedMain;
        this.freshVerifiedMain = undefined;
        const main = fresh === undefined ? null : this.effects.canonicalMain();
        if (main === null || main.kind !== "present" || main.value !== fresh)
          await this.effects.assertCanonicalHealthy();
        // An earlier death observation is not a token valid across fsck's await.
        await this.quiesceResidents();
      }
      await prepare?.();
      // Accepted plans already fence their resources. Physical recovery belongs
      // to the operation lane and need not finish before unrelated activation.
    } catch (error) { this.effects.observeStoreFailure(error); throw error; }
    finally { this.starting = false; }
    void recoveryActivation.run(allowActivation, () => this.sweepPass(allowActivation)).catch(error => this.effects.observeStoreFailure(error));
  }
  private async recover(operation: RecoveryRow, allowed: boolean): Promise<void> {
    switch (operation.kind) {
        case "society.set": await this.lifecycle.reconcileSociety(operation.id); return;
        case "attest.record": case "mail.send": case "agent.continue": await this.mail.reconcileOperation(operation.id); return;
        case "agent.create": await this.lifecycle.reconcileCreate(operation.id, this.activation(allowed)); return;
        case "agent.start": case "agent.stop": await this.lifecycle.reconcileAction(operation.id, this.activation(allowed)); return;
        case "git.submit": case "git.integrate": case "context.publish":
          if (!this.git) throw new StoreError("UNSUPPORTED_PROFILE", "Git recovery owner unavailable");
          await this.git.reconcile(operation.id); return;
        case "mail.ack": case "route.follow": case "route.unfollow":
          throw new StoreError("UNSUPPORTED_PROFILE", "operation has no safe physical recovery handler");
        default: assertNever(operation.kind);
    }
  }
  private retainRecoveryFailure(error: unknown): void {
    const code = errorCodeOf(error);
    const policy = classifyError({ code, phase: "recovering", effectKnowledge: "possible",
      observationKind: code === "STORE_CORRUPT" || code === "STREAM_INVALID" ? "corrupt" : "unavailable" });
    if (policy.blockScope === "store") {
      this.corrupt = true;
      // The closed code and the store block are the contract; the original
      // reason is preserved so startup diagnostics keep the observed fact.
      const failure = new StoreError(policy.code, error instanceof StoreError ? error.message : "recovery observation is corrupt");
      this.effects.observeStoreFailure(failure); throw failure;
    }
    // An internal failure keeps its observed reason in the Broker's own diagnostics.
    console.error(JSON.stringify({ event: "reconcile.operation", code: policy.code,
      ...(policy.code === "INTERNAL_ERROR" ? { detail: error instanceof Error ? error.stack ?? error.message : String(error) } : {}) }));
  }
  /** Deliberately not async: all concurrent callers receive the identical Promise. */
  sweep(): Promise<RecoveryCounts> {
    return this.sweepPass(true);
  }
  private sweepPass(observe: boolean): Promise<RecoveryCounts> {
    if (sweepScope.getStore() === this) return Promise.reject(new StoreError("INTERNAL_ERROR", "a handler cannot await its own recovery sweep"));
    if (this.starting) return Promise.reject(new StoreError("BROKER_UNAVAILABLE", "startup recovery is active"));
    if (this.closed) return Promise.reject(new StoreError("BROKER_UNAVAILABLE", "recovery owner is draining"));
    // Startup(false) recovers accepted effects but does not create unit lanes
    // under its temporary activation prohibition. A later ordinary pulse owns
    // its own activation context, even when it joins this operation pass.
    if (observe) this.pulse();
    if (this.inFlight) return this.inFlight;
    const work = Promise.resolve().then(() => sweepScope.run(this, async () => {
      try {
        const counts = await this.operations.sweep();
        if (observe) this.pulse();
        await Promise.all([this.reviewLane.join(), ...[...this.unitLanes.values()].map(lane => lane.join())]);
        return counts;
      } catch (error) { this.effects.observeStoreFailure(error); throw error; }
    }));
    const owned = work.finally(() => { if (this.inFlight === owned) this.inFlight = null; });
    this.inFlight = owned; return owned;
  }
  private async observeUnit(actor: Actor): Promise<void> {
    const diagnostics: UnitRecoveryDiagnostic[] = [];
    try {
      const agent = this.store.getAgent(actor);
      if (!agent || agent.role !== "resident" || agent.desired === "retired") return;
      // An unresolved lifecycle intent owns this incarnation, including the
      // interval before its physical action has started.
      if (this.store.recoverableOperations().some(id => {
        const op = this.store.getOperationById(id);
        return op?.kind === "agent.create" ? op.plan.spec.name === actor
          : op?.kind === "agent.start" || op?.kind === "agent.stop" ? op.plan.agent === actor : false;
      })) return;
        try {
          const observation = await this.units.observeAsync(agent.name);
          const current = this.store.getAgent(agent.name);
          if (!current || current.role !== "resident" || current.incarnation !== agent.incarnation || current.specHash !== agent.specHash) {
            diagnostics.push({ agent: agent.name, outcome: "unknown", reason: "identity_changed" }); return;
          }
          if (current.desired === "retired") {
            diagnostics.push({ agent: agent.name, outcome: "unknown", reason: "retired_during_observation" }); return;
          }
          if (current.desired === "stopped" || !this.store.societyOpen()) {
            // Do not trust an old async inactive observation as death proof.
            if (!this.units.confirmDead(current.name, current.incarnation)) {
              const latest = this.store.getAgent(current.name);
              if (!latest || latest.incarnation !== current.incarnation ||
                (latest.desired !== "stopped" && this.store.societyOpen())) return;
              await this.units.stop(current.name, current.incarnation);
              diagnostics.push({ agent: current.name, outcome: "stopped", reason: null });
            } else diagnostics.push({ agent: current.name, outcome: "observed", reason: null });
            return;
          }
          if (observation.activeState === "unknown") {
            diagnostics.push({ agent: current.name, outcome: "unknown", reason: "RUN_TERMINATION_UNKNOWN" }); return;
          }
          if (current.desired === "enabled" && this.activation() && this.paths.hasGoal()) {
            const restartDue = this.units.restartDue?.(current.name) === true;
            const canStart = (state: string): boolean =>
              ["inactive", "dead"].includes(state) && this.hasRunnableWork(current) || restartDue && state === "failed";
            if (canStart(observation.activeState)) {
              const fresh = this.units.observe(current.name);
              if (canStart(fresh.activeState)) {
                // Current desired/incarnation/activation check -> start has no await.
                const latest = this.store.getAgent(current.name);
                if (!latest || latest.incarnation !== current.incarnation || latest.specHash !== current.specHash ||
                  latest.desired !== "enabled" || !this.activation() || !this.paths.hasGoal()) return;
                const final = this.units.observe(current.name);
                if (!canStart(final.activeState)) return;
                if (!this.units.confirmDead(current.name, current.incarnation))
                  throw new StoreError("RUN_TERMINATION_UNKNOWN", "previous execution scope is not confirmed dead");
                const waiting = this.waiting.get(current.name);
                this.resuming.delete(current.name);
                try {
                  await this.units.start(current.name, false, () => {
                    const currentNow = this.store.getAgent(current.name);
                    if (!currentNow || currentNow.incarnation !== current.incarnation || currentNow.desired !== "enabled" ||
                        !this.activation() || !this.paths.hasGoal())
                      throw new StoreError("STALE_RUN", "reconcile activation changed before release");
                    const invocationId = this.units.observe(current.name).invocationId;
                    if (waiting?.incarnation === current.incarnation && invocationId)
                      this.resuming.set(current.name, { ...waiting, incarnation: current.incarnation + 1, invocationId });
                  });
                } catch (error) { this.resuming.delete(current.name); throw error; }
                diagnostics.push({ agent: current.name, outcome: "started", reason: null }); return;
              }
              if (fresh.activeState === "unknown") throw new StoreError("RUN_TERMINATION_UNKNOWN", "final unit observation is unknown");
            }
          }
          diagnostics.push({ agent: current.name, outcome: "observed", reason: null });
        } catch (error) {
          this.retainRecoveryFailure(error);
          const reason = errorCodeOf(error);
          diagnostics.push({ agent: agent.name, outcome: "unknown", reason });
          console.error(JSON.stringify({ event: "reconcile.unit", agent: agent.name, code: reason }));
        }
    } finally { this.diagnostics = Object.freeze([
      ...this.diagnostics.filter(value => value.agent !== actor), ...diagnostics.map(value => Object.freeze(value))]); }
  }
  startLimitState(): Array<{ agent: Actor; why: string }> {
    const result: Array<{ agent: Actor; why: string }> = [];
    for (const agent of this.store.listAgents()) {
      if (agent.role !== "resident") continue;
      const why = this.units.startLimitStatus(agent.name); if (why) result.push({ agent: agent.name, why });
    }
    return result;
  }
}
