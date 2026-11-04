import type { Actor } from "@oma/contracts/identity";
import type { AgentCreateInput } from "@oma/contracts/values";
import type { AuthContext } from "@oma/contracts/runtime";
import type { Receipt } from "@oma/contracts/durable";
import type { ResolvedAgentSpec } from "@oma/contracts/host";
import type { LifecycleLedger, LifecycleUnits } from "./ports.js";
import { StoreError, publicFailure, errorCodeOf } from "@oma/domain/errors";
import type { CreationObservation } from "@oma/contracts/public-wire";
import { LineageSnapshot } from "@oma/domain/lineage";
import { resolvedSpecDigest } from "@oma/domain/spec-identity";
import { receiptOfOperation } from "@oma/protocol/receipt-projector";
import { assertActorIdentity, assertCurrentActor, effectiveCapabilitiesOf } from "@oma/domain/authority";
import type { SpecResolver } from "./contracts.js";

interface ReleasedWorkerObservation {
  readonly specHash: string; readonly incarnation: number; readonly desired: "stopped" | "retired";
  readonly action: string | null; readonly confirmedDead: boolean;
}
export type ActivationCapacityObservation = ReadonlyMap<Actor, ReleasedWorkerObservation>;

export function lifecycleReceipt(store: Pick<LifecycleLedger, "getOperationById">, id: string): Receipt {
  const operation = store.getOperationById(id);
  if (!operation) throw new StoreError("STORE_CORRUPT", "accepted lifecycle operation missing");
  return receiptOfOperation(operation);
}
export class LifecyclePolicy {
  /** Metadata-only diagnostic reuse, scoped to this original ledger owner. */
  private creationCount: { readonly stamp: string; readonly count: number } | null = null;
  private observedWorkerCount(): number {
    // Never reuse a display observation for T-local rows or admission. Ports
    // without the original Store's invalidation/state retain full reads.
    if (this.store.inTransaction !== false || this.store.observationStamp === undefined) return this.workerCount();
    const stamp = this.store.observationStamp(); // A failed probe cannot return cached success.
    if (this.creationCount?.stamp === stamp) return this.creationCount.count;
    const count = this.workerCount(); // Full original row/lineage validation precedes cache publication.
    this.creationCount = { stamp, count };
    return count;
  }
  constructor(private readonly store: LifecycleLedger, private readonly resolver: SpecResolver) {}
  private workerCount(agents = this.store.listAgents()): number {
    let count = 0;
    for (const agent of agents) if (agent.role === "resident" && agent.desired === "enabled") count++;
    return count;
  }
  private supportedCapacity(workerCount: number): number {
    const maxWorkers = this.resolver.maxWorkers();
    if (!Number.isSafeInteger(maxWorkers) || maxWorkers < 1)
      throw new StoreError("UNSUPPORTED_PROFILE", "invalid active Worker capacity");
    if (workerCount > maxWorkers)
      throw new StoreError("UNSUPPORTED_PROFILE", `configured active Worker capacity ${maxWorkers} is below ${workerCount} enabled Workers; stop Workers or restore the capacity before activation`,
        { details: { resource: "workers", maxWorkers, workerCount } });
    return maxWorkers;
  }
  assertActiveCapacity(): void { this.supportedCapacity(this.workerCount()); }
  assertCreationCapacity(): void {
    const workerCount = this.workerCount();
    const maxWorkers = this.supportedCapacity(workerCount);
    if (workerCount >= maxWorkers)
      throw new StoreError("LIMIT_EXCEEDED", `active Worker capacity is ${maxWorkers}; ${workerCount} slots are already occupied`,
        { details: { resource: "workers", maxWorkers, workerCount } });
  }
  /** Physical death is observed outside SQLite, immediately before admission. */
  observeReleasedCapacity(units: Pick<LifecycleUnits, "confirmDead">): ActivationCapacityObservation {
    const observed = new Map<Actor, ReleasedWorkerObservation>();
    for (const agent of this.store.listAgents()) {
      if (agent.role !== "resident" || (agent.desired !== "stopped" && agent.desired !== "retired")) continue;
      const action = this.store.latestAgentAction(agent.name)?.id ?? null;
      observed.set(agent.name, { specHash: agent.specHash, incarnation: agent.incarnation, desired: agent.desired,
        action, confirmedDead: units.confirmDead(agent.name, agent.incarnation) });
    }
    return observed;
  }
  /** Called in the same synchronous transaction as the promotion to enabled. */
  assertWorkerCapacity(target: Actor, observed: ActivationCapacityObservation | null): void {
    const agents = this.store.listAgents();
    const workerCount = this.workerCount(agents);
    const maxWorkers = this.supportedCapacity(workerCount);
    const current = this.store.getAgent(target);
    if (current?.role === "principal" || current?.desired === "enabled") return;
    if (workerCount >= maxWorkers)
      throw new StoreError("LIMIT_EXCEEDED", `active Worker capacity is ${maxWorkers}; ${workerCount} slots are already occupied`,
        { details: { resource: "workers", maxWorkers, workerCount } });
    // A stopped identity releases its entitlement, not an unproven physical
    // scope. Do not reuse the space of a scope whose stop is still unresolved.
    let unconfirmed = 0;
    for (const agent of agents) {
      if (agent.role !== "resident" || (agent.desired !== "stopped" && agent.desired !== "retired")) continue;
      const proof = observed?.get(agent.name);
      if (!proof || proof.specHash !== agent.specHash || proof.incarnation !== agent.incarnation ||
          proof.desired !== agent.desired || proof.action !== (this.store.latestAgentAction(agent.name)?.id ?? null))
        throw new StoreError("RUN_TERMINATION_UNKNOWN", "released Worker identity changed after termination observation");
      if (!proof.confirmedDead) unconfirmed++;
    }
    if (workerCount + unconfirmed >= maxWorkers)
      throw new StoreError("RUN_TERMINATION_UNKNOWN", "released Worker capacity awaits confirmed execution termination");
  }
  /** Shared name/capacity preflight. It creates no reservation or restart alias. */
  existingCreation(name: Actor, specHash: string, selected: boolean) {
    const existing = this.store.getAgent(name);
    if (existing === null) return null;
    if (selected && (existing.desired === "stopped" || existing.desired === "retired"))
      throw new StoreError("AGENT_CONFLICT", "the existing Worker name is stopped or retired; creation cannot restart it");
    if (existing.specHash !== specHash) throw new StoreError("AGENT_CONFLICT", `name ${name} already exists with a different resolved spec`);
    return existing;
  }
  freezeCreation(auth: AuthContext, input: AgentCreateInput): import("@oma/contracts/values").CreateResolution {
    const policyRevision = this.refresh();
    if (policyRevision === null) throw new StoreError("UNSUPPORTED_PROFILE", "selected creation requires a stable child-policy revision");
    const { specHash } = this.resolve(auth, input);
    if (this.existingCreation(input.name, specHash, true) === null) this.assertCreationCapacity();
    return { specHash, policyRevision };
  }
  observeCreation(auth: AuthContext): CreationObservation {
    const parent = assertActorIdentity(this.store, auth);
    const capabilities = effectiveCapabilitiesOf(auth, parent);
    const observed = { capability: capabilities.includes("agent.create"), workerCount: this.observedWorkerCount(), observedAtMs: Date.now() };
    try {
      this.resolver.refresh?.();
      this.supportedCapacity(observed.workerCount);
      if (!this.resolver.observe) throw new StoreError("UNSUPPORTED_PROFILE", "child policy cannot be observed by this resolver");
      const child = this.resolver.observe({ name: parent.name, profile: parent.profile, capabilities });
      return { ...observed, maxWorkers: this.resolver.maxWorkers(),
        childProfile: child?.profile ?? null, childHasMailSend: child?.capabilities.includes("mail.send") ?? false };
    } catch (error) {
      if (errorCodeOf(error) === "STORE_CORRUPT") throw error;
      const failure = publicFailure(error);
      return { ...observed, maxWorkers: null, childProfile: null, childHasMailSend: null, error: { code: failure.code, message: failure.message } };
    }
  }
  requireManage(auth: AuthContext, target: Actor): void {
    assertCurrentActor(this.store, auth, target === auth.actor ? "agent.manage.self" : "agent.manage.descendants");
    if (target === auth.actor) return;
    if (!this.store.getAgent(target)) throw new StoreError("ADDRESS_NOT_FOUND", `no agent ${target}`);
    if (!new LineageSnapshot(this.store.listAgents()).isDescendant(target, auth.actor))
      throw new StoreError("CAPABILITY_DENIED", `${target} is not a descendant of ${auth.actor}`);
  }
  refresh(): string | null { this.resolver.refresh?.(); return this.resolver.revision?.() ?? null; }
  assertRevision(revision: string | null): void {
    if (revision !== null && this.resolver.revision?.() !== revision) throw new StoreError("POLICY_CHANGED", "child policy changed before acceptance");
  }
  resolve(auth: AuthContext, input: AgentCreateInput): { spec: ResolvedAgentSpec; specHash: string } {
    const parent = assertCurrentActor(this.store, auth, "agent.create");
    const spec = this.resolver({ name: parent.name, profile: parent.profile, role: parent.role, desired: parent.desired, capabilities: effectiveCapabilitiesOf(auth, parent) }, { name: input.name, from: input.from, brief: input.brief });
    if (!spec) throw new StoreError("CAPABILITY_DENIED", "no delegable child profile");
    return { spec, specHash: resolvedSpecDigest(spec) };
  }
}
