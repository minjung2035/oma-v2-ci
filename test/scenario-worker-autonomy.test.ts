/** DR27: confined bundled Worker engine -> CLI -> broker -> clone and initial mail.
 * Provider and unit observations are local fixtures, not deployment evidence. */
import test from "node:test";
import { RESIDENT_TEST_OPTIONS } from "./fixtures/resident.js";
import assert from "node:assert/strict";
import { withScenario, type Scenario } from "./fixtures/scenario.js";
import { call, text, tools, toolResults, lastUserText, type Reply } from "./fixtures/scripted-provider.js";
import { readSettings, writeSettings } from "#oma-test/app/application/settings";
import { resolvedSpecOf } from "@oma/domain/agent-spec";

const create = "printf 'Review the implementation independently.\\n' > brief.txt && oma agent create peer --from HEAD --file brief.txt --request delegate-peer";

/** Newly created peers really start. Route their initial brief independently
 * so concurrent engines cannot consume each other's scripted replies. */
function delegationScript(s: Scenario, parent: readonly Reply[]): void {
  let next = 0, peer = 0;
  s.script(request => {
    const accepted = s.store.getOperation("worker-a", "delegate-peer");
    const initial = accepted?.kind === "agent.create" ? accepted.plan.initialMessage : null;
    if (initial && lastUserText(request).includes(initial.id))
      return peer++ === 0 ? tools(call("oma_mail_read", { messageId: "/inbox.md" })) : text("Initial brief received.");
    return parent[next++] ?? text("Parent turn complete.");
  });
}

test("DR27: a Worker creates a peer without Principal orchestration, resumes its receipt and receives a reply", RESIDENT_TEST_OPTIONS, async () => {
  await withScenario({ residents: ["worker-a"], confined: true }, async s => {
    s.script([tools(call("oma_mail_send", { to: ["worker-a"], subject: "Goal", body: "Collaborate on the implementation." })), text("Assigned.")]);
    await s.prompt("Ask the Worker to collaborate.");
    delegationScript(s, [tools(call("bash", { command: create })), text("Delegated.")]);
    const run = await s.activate("worker-a"); assert.equal(run.code, 0, run.stderr);
    const accepted = s.store.getOperation("worker-a", "delegate-peer");
    assert.ok(accepted, toolResults(s.provider.seen.at(-1)!.body).at(-1)?.text ?? "no tool result");
    assert.equal(accepted.kind, "agent.create"); assert.equal(accepted.state, "succeeded");
    assert.equal(s.store.getAgent("peer")!.createdBy, "worker-a");
    assert.deepEqual(resolvedSpecOf(s.store.getAgent("peer")!).capabilities, [...resolvedSpecOf(s.store.getAgent("worker-a")!).capabilities].sort());
    assert.equal(s.operations("principal").some(row => row.kind === "agent.create"), false);
    const finished = await s.residentFinished("peer"); assert.equal(finished.execMainStatus, 0, JSON.stringify(finished));
    assert.ok(accepted.plan.initialMessage);
    const initialId = accepted.plan.initialMessage.id;
    const mail = s.store.getDelivery(initialId, "peer"); assert.equal(mail?.materialized, 1); assert.equal(mail?.presented, 1);
    const archived = s.archived(initialId), planJson = accepted.planJson;
    const observed = resolvedSpecOf(s.store.getAgent("peer")!);
    // A later host narrowing cannot rewrite the accepted child or its retry.
    const config = readSettings(s.configPath).config;
    writeSettings(s.configPath, { ...config, agentProfiles: { ...config.agentProfiles,
      resident: { ...config.agentProfiles.resident!, delegable: [] } } });
    await s.restartBroker();
    s.script([tools(call("oma_mail_send", { to: ["worker-a"], subject: "Confirm", body: "Query the original request." })), text("Requested.")]);
    await s.prompt("Ask for the original delegation receipt.");
    s.script([tools(call("bash", { command: create })),
      tools(call("oma_mail_send", { to: ["peer"], subject: "Review", body: "Send the review result.", request: "review-follow-up" })),
      text("Original receipt recovered.")]);
    const again = await s.activate("worker-a"); assert.equal(again.code, 0, again.stderr);
    assert.match(toolResults(s.provider.seen.at(-1)!.body).at(-1)!.text, /succeeded/);
    assert.equal(s.store.getOperation("worker-a", "delegate-peer")!.id, accepted.id);
    assert.deepEqual(s.store.getDelivery(initialId, "peer"), mail);
    assert.equal(s.store.getOperation("worker-a", "delegate-peer")!.planJson, planJson);
    assert.equal(s.archived(initialId), archived);
    assert.deepEqual(resolvedSpecOf(s.store.getAgent("peer")!), observed);
    s.script([tools(call("oma_mail_read", { messageId: "/inbox.md" })),
      tools(call("oma_mail_send", { to: ["worker-a"], subject: "Review", body: "Review completed.", kind: "result" })), text("Replied.")]);
    const peer = await s.activate("peer"); assert.equal(peer.code, 0, peer.stderr);
    assert.equal(s.store.pendingDeliveries("peer").length, 0);
    assert.equal(s.store.pendingDeliveries("worker-a").length, 1);
    assert.equal(s.operations("peer").filter(row => row.kind === "mail.send").length, 1);
  });
});

test("DR27: legacy quotas do not block a Worker creating a peer", RESIDENT_TEST_OPTIONS, async () => {
  await withScenario({ residents: ["worker-a"], confined: true }, async s => {
    const config = readSettings(s.configPath).config;
    writeSettings(s.configPath, { ...config, limits: { ...config.limits, logBytes: 1 } });
    await s.restartBroker();
    s.script([tools(call("oma_mail_send", { to: ["worker-a"], subject: "Work", body: "Try collaborating." })), text("Assigned.")]);
    await s.prompt("Ask for work.");
    delegationScript(s, [tools(call("bash", { command: create })), text("Peer created.")]);
    const run = await s.activate("worker-a"); assert.equal(run.code, 0, run.stderr);
    assert.doesNotMatch(toolResults(s.provider.seen.at(-1)!.body).at(-1)!.text, /QUOTA_EXCEEDED/);
    assert.equal(s.store.getOperation("worker-a", "delegate-peer")?.state, "succeeded");
    assert.ok(s.store.getAgent("peer"));
    const finished = await s.residentFinished("peer"); assert.equal(finished.execMainStatus, 0, JSON.stringify(finished));
    const accepted = s.store.getOperation("worker-a", "delegate-peer");
    assert.ok(accepted?.kind === "agent.create" && accepted.plan.initialMessage);
    assert.equal(s.store.getDelivery(accepted.plan.initialMessage.id, "peer")?.materialized, 1);
    assert.equal(s.store.getDelivery(accepted.plan.initialMessage.id, "peer")?.presented, 1);
  });
});
