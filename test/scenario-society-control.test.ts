/** DR27: real Principal engine, extension, CLI and broker; only the provider and units are scripted. */
import test from "node:test";
import assert from "node:assert/strict";
import { withScenario } from "./fixtures/scenario.js";
import { call, text, tools, toolResults } from "./fixtures/scripted-provider.js";

test("DR27: Principal closes society, survives broker/engine restart, and explicitly reopens without a Worker start tool", { timeout: 120_000 }, async () => {
  await withScenario({ residents: ["worker-a", "worker-b"] }, async s => {
    s.store.transaction(tx => tx.updateAgent({ name: "worker-b", desired: "stopped" }));
    await s.residentSends("worker-a", { to: ["principal"], subject: "Retain for resume", body: "Pending question" }, "question");
    const pending = s.store.pendingDeliveries("principal");
    s.script([tools(call("oma_society", { action: "close", request: "close" })), text("Closed.")]);
    await s.prompt("Close Worker execution.");
    assert.equal(s.store.societyOpen(), false);
    const closed = s.store.getOperation("principal", "close")!;
    assert.equal(closed.state, "succeeded"); assert.equal(closed.kind, "society.set");
    assert.match(toolResults(s.provider.seen.at(-1)!.body).at(-1)!.text, /succeeded/);
    const offered = s.provider.seen[0]!.body.tools!.map(tool => tool.function?.name);
    for (const name of ["oma_society", "oma_merge", "oma_challenge", "oma_mail_send", "oma_mail_read"]) assert.ok(offered.includes(name));
    for (const name of ["oma_agent_create", "oma_status", "oma_logs", "oma_mail_ack", "write", "edit", "bash"]) assert.ok(!offered.includes(name), name);
    const calls = s.provider.seen.length;
    assert.equal((await s.deliver()).kind, "idle"); assert.equal(s.provider.seen.length, calls);
    await s.restartBroker(); await s.restartEngine();
    assert.equal(s.store.societyOpen(), false); assert.deepEqual(s.store.pendingDeliveries("principal"), pending);
    s.script([tools(call("oma_society", { action: "open", request: "open" })), text("Open.")]);
    await s.prompt("Resume Worker execution.");
    assert.equal(s.store.societyOpen(), true); assert.equal(s.store.getAgent("worker-b")!.desired, "stopped");
    assert.equal(s.operations("principal").filter(row => row.kind === "society.set").length, 2);
    s.script([tools(call("oma_society", { action: "close", request: "close" })), text("Old receipt only.")]);
    await s.prompt("Look up the previous close request.");
    assert.equal(s.store.societyOpen(), true, "terminal replay must not close reopened execution");
    s.script([text("Read pending mail after reopening.")]); assert.equal((await s.deliver()).kind, "delivered");
    assert.equal(s.store.pendingDeliveries("principal").length, 0);
  });
});
