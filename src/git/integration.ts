/** INT-001..007: policy decisions own phase ordering; adapters own observations.
 * execute is never called by recovery. The surrounding GitModule serializes both.
 */
import type { AuthContext, Receipt, Oid } from "../../implementation/contracts.js";
import { Store, reused } from "../store.js";
import type { OperationOf } from "../storage/operation-codec.js";
import { assertCurrentActor, capabilitiesOf } from "../authority.js";
import { StoreError, ERROR_METADATA, classifyError, type EffectKnowledge, type ErrorPhase } from "../domain/errors.js";
import { requestHash } from "../hash.js";
import { generateOperationId } from "../ids.js";
import { receiptOfOperation } from "../storage/receipt-projector.js";
import { integrationResult } from "../protocol/operation-results.js";
import { protectedPathMatches, type ChangedPath, type GitObservation, type RefAfterCas } from "./observe.js";
import {
  assertSameIntegrationPolicy, assertSupportedIntegration, snapshotIntegrationPolicy,
  type IntegrationPolicy, type IntegrationPolicyReader, type IntegrationSnapshot, type FrozenCheck,
} from "./integration-policy.js";

export interface IntegrationEffects {
  verifyObjectFormat(oids: readonly Oid[]): void;
  main(): GitObservation<Oid>;
  published(): GitObservation<readonly Oid[]>;
  ancestry(base: Oid, candidate: Oid): GitObservation<boolean>;
  changedPaths(base: Oid, candidate: Oid): GitObservation<readonly ChangedPath[]>;
  compareAndSwap(base: Oid, candidate: Oid): RefAfterCas;
  runCheck(candidate: Oid, check: FrozenCheck): Promise<void>;
}
function observed<T>(observation: GitObservation<T>, description: string): T {
  if (observation.kind === "present") return observation.value;
  throw new StoreError(observation.kind === "corrupt" ? "STORE_CORRUPT" : "REF_STATE_UNKNOWN", `${description} is ${observation.kind}`);
}

export class IntegrationCoordinator {
  private readonly bound: IntegrationSnapshot | null;
  constructor(
    private readonly store: Store,
    private readonly effects: IntegrationEffects,
    policy: IntegrationPolicy | null,
    private readonly policyReader: IntegrationPolicyReader | null = null,
  ) {
    this.bound = policy === null ? null : snapshotIntegrationPolicy(policy);
  }

  private policy(): IntegrationSnapshot {
    if (this.bound === null) throw new StoreError("UNSUPPORTED_PROFILE", "integration requires an explicit host policy");
    return this.bound;
  }
  private verifyCurrentPolicy(snapshot: IntegrationSnapshot): void {
    if (this.store.inTransaction) throw new StoreError("INTERNAL_ERROR", "policy I/O cannot run inside acceptance");
    if (this.policyReader === null) return;
    try {
      const current = this.policyReader();
      if (typeof current === "string") {
        if (!current || current !== snapshot.policyRevision) throw new StoreError("POLICY_CHANGED", "integration policy revision changed");
      } else assertSameIntegrationPolicy(snapshot, snapshotIntegrationPolicy(current));
    } catch (error) {
      if (error instanceof StoreError && error.code === "POLICY_CHANGED") throw error;
      throw new StoreError("POLICY_CHANGED", "authoritative integration policy is unreadable or invalid");
    }
  }
  private operation(id: string): OperationOf<"git.integrate"> {
    const operation = this.store.getOperationById(id);
    if (!operation || operation.kind !== "git.integrate") throw new StoreError("STORE_CORRUPT", "accepted integration is missing or has another kind");
    return operation;
  }
  private receipt(id: string): Receipt { return receiptOfOperation(this.operation(id)); }
  private succeed(operation: OperationOf<"git.integrate">): void {
    const resultJson = JSON.stringify(integrationResult(operation.plan));
    this.store.transaction(tx => tx.setOperationSucceeded(operation.id, resultJson));
  }
  private unknown(id: string): void { this.store.transaction(tx => tx.setOperationUnknown(id)); }
  private requireWriterSlot(exceptId?: string): void {
    for (const id of this.store.recoverableOperations()) {
      if (id === exceptId) continue;
      const operation = this.store.getOperationById(id);
      if (!operation) throw new StoreError("STORE_CORRUPT", "recoverable operation disappeared");
      if (operation.kind === "git.integrate")
        throw new StoreError("REF_STATE_UNKNOWN", "an unresolved project integration blocks another main writer");
    }
  }
  private requireExecuteAuthority(auth: AuthContext, accepted: boolean): void {
    if (accepted) {
      const actor = this.store.getAgent(auth.actor);
      if (actor?.desired === "stopped" || actor?.desired === "retired")
        throw new StoreError("CANCELLED_BEFORE_COMMIT", "stop or retire intent was accepted before main CAS");
    }
    assertCurrentActor(this.store, auth, "code.integrate");
  }
  private requireRecoveryAuthority(actorName: string): void {
    const actor = this.store.getAgent(actorName);
    if (actor?.desired === "stopped" || actor?.desired === "retired")
      throw new StoreError("CANCELLED_BEFORE_COMMIT", "stopped or retired actor cannot advance main during recovery");
    if (!actor || actor.desired !== "enabled" || !capabilitiesOf(actor).has("code.integrate"))
      throw new StoreError("CAPABILITY_DENIED", "current durable integration authority is unavailable");
    // A restart reconciles accepted intent without fabricating a live lease.
  }
  private requireEligible(snapshot: IntegrationSnapshot, base: Oid, candidate: Oid): void {
    if (!observed(this.effects.published(), "published refs").includes(candidate))
      throw new StoreError("CANDIDATE_NOT_PUBLISHED", "candidate is not published");
    if (!observed(this.effects.ancestry(base, candidate), "candidate ancestry"))
      throw new StoreError("NOT_DESCENDANT", "candidate is not a descendant of the accepted base");
    const changes = observed(this.effects.changedPaths(base, candidate), "changed paths");
    for (const change of changes) {
      if (snapshot.protectedPaths.some(path => protectedPathMatches(change.path, path)))
        throw new StoreError("PROTECTED_PATH", "candidate touches a protected path");
    }
  }
  private stillAtBase(operation: OperationOf<"git.integrate">): boolean {
    const main = this.effects.main();
    if (main.kind === "corrupt") throw new StoreError("STORE_CORRUPT", "canonical main observation is malformed");
    if (main.kind === "present" && main.value === operation.plan.base) return true;
    this.unknown(operation.id);
    return false;
  }
  private rejectAccepted(id: string, error: unknown, phase: ErrorPhase, knowledge: EffectKnowledge): never {
    const code = error instanceof StoreError ? error.code : "INTERNAL_ERROR";
    const category = ERROR_METADATA[code].category;
    const policy = classifyError({ code, phase, effectKnowledge: knowledge,
      observationKind: category === "integrity" ? "corrupt" :
        category === "transient" || category === "ambiguous" || category === "internal" ? "unavailable" : "rejected" });
    if (policy.terminal === "failed") this.store.transaction(tx => tx.setOperationFailed(id, policy.code));
    else if (policy.terminal === "unknown") this.unknown(id);
    throw new StoreError(policy.code, error instanceof StoreError ? error.message : "integration observation or settlement failed");
  }

  async execute(auth: AuthContext, key: string, input: { candidate: Oid; expected: Oid }): Promise<Receipt> {
    this.requireExecuteAuthority(auth, false);
    const hash = requestHash("git.integrate", input);
    const claim = this.store.claimKey(auth.actor, key, hash);
    if (claim === "retry") return receiptOfOperation(this.store.getOperation(auth.actor, key)!);
    if (claim === "reused") throw reused(auth.actor, key);
    const policy = this.policy();
    assertSupportedIntegration(policy);
    this.requireWriterSlot();
    this.effects.verifyObjectFormat([input.candidate, input.expected]);
    if (!observed(this.effects.published(), "admission published refs").includes(input.candidate))
      throw new StoreError("CANDIDATE_NOT_PUBLISHED", "candidate is not published");
    if (observed(this.effects.main(), "admission main") !== input.expected)
      throw new StoreError("STALE_BASE", "main differs from expected");
    const id = generateOperationId();
    const plan = {
      kind: "git.integrate" as const, repo: "project" as const, target: "refs/heads/main" as const,
      base: input.expected, candidate: input.candidate, policyRevision: policy.policyRevision,
      checkProfileDigest: policy.checkProfileDigest,
    };
    const accepted = this.store.transaction(tx => {
      this.requireExecuteAuthority(auth, false);
      const current = this.store.claimKey(auth.actor, key, hash);
      if (current === "retry") return "retry" as const;
      if (current === "reused") throw reused(auth.actor, key);
      this.requireWriterSlot();
      return tx.acceptOperation({ id, actor: auth.actor, requestKey: key, requestHash: hash,
        kind: "git.integrate", payloadJson: JSON.stringify(input), planJson: JSON.stringify(plan) });
    });
    if (accepted === "retry") return receiptOfOperation(this.store.getOperation(auth.actor, key)!);
    const operation = this.operation(id);
    let knowledge: EffectKnowledge = "none";
    try {
      if (!this.stillAtBase(operation)) return this.receipt(id);
      this.requireEligible(policy, plan.base, plan.candidate);
      for (const check of policy.checks) await this.effects.runCheck(plan.candidate, check);
      if (!this.stillAtBase(operation)) return this.receipt(id);
      this.requireEligible(policy, plan.base, plan.candidate);
      this.verifyCurrentPolicy(policy);
      this.requireExecuteAuthority(auth, true);
      this.requireWriterSlot(id);
      // No-op integrations also retain the current authority/stop/policy checks.
      if (plan.base !== plan.candidate) {
        knowledge = "possible";
        const after = this.effects.compareAndSwap(plan.base, plan.candidate);
        if (after.kind !== "candidate") { this.unknown(id); return this.receipt(id); }
      }
      knowledge = "applied";
      this.succeed(operation);
      return this.receipt(id);
    } catch (error) { return this.rejectAccepted(id, error, "accepted", knowledge); }
  }

  async reconcile(operation: OperationOf<"git.integrate">): Promise<void> {
    if (operation.state !== "pending" && operation.state !== "unknown") return;
    const plan = operation.plan;
    let knowledge: EffectKnowledge = "possible";
    try {
      const main = this.effects.main();
      if (main.kind === "corrupt") throw new StoreError("STORE_CORRUPT", "canonical main observation is malformed");
      if (main.kind === "present" && main.value === plan.candidate) {
        knowledge = "applied";
        this.succeed(operation);
        return;
      }
      if (main.kind !== "present" || main.value !== plan.base) { this.unknown(operation.id); return; }
      knowledge = "none";
      this.requireWriterSlot(operation.id);
      const policy = this.policy();
      if (policy.policyRevision !== plan.policyRevision || policy.checkProfileDigest !== plan.checkProfileDigest)
        throw new StoreError("POLICY_CHANGED", "accepted integration policy no longer matches the configured profile");
      assertSupportedIntegration(policy);
      this.verifyCurrentPolicy(policy);
      this.requireRecoveryAuthority(operation.actor);
      this.effects.verifyObjectFormat([plan.base, plan.candidate]);
      this.requireEligible(policy, plan.base, plan.candidate);
      for (const check of policy.checks) await this.effects.runCheck(plan.candidate, check);
      if (!this.stillAtBase(operation)) return;
      this.requireEligible(policy, plan.base, plan.candidate);
      this.verifyCurrentPolicy(policy);
      this.requireRecoveryAuthority(operation.actor);
      this.requireWriterSlot(operation.id);
      knowledge = "possible";
      const after = this.effects.compareAndSwap(plan.base, plan.candidate);
      if (after.kind !== "candidate") { this.unknown(operation.id); return; }
      knowledge = "applied";
      this.succeed(operation);
    } catch (error) { this.rejectAccepted(operation.id, error, "recovering", knowledge); }
  }
}
