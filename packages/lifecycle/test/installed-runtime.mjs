import assert from "node:assert/strict";
import { LifecycleModule } from "@oma/lifecycle";
import { LifecyclePolicy } from "@oma/lifecycle/policy";
import { quiesceResidents } from "@oma/lifecycle/society";
import { resolvedSpecDigest } from "@oma/domain/spec-identity";
import { StoreError } from "@oma/domain/errors";

assert.throws(() => Reflect.construct(LifecycleModule, [{}, {}, {
  stateRoot: "/fixture", society: "demo", hasGoal: () => true,
}]), { code: "UNSUPPORTED_PROFILE" });
const caps = ["agent.create", "agent.manage.self", "agent.manage.descendants"];
const agent = (name, createdBy, role = "resident") => {
  const spec = { name, profile: "p", modelProfile: "p", from: "1".repeat(40), brief: "brief", capabilities: caps };
  return { name, createdBy, role, desired: "enabled", incarnation: role === "principal" ? 0 : 1,
    profile: "p", specJson: JSON.stringify(spec), specHash: resolvedSpecDigest(spec), createdAtMs: 0, updatedAtMs: 0 };
};
const rows = [agent("principal", null, "principal"), agent("alice", "principal"), agent("bob", "alice")];
let open = true;
const reader = { getAgent: name => rows.find(row => row.name === name) ?? null,
  listAgents: () => rows, societyOpen: () => open };
const policy = new LifecyclePolicy(reader, () => null);
const auth = { actor: "alice", role: "resident", incarnation: 1, channel: "actor", capabilities: new Set(caps),
  peer: { pid: process.pid, uid: 1000, gid: 1000 } };
policy.requireManage(auth, "alice"); policy.requireManage(auth, "bob");
assert.throws(() => policy.requireManage(auth, "principal"), { code: "CAPABILITY_DENIED" });
open = false;
assert.throws(() => policy.requireManage(auth, "bob"), { code: "AGENT_NOT_READY" });
open = true; rows[1].desired = "stopped";
assert.throws(() => policy.requireManage(auth, "bob"), { code: "STALE_RUN" });
rows[1].desired = "enabled"; rows[1].incarnation++;
assert.throws(() => policy.requireManage(auth, "bob"), { code: "STALE_RUN" });

const stopped = [];
await assert.rejects(() => quiesceResidents(reader, {
  stop(name, incarnation) { stopped.push([name, incarnation]); },
  confirmDead(name) { return name !== "alice"; },
}), { code: "RUN_TERMINATION_UNKNOWN" });
assert.deepEqual(stopped, [["alice", 2], ["bob", 1]], "an unknown death must not skip the next Resident");
stopped.length = 0;
await quiesceResidents(reader, { stop(name, incarnation) { stopped.push([name, incarnation]); }, confirmDead() { return true; } });
assert.equal(stopped.length, 2);
await assert.rejects(() => quiesceResidents(reader, {
  stop(name) { throw new StoreError(name === "bob" ? "STORE_CORRUPT" : "RUN_TERMINATION_UNKNOWN", name); },
  confirmDead() { assert.fail("a failed stop has no confirmed-death observation"); },
}), { code: "STORE_CORRUPT" });
