/** DR27: GOAL through the real Principal engine, extension, CLI and authenticated broker. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { withScenario } from "./fixtures/scenario.js";
import { call, text, tools, toolResults } from "./fixtures/scripted-provider.js";
import { readableBody } from "@oma/mail/display";

const goal = (body: string, expectedRevision: string, request: string) => tools(call("oma_mail_send", {
  to: ["residents"], subject: "Shared goal", body, intent: "goal", expectedRevision, request,
}));
test("DR27: Principal mails exact GOAL bytes, retries after restart, and receives a stale-revision refusal", { timeout: 120_000 }, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    const body = "﻿# Goal\nKeep bytes\r\nNo final newline";
    s.script([goal(body, "none", "goal"), text("Published.")]); await s.prompt("Publish the shared goal by mail.");
    const first = s.store.getOperation("principal", "goal"); assert.ok(first?.kind === "context.publish"); assert.equal(first.state, "succeeded");
    assert.equal(readFileSync(join(s.root, "world/context/current/GOAL.md"), "utf8"), body);
    const archived = s.archived(first.plan.message.id); assert.equal(readableBody(archived), body);
    const offered = s.provider.seen[0]!.body.tools!.map(tool => tool.function?.name);
    for (const tool of ["write", "edit", "bash", "oma_context_publish", "oma_status", "oma_mail_ack", "oma_agent_create"]) assert.ok(!offered.includes(tool), tool);
    await s.restartBroker(); await s.restartEngine();
    s.script([goal("Changed local text on retry", "none", "goal"), text("Original receipt.")]); await s.prompt("Look up the earlier goal request.");
    assert.equal(s.store.getOperation("principal", "goal")!.planJson, first.planJson);
    assert.equal(s.archived(first.plan.message.id), archived); assert.equal(s.store.pendingDeliveries("worker-a").length, 1);
    assert.match(toolResults(s.provider.seen.at(-1)!.body).at(-1)!.text, /succeeded/);
    s.script([goal("stale", "none", "stale"), text("Revision conflict.")]); await s.prompt("Try the old base with a fresh request.");
    assert.match(toolResults(s.provider.seen.at(-1)!.body).at(-1)!.text, /CONTEXT_CONFLICT/);
    assert.equal(s.store.getOperation("principal", "stale"), null);
    s.script([goal("next\n", first.plan.candidate, "next"), text("Updated.")]); await s.prompt("Update against the exact revision.");
    assert.equal(s.store.getOperation("principal", "next")!.state, "succeeded");
    assert.equal(readFileSync(join(s.root, "world/context/current/GOAL.md"), "utf8"), "next\n");
  });
});

test("DR27: oversized explicit GOAL is refused without accepted intent or mail", { timeout: 120_000 }, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    s.script([goal("x".repeat(262145), "none", "oversized"), text("Too large.")]); await s.prompt("Publish this oversized goal.");
    const result = toolResults(s.provider.seen.at(-1)!.body).at(-1)!.text;
    assert.match(result, /file is larger than a request can carry/);
    assert.equal(s.store.getOperation("principal", "oversized"), null); assert.equal(s.store.pendingDeliveries("worker-a").length, 0);
  });
});
