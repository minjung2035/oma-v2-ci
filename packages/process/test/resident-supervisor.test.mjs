import test from "node:test";
import assert from "node:assert/strict";
import { ResidentSupervisor } from "../dist/resident-supervisor.js";
import { StoreError } from "@oma/domain/errors";

function fixture({ failures = {}, dead = true, observations = [] } = {}) {
  const calls = [];
  const idle = { activeState: "inactive", subState: "dead", result: "success", execMainStatus: 0, invocationId: "a".repeat(32), scope: "fixture-scope" };
  const backend = Object.fromEntries(["assertStartOwner", "repairStartFailure", "enableWake", "launch", "disableWake", "revoke", "terminate", "verifyWakeDisabled"]
    .map(name => [name, actor => { calls.push([name, actor]); if (name in failures) throw failures[name]; }]));
  backend.observe = actor => { calls.push(["observe", actor]); if ("observe" in failures) throw failures.observe; return observations.shift() ?? idle; };
  backend.confirmDead = (actor, incarnation) => { calls.push(["confirmDead", actor, incarnation]); return dead; };
  return { calls, supervisor: new ResidentSupervisor(backend), idle };
}
test("resident policy: inactive status and completed stop commands cannot replace descendant death proof", async () => {
  const f = fixture({ dead: false });
  await assert.rejects(() => f.supervisor.stop("alice", 7), { code: "RUN_TERMINATION_UNKNOWN" });
  assert.deepEqual(f.calls.at(-1), ["confirmDead", "alice", 7]);
});
for (const phase of ["disableWake", "revoke", "terminate", "verifyWakeDisabled", "observe"])
  test(`resident policy: ${phase} failure still attempts revoke, termination and proof and remains unknown`, async () => {
    const primary = new Error(phase), f = fixture({ failures: { [phase]: primary } });
    await assert.rejects(() => f.supervisor.stop("alice", 7), error => error.code === "RUN_TERMINATION_UNKNOWN" &&
      error.cause instanceof AggregateError && error.cause.errors.includes(primary));
    assert.deepEqual(f.calls.map(call => call[0]), ["disableWake", "revoke", "terminate", "verifyWakeDisabled", "observe", "confirmDead"]);
  });
test("resident policy: multiple stop failures retain every primary in their physical order", async () => {
  const a = new Error("wake"), b = new Error("termination");
  const f = fixture({ failures: { disableWake: a, terminate: b } });
  await assert.rejects(() => f.supervisor.stop("alice", 3), error => {
    assert.deepEqual(error.cause.errors, [a, b]); return error.code === "RUN_TERMINATION_UNKNOWN";
  });
});
test("resident policy: successful start command and the old inactive invocation establish no new activation", async () => {
  const f = fixture();
  await assert.rejects(() => f.supervisor.start("alice", false), { code: "RUN_TERMINATION_UNKNOWN" });
});
test("resident policy: a new invocation that already ended successfully is still observed activation", async () => {
  const f = fixture(); f.supervisor = new ResidentSupervisor({
    assertStartOwner() {}, observe: () => ({ ...f.idle, invocationId: (++count === 1 ? "a" : "b").repeat(32) }),
    enableWake() {}, launch() {},
  });
  let count = 0;
  await f.supervisor.start("alice", false);
});
test("resident policy: start-limit observation never settles an unknown launch command", async () => {
  const unknown = new StoreError("DEADLINE_EXCEEDED", "launch unknown");
  const f = fixture({ failures: { launch: unknown }, observations: [
    { activeState: "failed", result: "start-limit-hit" }, { activeState: "failed", result: "start-limit-hit" },
  ] });
  await assert.rejects(() => f.supervisor.start("alice", false), error => error === unknown);
  assert.equal(f.calls.filter(call => call[0] === "observe").length, 1);
});
