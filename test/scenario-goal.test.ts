/** DR27: GOAL through the real Principal engine, typed tool and authenticated broker. */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withScenario } from "./fixtures/scenario.js";
import { call, text, tools, toolResults } from "./fixtures/scripted-provider.js";
import { readableBody } from "@oma/mail/display";

const goal = (body: string, expectedRevision: string | null, request: string) => tools(call("oma_goal", { content: { kind: "text", value: body }, expectedRevision }, request));
test("001. Principal publishes exact GOAL bytes, retries after restart, and receives a stale-revision refusal", { timeout: 120_000 }, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    const body = "﻿# Goal\nKeep bytes\r\nNo final newline";
    s.script([goal(body, null, "goal"), text("Published.")]); await s.prompt("Publish the shared goal.");
    const firstKey = JSON.parse(toolResults(s.provider.seen.at(-1)!.body).at(-1)!.text).invocation.key;
    const first = s.store.getOperation("principal", firstKey); assert.ok(first?.kind === "context.publish"); assert.equal(first.state, "succeeded");
    assert.equal(readFileSync(join(s.root, "world/context/current/GOAL.md"), "utf8"), body);
    const archived = s.archived(first.plan.message.id); assert.equal(readableBody(archived), body);
    const offered = s.provider.seen[0]!.body.tools!.map(tool => tool.function?.name);
    assert.ok(offered.includes("oma_goal"));
    for (const tool of ["write", "replace", "bash", "oma_context_publish", "oma_status", "oma_mail_ack", "oma_agent_create"]) assert.ok(!offered.includes(tool), tool);
    await s.restartBroker(); await s.restartEngine();
    s.script([tools(call("read", { path: join(s.root, "agents/principal/records/receipts/index.md"), offset: 1, limit: 2000 })), text("Original receipt.")]); await s.prompt("Look up the earlier goal request.");
    assert.equal(s.store.getOperation("principal", firstKey)!.planJson, first.planJson);
    assert.equal(s.archived(first.plan.message.id), archived); assert.equal(s.store.pendingDeliveries("worker-a").length, 1);
    assert.match(toolResults(s.provider.seen.at(-1)!.body).at(-1)!.text, /Invocations: 1/);
    s.script([goal("stale", null, "stale"), text("Revision conflict.")]); await s.prompt("Try the old base with a fresh request.");
    assert.match(toolResults(s.provider.seen.at(-1)!.body).at(-1)!.text, /CONTEXT_CONFLICT/);
    assert.equal(s.store.getOperation("principal", "stale"), null);
    assert.equal(readFileSync(join(s.root, "world/context/current/GOAL.md"), "utf8"), body);
    assert.equal(s.store.pendingDeliveries("worker-a").length, 1);
    s.script([goal("next\n", first.plan.candidate, "next"), text("Updated.")]); await s.prompt("Update against the exact revision.");
    const next = JSON.parse(toolResults(s.provider.seen.at(-1)!.body).at(-1)!.text).receipt;
    assert.equal(next.state, "succeeded");
    assert.equal(s.store.getOperationById(next.operation)!.kind, "context.publish");
    assert.equal(readFileSync(join(s.root, "world/context/current/GOAL.md"), "utf8"), "next\n");
  });
});

test("002. Oversized explicit GOAL is refused without accepted intent or mail", { timeout: 120_000 }, async () => {
  await withScenario({ residents: ["worker-a"] }, async s => {
    s.script([goal("x".repeat(262145), null, "oversized"), text("Too large.")]); await s.prompt("Publish this oversized goal.");
    const result = s.events.find(event => event.type === "tool_execution_end" && event.toolCallId === "oversized");
    assert.equal(result?.isError, true, "the oversized publication is a failed typed tool call");
    assert.equal(s.store.getOperation("principal", "oversized"), null); assert.equal(s.store.pendingDeliveries("worker-a").length, 0);
    assert.equal(existsSync(join(s.root, "world/context/current/GOAL.md")), false);
  });
});
