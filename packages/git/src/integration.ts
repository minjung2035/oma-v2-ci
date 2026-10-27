import { encodeOperationPlan } from "@oma/protocol/operation-codec";
/** INT-001..007: policy decisions own phase ordering; adapters own observations.
 * execute is never called by recovery. The surrounding GitModule serializes both.
 */
import type { RiskTier } from "@oma/contracts/values";
import type { ReviewAuthority } from "./ports.js";

import { IntegrationPublicationObserver } from "./integration-publication.js";

import type { AuthContext, OperationId, Receipt, Oid } from "@oma/contracts";
import type { GitLedger, GitMessaging } from "./ports.js";
import { reused } from "@oma/domain/request-identity";
import type { OperationOf } from "@oma/protocol/operation-codec";
import type { PlanFor } from "@oma/domain/durable";
import { assertCurrentActor, capabilitiesOf } from "@oma/domain/authority";
import { StoreError, AcceptedFailure, type EffectKnowledge, type ErrorPhase, acceptedFailurePolicy, failureMessage } from "@oma/domain/errors";
import { requestHash } from "@oma/domain/request-identity";
import { generateOperationId } from "@oma/native/identity";
import { receiptOfOperation } from "@oma/protocol/receipt-projector";
import { integrationResult } from "@oma/protocol/operation-results";
import { protectedPathMatches, requireNoGitlinks } from "@oma/domain/git-facts";
import { type ChangedPath, type GitObservation } from "@oma/contracts/git";
import { type RefAfterCas } from "./observe.js";
import {
  assertSameIntegrationPolicy, assertSupportedIntegration, snapshotIntegrationPolicy,
  type IntegrationPolicy, type IntegrationPolicyReader, type IntegrationSnapshot, type FrozenCheck,
} from "@oma/domain/integration-policy";

export interface IntegrationEffects {
  verifyObjectFormat(oids: readonly Oid[]): void;
  main(): GitObservation<Oid>;
  published(): GitObservation<readonly Oid[]>;
  ancestry(base: Oid, candidate: Oid): GitObservation<boolean>;
  changedPaths(base: Oid, candidate: Oid): GitObservation<readonly ChangedPath[]>;
  /** UX-09/INT-001: the candidate tree's submodule gitlinks, observed whole —
   * a gitlink inherited from base is no less a refusal than one the diff
   * added, so changed-path diffs cannot stand in for this observation. */
  gitlinks(candidate: Oid): GitObservation<readonly string[]>;
  compareAndSwap(base: Oid, candidate: Oid): RefAfterCas;
  runCheck(candidate: Oid, check: FrozenCheck, cancellation: AbortSignal | undefined, authorize: () => void): Promise<void>;
  noopWitness?(ref: string): GitObservation<Oid>;
  authorizeNoop?(ref: string, candidate: Oid): GitObservation<Oid>;
  submitters?(base: Oid, candidate: Oid): readonly string[];
}
function observed<T>(observation: GitObservation<T>, description: string): T {
  if (observation.kind === "present") return observation.value;
  // AV-20261003-25: a candidate outside the observation grammar is refused at
  // candidate scope -- it is never durable-store corruption.
  if (observation.kind === "refused") throw new StoreError("INVALID_REQUEST", `${description}: ${observation.reason}`);
  throw new StoreError(observation.kind === "corrupt" ? "STORE_CORRUPT" : "REF_STATE_UNKNOWN", `${description} is ${observation.kind}`);
}

export class IntegrationCoordinator {
  private readonly bound: IntegrationSnapshot | null;
  private readonly checking = new Map<OperationId, AbortController>();
  cancelMerge(request: OperationId): void { this.checking.get(request)?.abort(); }
  constructor(
    private readonly store: GitLedger,
    private readonly effects: IntegrationEffects,
    policy: IntegrationPolicy | null,
    private readonly policyReader: IntegrationPolicyReader | null = null,
    private readonly mail: GitMessaging | null = null,
    /** Read-only pre-CAS authority. Never calls the review workflow. */
    private readonly reviewGate: ReviewAuthority | null = null,
  ) {
    this.bound = policy === null ? null : snapshotIntegrationPolicy(policy);
  }

  private policy(): IntegrationSnapshot {
    if (this.bound === null) throw new StoreError("UNSUPPORTED_PROFILE", "integration requires an explicit host policy");
    return this.bound;
  }
  /** The bound snapshot without I/O; review code reads tiered facts from it. */
  boundPolicy(): IntegrationSnapshot | null { return this.bound; }
  /** The host's live policy read (currentPolicy semantics), outside T only. */
  currentIntegrationPolicy(): IntegrationSnapshot { return this.currentPolicy(); }
  /** DR8: the policy an integration is judged by now. The broker holds the
   * facts it started with -- protected paths and checks apply at its next start
   * (TUI-007) -- and the revision is the host's current one (CFG-005, D02). An
   * edit that leaves the facts alone gives later integrations its revision; one
   * that changes them is refused until the broker holds them. Read outside
   * acceptance (M-004), and never answered from the previous read.
   *
   * DR13, P0-5: a policy that cannot be obtained now is not a changed policy.
   * It is BROKER_UNAVAILABLE -- before acceptance a refusal to retry under the
   * same key, after it an operation left pending for recovery to decide once
   * the policy can be read. Only a policy read and found different is
   * POLICY_CHANGED. */
  private currentPolicy(): IntegrationSnapshot {
    const bound = this.policy();
    if (this.store.inTransaction) throw new StoreError("INTERNAL_ERROR", "policy I/O cannot run inside acceptance");
    if (this.policyReader === null) return bound;
    let read: ReturnType<IntegrationPolicyReader>;
    try { read = this.policyReader(); }
    catch (error) {
      if (error instanceof StoreError && (error.code === "BROKER_UNAVAILABLE" || error.code === "POLICY_CHANGED")) throw error;
      throw new StoreError("BROKER_UNAVAILABLE", "the host's integration policy cannot be read now", { cause: error });
    }
    let current: IntegrationSnapshot;
    try { current = snapshotIntegrationPolicy(read); }
    catch { throw new StoreError("POLICY_CHANGED", "the host's current integration policy is one the broker cannot hold"); }
    assertSameIntegrationPolicy(bound, current);
    return Object.freeze({ ...bound, policyRevision: current.policyRevision });
  }
  /** INT-003, D02: immediately before CAS, the revision an integration was
   * accepted under is still the host's, and the facts are still the ones held. */
  private verifyCurrentPolicy(revision: string): void {
    if (this.currentPolicy().policyRevision !== revision)
      throw new StoreError("POLICY_CHANGED", "integration policy revision changed after acceptance");
  }
  private operation(id: string): OperationOf<"git.integrate"> {
    const operation = this.store.getOperationById(id);
    if (!operation || operation.kind !== "git.integrate") throw new StoreError("STORE_CORRUPT", "accepted integration is missing or has another kind");
    return operation;
  }
  private receipt(id: string): Receipt { return receiptOfOperation(this.operation(id)); }
  private async succeed(operation: OperationOf<"git.integrate">): Promise<void> {
    if (operation.plan.merge !== undefined) {
      if (this.mail === null) throw new StoreError("BROKER_UNAVAILABLE", "integration publication owner is unavailable");
      const proof = new IntegrationPublicationObserver(this.effects).integration(operation);
      try { await this.mail.publishGated(operation.id, proof); }
      catch (error) {
        if (error instanceof StoreError && error.code === "STORE_CORRUPT") throw error;
        // PUB-002: the canonical effect is proven; an unavailable mail sink
        // leaves publication pending, never rewrites that fact as a failed CAS.
        return;
      }
    }
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
    if (!this.store.societyOpen()) throw new StoreError("AGENT_NOT_READY", "society execution is closed");
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
    requireNoGitlinks(observed(this.effects.gitlinks(candidate), "candidate gitlinks"));
    const changes = observed(this.effects.changedPaths(base, candidate), "changed paths");
    for (const change of changes) {
      if (snapshot.protectedPaths.some(path => protectedPathMatches(change.path, path)))
        throw new StoreError("PROTECTED_PATH", "candidate touches a protected path");
    }
  }
  private verifyAcceptedPolicy(policy: IntegrationSnapshot, operation: OperationOf<"git.integrate">): void {
    if (policy.policyIdentity !== operation.plan.policyIdentity)
      throw new StoreError("POLICY_CHANGED", "accepted integration policy facts changed; restart with the current policy before new acceptance");
  }
  private hasNoopWitness(operation: OperationOf<"git.integrate">): boolean {
    const ref = operation.plan.noopRef;
    if (!ref || !this.effects.noopWitness) throw new StoreError("REF_STATE_UNKNOWN", "no-op authorization witness is unavailable");
    const witness = this.effects.noopWitness(ref);
    if (witness.kind === "absent") return false;
    if (observed(witness, "no-op authorization") !== operation.plan.candidate)
      throw new StoreError("STORE_CORRUPT", "no-op authorization witness changed candidate");
    return true;
  }
  private authorizeNoop(operation: OperationOf<"git.integrate">): void {
    const ref = operation.plan.noopRef;
    if (!ref || !this.effects.authorizeNoop) throw new StoreError("REF_STATE_UNKNOWN", "no-op authorization owner is unavailable");
    if (observed(this.effects.authorizeNoop(ref, operation.plan.candidate), "no-op authorization") !== operation.plan.candidate)
      throw new StoreError("STORE_CORRUPT", "no-op authorization witness changed candidate");
  }
  private stillAtBase(operation: OperationOf<"git.integrate">): boolean {
    const main = this.effects.main();
    if (main.kind === "corrupt") throw new StoreError("STORE_CORRUPT", "canonical main observation is malformed");
    if (main.kind === "present" && main.value === operation.plan.base) return true;
    this.unknown(operation.id);
    return false;
  }
  private rejectAccepted(id: string, error: unknown, phase: ErrorPhase, knowledge: EffectKnowledge): never {
    const policy = acceptedFailurePolicy(error, phase, knowledge);
    if (policy.terminal === "failed") this.store.transaction(tx => tx.setOperationFailed(id, policy.code));
    else if (policy.terminal === "unknown") this.unknown(id);
    throw new AcceptedFailure(policy.code, failureMessage(error) ?? "integration observation or settlement failed", knowledge);
  }

  async execute(auth: AuthContext, key: string, input: { candidate: Oid; expected: Oid; tier?: RiskTier }): Promise<Receipt> {
    this.requireExecuteAuthority(auth, false);
    const hash = requestHash("git.integrate", input);
    const claim = this.store.claimKey(auth.actor, key, hash);
    if (claim === "retry") return receiptOfOperation(this.store.retriedOperation(auth.actor, key));
    if (claim === "reused") throw reused(auth.actor, key);
    const policy = this.currentPolicy();
    assertSupportedIntegration(policy);
    if (policy.tiered !== null)
      throw new StoreError("UNSUPPORTED_PROFILE", "this society reviews with oma_merge/oma_challenge");
    if (policy.tiered === null && input.tier !== undefined)
      throw new StoreError("UNSUPPORTED_PROFILE", "requested tier requires tiered integration");
    this.requireWriterSlot();
    this.effects.verifyObjectFormat([input.candidate, input.expected]);
    if (!observed(this.effects.published(), "admission published refs").includes(input.candidate))
      throw new StoreError("CANDIDATE_NOT_PUBLISHED", "candidate is not published");
    // UX-09: refuse a gitlink-bearing candidate before a row exists — the same
    // whole-tree refusal requireEligible repeats at every CAS boundary.
    requireNoGitlinks(observed(this.effects.gitlinks(input.candidate), "admission candidate gitlinks"));
    const main = observed(this.effects.main(), "admission main");
    if (main !== input.expected)
      throw new StoreError("STALE_BASE", "main differs from expected", { details: { actual: main } });
    const id = generateOperationId();
    const plan: PlanFor<"git.integrate"> = {
      kind: "git.integrate", repo: "project", target: "refs/heads/main",
      base: input.expected, candidate: input.candidate, policyRevision: policy.policyRevision,
      checkProfileDigest: policy.checkProfileDigest, policyIdentity: policy.policyIdentity,
      noopRef: input.expected === input.candidate ? `refs/oma/integrations/${id}` : null,
    };
    const accepted = this.store.transaction(tx => {
      this.requireExecuteAuthority(auth, false);
      const current = this.store.claimKey(auth.actor, key, hash);
      if (current === "retry") return "retry" as const;
      if (current === "reused") throw reused(auth.actor, key);
      this.requireWriterSlot();
      return tx.acceptOperation({ id, actor: auth.actor, requestKey: key, requestHash: hash,
        kind: "git.integrate", payloadJson: JSON.stringify(input), planJson: encodeOperationPlan(plan) });
    });
    if (accepted === "retry") return receiptOfOperation(this.store.retriedOperation(auth.actor, key));
    const operation = this.operation(id);
    let knowledge: EffectKnowledge = "none";
    try {
      if (!this.stillAtBase(operation)) return this.receipt(id);
      this.requireEligible(policy, plan.base, plan.candidate);
      for (const check of policy.checks) await this.effects.runCheck(plan.candidate, check, undefined, () => {
        this.requireExecuteAuthority(auth, true);
        this.requireWriterSlot(id);
        this.verifyCurrentPolicy(plan.policyRevision);
        this.verifyAcceptedPolicy(policy, operation);
      });
      if (!this.stillAtBase(operation)) return this.receipt(id);
      this.requireEligible(policy, plan.base, plan.candidate);
      this.verifyCurrentPolicy(plan.policyRevision);
      this.requireExecuteAuthority(auth, true);
      this.requireWriterSlot(id);
      this.verifyAcceptedPolicy(policy, operation);
      // No-op integrations also retain the current authority/stop/policy checks.
      if (plan.base !== plan.candidate) {
        knowledge = "possible";
        const after = this.effects.compareAndSwap(plan.base, plan.candidate);
        if (after.kind !== "candidate") { this.unknown(id); return this.receipt(id); }
      } else {
        knowledge = "possible";
        this.authorizeNoop(operation);
      }
      knowledge = "applied";
      await this.succeed(operation);
      return this.receipt(id);
    } catch (error) { return this.rejectAccepted(id, error, "accepted", knowledge); }
  }

  /** DR27/§5.3: execute a reviewed merge application. Accepted by
   * ReviewModule.advance inside the writer and replayed by reconcile; the
   * review's own evaluation owns readiness, this owner owns the live checks
   * and the CAS boundary. */
  async applyMerge(operation: OperationOf<"git.integrate">): Promise<void> {
    if (operation.state !== "pending" && operation.state !== "unknown") return;
    const plan = operation.plan;
    if (plan.merge === undefined)
      throw new StoreError("STORE_CORRUPT", "reviewed application requires a merge plan");
    let knowledge: EffectKnowledge = "possible";
    try {
      const main = this.effects.main();
      if (main.kind === "corrupt") throw new StoreError("STORE_CORRUPT", "canonical main observation is malformed");
      if (main.kind === "present" && main.value === plan.candidate) {
        // The canonical effect already happened (a completed CAS whose result
        // write never committed): publish the frozen notices and settle.
        knowledge = "applied";
        await this.succeed(operation);
        return;
      }
      if (main.kind !== "present" || main.value !== plan.base) { this.unknown(operation.id); return; }
      knowledge = "none";
      const policy = this.policy();
      this.verifyAcceptedPolicy(policy, operation);
      if (policy.checkProfileDigest !== plan.checkProfileDigest)
        throw new StoreError("POLICY_CHANGED", "accepted integration policy no longer matches the configured profile");
      assertSupportedIntegration(policy);
      this.verifyCurrentPolicy(plan.policyRevision);
      this.requireEligible(policy, plan.base, plan.candidate);
      if (this.reviewGate === null) throw new StoreError("STORE_CORRUPT", "review gate owner is unavailable");
      this.reviewGate.assertApplicable(plan.merge.request);
      const cancellation = new AbortController();
      this.checking.set(plan.merge.request, cancellation);
      try {
        for (const check of policy.checks) {
          await this.effects.runCheck(plan.candidate, check, cancellation.signal, () => {
            this.verifyCurrentPolicy(plan.policyRevision);
            this.verifyAcceptedPolicy(policy, operation);
            this.requireMergeAuthority(operation, plan.merge!.request);
          });
          if (cancellation.signal.aborted) throw new StoreError("CANCELLED_BEFORE_COMMIT", "the request was cancelled during checks");
        }
      } finally { this.checking.delete(plan.merge.request); }
      if (!this.stillAtBase(operation)) return;
      this.requireEligible(policy, plan.base, plan.candidate);
      this.verifyCurrentPolicy(plan.policyRevision);
      this.requireMergeAuthority(operation, plan.merge.request);
      knowledge = "possible";
      const after = this.effects.compareAndSwap(plan.base, plan.candidate);
      if (after.kind !== "candidate") { this.unknown(operation.id); return; }
      knowledge = "applied";
      await this.succeed(operation);
    } catch (error) { this.rejectAccepted(operation.id, error, "recovering", knowledge); }
  }

  async reconcile(operation: OperationOf<"git.integrate">): Promise<void> {
    if (operation.state !== "pending" && operation.state !== "unknown") return;
    const plan = operation.plan;
    if (plan.merge !== undefined) return this.applyMerge(operation);

    // D06/DR27: main equality alone never authorizes a no-op. New no-op
    // plans carry an immutable Git authorization witness. Applied effects settle
    // before observing current authority.
    const noOp = plan.base === plan.candidate;
    let knowledge: EffectKnowledge = "possible";
    try {
      if (noOp && this.hasNoopWitness(operation)) {
        knowledge = "applied";
        await this.succeed(operation);
        return;
      }
      const main = this.effects.main();
      if (main.kind === "corrupt") throw new StoreError("STORE_CORRUPT", "canonical main observation is malformed");
      if (!noOp && main.kind === "present" && main.value === plan.candidate) {
        knowledge = "applied";
        await this.succeed(operation);
        return;
      }
      if (main.kind !== "present" || main.value !== plan.base) { this.unknown(operation.id); return; }
      knowledge = "none";
      this.requireWriterSlot(operation.id);
      const policy = this.policy();
      this.verifyAcceptedPolicy(policy, operation);
      if (policy.checkProfileDigest !== plan.checkProfileDigest)
        throw new StoreError("POLICY_CHANGED", "accepted integration policy no longer matches the configured profile");
      assertSupportedIntegration(policy);
      this.verifyCurrentPolicy(plan.policyRevision);
      this.verifyAcceptedPolicy(policy, operation);
      this.requireRecoveryAuthority(operation.actor);
      this.effects.verifyObjectFormat([plan.base, plan.candidate]);
      this.requireEligible(policy, plan.base, plan.candidate);
      for (const check of policy.checks) await this.effects.runCheck(plan.candidate, check, undefined, () => {
        this.requireRecoveryAuthority(operation.actor);
        this.requireWriterSlot(operation.id);
        this.verifyCurrentPolicy(plan.policyRevision);
        this.verifyAcceptedPolicy(policy, operation);
      });
      if (!this.stillAtBase(operation)) return;
      this.requireEligible(policy, plan.base, plan.candidate);
      this.verifyCurrentPolicy(plan.policyRevision);
      this.requireRecoveryAuthority(operation.actor);
      this.requireWriterSlot(operation.id);
      this.verifyAcceptedPolicy(policy, operation);
      if (!noOp) {
        knowledge = "possible";
        const after = this.effects.compareAndSwap(plan.base, plan.candidate);
        if (after.kind !== "candidate") { this.unknown(operation.id); return; }
      } else {
        knowledge = "possible";
        this.authorizeNoop(operation);
      }
      knowledge = "applied";
      await this.succeed(operation);
    } catch (error) { this.rejectAccepted(operation.id, error, "recovering", knowledge); }
  }
  private requireMergeAuthority(operation: OperationOf<"git.integrate">, request: OperationId): void {
      // Merge authority: the society is open; the requester exists, is still
      // enabled (a stop/retire between review and CAS cancels the application),
      // and still holds its durable git.submit capability.
      if (!this.store.societyOpen()) throw new StoreError("AGENT_NOT_READY", "society execution is closed");
      const requester = this.store.getAgent(operation.actor);
      if (requester?.desired === "stopped" || requester?.desired === "retired")
        throw new StoreError("CANCELLED_BEFORE_COMMIT", "stop or retire intent was accepted before main CAS");
      if (!requester || !capabilitiesOf(requester).has("git.submit"))
        throw new StoreError("CAPABILITY_DENIED", "the requester's current durable submit authority is unavailable");
      // The last synchronous check before CAS: the request must still be ready
      // (a cancel fact cancels; any other unreadiness is a conditions refusal).
      if (this.reviewGate === null) throw new StoreError("STORE_CORRUPT", "review gate owner is unavailable");
      this.reviewGate.assertApplicable(request);
      this.requireWriterSlot(operation.id);
  }

}
