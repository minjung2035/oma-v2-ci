import type { Actor } from "../../implementation/contracts/identity.js";
import type { AgentCreateInput } from "../../implementation/contracts/values.js";
import type { AuthContext } from "../../implementation/contracts/runtime.js";
import type { Receipt } from "../../implementation/contracts/durable.js";
import type { ResolvedAgentSpec } from "../../implementation/contracts/host.js";
import type { Store } from "../store.js";
import { StoreError } from "../domain/errors.js";
import { LineageSnapshot, assertCreateCapacity } from "../domain/lineage.js";
import { resolvedSpecDigest } from "../domain/spec-identity.js";
import { receiptOfOperation } from "../protocol/receipts.js";
import { assertCurrentActor, effectiveCapabilitiesOf } from "../authority.js";
import type { AgentQuota, SpecResolver } from "./contracts.js";

export function lifecycleReceipt(store: Pick<Store, "getOperationById">, id: string): Receipt {
  const operation = store.getOperationById(id);
  if (!operation) throw new StoreError("STORE_CORRUPT", "accepted lifecycle operation missing");
  return receiptOfOperation(operation);
}
export class LifecyclePolicy {
  constructor(private readonly store: Store, private readonly resolver: SpecResolver, private readonly quota: AgentQuota | null) {}
  requireManage(auth: AuthContext, target: Actor): void {
    assertCurrentActor(this.store, auth, target === auth.actor ? "agent.manage.self" : "agent.manage.descendants");
    if (target === auth.actor) return;
    if (!this.store.getAgent(target)) throw new StoreError("ADDRESS_NOT_FOUND", `no agent ${target}`);
    if (!new LineageSnapshot(this.store.listAgents()).isDescendant(target, auth.actor))
      throw new StoreError("CAPABILITY_DENIED", `${target} is not a descendant of ${auth.actor}`);
  }
  enforceQuota(parent: Actor): void {
    if (this.quota) assertCreateCapacity(new LineageSnapshot(this.store.listAgents()), parent, this.quota);
  }
  assertSeedCount(count: number): void {
    if (this.quota && count > this.quota.societyAgents) throw new StoreError("QUOTA_EXCEEDED", "bootstrap exceeds society agent quota");
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
