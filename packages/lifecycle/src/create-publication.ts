import type { LifecycleWorkspace } from "./ports.js";
import type { CreationPublicationEvidence } from "@oma/contracts/publication";
import type { OperationOf } from "@oma/protocol/operation-codec";
import type { LifecycleLedger } from "./ports.js";
import type { LifecycleUnits } from "./ports.js";
import { StoreError } from "@oma/domain/errors";
import { isWorkspacePathFor } from "@oma/domain/paths";

const readyBrand: unique symbol = Symbol("observed create readiness");
const issued = new WeakMap<object, { id: string; actor: string; planJson: string }>();

/** Only this host coordinator issues creation publication capabilities. Neither
 * desired=enabled nor a caller boolean is workspace/unit installation proof.
 */
export class CreationPublicationObserver {
  constructor(private readonly store: LifecycleLedger, private readonly units: Pick<LifecycleUnits, "ensureResident">, private readonly stateRoot: string,
    private readonly workspace: Pick<LifecycleWorkspace, "observeProvisioningHead">) {}
  ready(operation: OperationOf<"agent.create">): CreationPublicationEvidence {
    const plan = operation.plan;
    if ("unitNames" in plan) throw new StoreError("UNSUPPORTED_PROFILE", "historical unit installation intent cannot publish native readiness");
    if ((operation.state !== "pending" && operation.state !== "unknown") || plan.existingCreation !== null || plan.initialMessage === null)
      throw new StoreError("AGENT_NOT_READY", "creation publication requires the original accepted intent");
    if (!isWorkspacePathFor(plan.workspacePath, { stateRoot: this.stateRoot, actor: plan.spec.name }))
      throw new StoreError("STORE_CORRUPT", "creation workspace identity mismatch");
    const agent = this.store.getAgent(plan.spec.name);
    if (!agent || agent.specHash !== plan.specHash)
      throw new StoreError("STORE_CORRUPT", "creation owner differs from the frozen spec");
    // INV03: readiness is a settled fact once the agent has left `provisioning`
    // (this method's own transaction below is the only way out of it, and a
    // run can open only after it). It is proven here while the agent is still
    // provisioning, and never derived again afterwards from the workspace, which
    // is by then the Resident's to change.
    if (agent.desired === "provisioning") {
      if (agent.incarnation !== 0) throw new StoreError("STORE_CORRUPT", "a provisioning agent has opened a run");
      const head = this.workspace.observeProvisioningHead(plan.workspacePath);
      if (head.status !== 0 || head.stdout.trim() !== plan.spec.from)
        throw new StoreError("STORE_CORRUPT", "creation workspace has no matching frozen base");
    }
    // The native execution owner verifies the frozen references and owns the actor slot.
    this.units.ensureResident(plan.spec.name, plan.spec.profile, plan.spec.modelProfile);
    this.store.transaction(tx => {
      const current = this.store.getAgent(plan.spec.name);
      if (!current || current.specHash !== plan.specHash || current.incarnation !== agent.incarnation)
        throw new StoreError("STORE_CORRUPT", "creation identity changed before readiness commit");
      if (current.desired === "provisioning") tx.updateAgent({ name: current.name, desired: "enabled" });
    });
    const proof = Object.freeze({ [readyBrand]: true as const });
    issued.set(proof, { id: operation.id, actor: operation.actor, planJson: operation.planJson });
    return proof as unknown as CreationPublicationEvidence;
  }
}

export function consumeCreationPublication(proof: unknown, operation: OperationOf<"agent.create">): void {
  if (proof === null || typeof proof !== "object")
    throw new StoreError("AGENT_NOT_READY", "initial mail requires workspace and unit readiness evidence");
  const facts = issued.get(proof);
  if (!facts || facts.id !== operation.id || facts.actor !== operation.actor || facts.planJson !== operation.planJson)
    throw new StoreError("AGENT_NOT_READY", "initial mail requires matching fresh readiness evidence");
  issued.delete(proof);
}
