import type { Actor } from "@oma/contracts/identity";
import type { AgentCreateInput } from "@oma/contracts/values";
import type { AuthContext } from "@oma/contracts/runtime";
import type { Receipt } from "@oma/contracts/durable";
import type { ResolvedAgentSpec } from "@oma/contracts/host";
import type { LifecycleLedger } from "./ports.js";
import { StoreError, publicFailure } from "@oma/domain/errors";
import type { CreationObservation } from "@oma/contracts/public-wire";
import { LineageSnapshot } from "@oma/domain/lineage";
import { resolvedSpecDigest } from "@oma/domain/spec-identity";
import { receiptOfOperation } from "@oma/protocol/receipt-projector";
import { assertActorIdentity, assertCurrentActor, effectiveCapabilitiesOf } from "@oma/domain/authority";
import type { SpecResolver } from "./contracts.js";

export function lifecycleReceipt(store: Pick<LifecycleLedger, "getOperationById">, id: string): Receipt {
  const operation = store.getOperationById(id);
  if (!operation) throw new StoreError("STORE_CORRUPT", "accepted lifecycle operation missing");
  return receiptOfOperation(operation);
}
export class LifecyclePolicy {
  constructor(private readonly store: LifecycleLedger, private readonly resolver: SpecResolver) {}
  private workerCount(): number {
    let count = 0;
    for (const agent of this.store.listAgents()) if (agent.role === "resident") count++;
    return count;
  }
  assertWorkerCapacity(): void {
    const maxWorkers = this.resolver.maxWorkers();
    if (!Number.isSafeInteger(maxWorkers) || maxWorkers < 1)
      throw new StoreError("UNSUPPORTED_PROFILE", "invalid Worker capacity");
    const workerCount = this.workerCount();
    if (workerCount >= maxWorkers)
      throw new StoreError("LIMIT_EXCEEDED", `Worker capacity is ${maxWorkers}; ${workerCount} slots are already occupied`,
        { details: { resource: "workers", maxWorkers, workerCount } });
  }
  observeCreation(auth: AuthContext): CreationObservation {
    const parent = assertActorIdentity(this.store, auth);
    const capabilities = effectiveCapabilitiesOf(auth, parent);
    const observed = { capability: capabilities.includes("agent.create"), workerCount: this.workerCount(), observedAtMs: Date.now() };
    try {
      this.resolver.refresh?.();
      if (!this.resolver.observe) throw new StoreError("UNSUPPORTED_PROFILE", "child policy cannot be observed by this resolver");
      const child = this.resolver.observe({ name: parent.name, profile: parent.profile, capabilities });
      return { ...observed, maxWorkers: this.resolver.maxWorkers(),
        childProfile: child?.profile ?? null, childHasMailSend: child?.capabilities.includes("mail.send") ?? false };
    } catch (error) {
      if (error instanceof StoreError && error.code === "STORE_CORRUPT") throw error;
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
    const spec = this.resolver({ name: parent.name, profile: parent.profile, role: parent.role, desired: parent.desired, capabilities: effectiveCapabilitiesOf(auth, parent) }, input);
    if (!spec) throw new StoreError("CAPABILITY_DENIED", "no delegable child profile");
    return { spec, specHash: resolvedSpecDigest(spec) };
  }
}
