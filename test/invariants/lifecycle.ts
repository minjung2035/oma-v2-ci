import assert from "node:assert/strict";
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { workspacePathAt, isActorSocketPathFor } from "@oma/domain/paths";
import type { LedgerSnapshot, InvariantPhase } from "./store.js";

export interface ObservedRunFact {
  actor: string; incarnation: number; active: "running" | "dead" | "unknown";
  socketHostPath?: string;
}
export interface LifecycleFacts {
  readonly hasGoal: boolean;
  readonly runRoot: string;
  readonly runs: readonly ObservedRunFact[];
}
export function assertLifecycle(snapshot: LedgerSnapshot, root: string, phase: InvariantPhase, facts?: LifecycleFacts): readonly string[] {
  const incomplete: string[] = [];
  for (const operation of snapshot.operations) {
    if (operation.kind !== "agent.create") continue;
    const plan = operation.plan;
    const actor = snapshot.agents.find(agent => agent.name === plan.spec.name);
    assert.ok(actor, "CREATE_REGISTRY_MISSING"); assert.equal(actor.specHash, plan.specHash, "CREATE_REGISTRY_SPEC");
    if (plan.existingCreation !== null) {
      const original = snapshot.operations.find(value => value.id === plan.existingCreation);
      assert.ok(original?.kind === "agent.create" && original.plan.existingCreation === null, "CREATE_LINK_NOT_PHYSICAL");
      if (original?.kind === "agent.create") assert.equal(original.plan.specHash, plan.specHash, "CREATE_LINK_SPEC");
      assert.equal(plan.initialMessage, null, "LINKED_CREATE_INITIAL_MESSAGE");
      continue;
    }
    const path = workspacePathAt(root, plan.spec.name);
    assert.equal(plan.workspacePath, path, "CREATE_WORKSPACE_IDENTITY");
    const exists = lstatSync(path, { throwIfNoEntry: false });
    if (operation.state === "succeeded") {
      assert.equal(exists?.isDirectory(), true, "SUCCEEDED_WORKSPACE_MISSING");
      assert.equal(lstatSync(join(path, ".git"), { throwIfNoEntry: false })?.isDirectory(), true, "WORKSPACE_PRIVATE_REPOSITORY");
      assert.equal(lstatSync(join(path, ".git", "objects/info/alternates"), { throwIfNoEntry: false }), undefined, "WORKSPACE_BORROWED_OBJECTS");
      // Users can commit after creation; historical success does not freeze the
      // current workspace HEAD or imply its current desired state is enabled.
    } else if (!exists) incomplete.push(`${operation.id}:workspace-pending`);
  }
  for (const fact of facts?.runs ?? []) {
    const actor = snapshot.agents.find(value => value.name === fact.actor);
    assert.ok(actor, "RUN_ACTOR_MISSING"); assert.equal(fact.incarnation, actor.incarnation, "STALE_RUN_LEASE");
    if (fact.socketHostPath !== undefined)
      assert.ok(isActorSocketPathFor(fact.socketHostPath, { runRoot: facts!.runRoot, actor: fact.actor, incarnation: fact.incarnation }), "RUN_SOCKET_IDENTITY");
    if (fact.active === "running") {
      if (actor.role === "resident") assert.equal(facts!.hasGoal, true, "RESIDENT_ACTIVATED_BEFORE_GOAL");
      assert.notEqual(actor.desired, "provisioning", "PROVISIONING_RUN_ACTIVE");
      if (phase === "settled") assert.equal(actor.desired, "enabled", "SETTLED_DISABLED_RUN_ACTIVE");
    } else if (fact.active === "unknown") incomplete.push(`${fact.actor}:run-observation-unknown`);
    // enabled does not entail running; path activation may legitimately wait.
  }
  return incomplete;
}
