/** RUN-003: wait control cannot be substituted for durable delivery evidence. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerDelivery, PI_WAIT_PREFIX, PI_WAIT_OBSERVATION_PREFIX } from "../src/extension/delivery.js";
import { boundaryOf, waitOf, waitObservationOf } from "../src/runtime/pi-adapter.js";
import { PI_ADAPTER_REVISION } from "../src/storage/delivery-receipt.js";
import type { PreparedBatch } from "../implementation/contracts.js";
const batch: PreparedBatch = { id: "b-00000000-0000-4000-8000-000000000001", agent: "alice", incarnation: 1,
  messageIds: [], sessionPath: null, deliveryMode: "followUp", notice: "mail", indexPath: "/inbox.md" };

test("DR27: wait decoder is exact and a wait notice is never a delivery boundary", () => {
  const good = { adapterRevision: PI_ADAPTER_REVISION, batchId: batch.id, incarnation: batch.incarnation };
  const event = (value: unknown) => ({ type: "extension_ui_request", method: "notify", message: PI_WAIT_PREFIX + JSON.stringify(value) });
  assert.equal(waitOf(event(good), batch), true);
  assert.equal(boundaryOf(event(good), batch), null);
  for (const phase of ["begin", "end", "failed"] as const) {
    const notice = { ...event(good), message: PI_WAIT_OBSERVATION_PREFIX + JSON.stringify({ ...good, phase }) };
    assert.equal(waitObservationOf(notice, batch), phase);
    assert.equal(waitOf(notice, batch), false);
    assert.equal(boundaryOf(notice, batch), null);
    for (const raw of [null, [], good, { ...good, phase: "unknown" }, { ...good, phase, extra: true },
      { ...good, phase, incarnation: 0 }, { ...good, phase, batchId: "other" }, { ...good, phase, adapterRevision: "other" }])
      assert.equal(waitObservationOf({ ...notice, message: PI_WAIT_OBSERVATION_PREFIX + JSON.stringify(raw) }, batch), null);
    assert.equal(waitObservationOf({ ...notice, message: PI_WAIT_OBSERVATION_PREFIX + "{" }, batch), null);
    assert.equal(waitObservationOf({ ...notice, method: "select" }, batch), null);
    assert.equal(waitObservationOf({ ...notice, type: "message_end" }, batch), null);
  }
  for (const value of [null, [], {}, { ...good, incarnation: 0 }, { ...good, batchId: "other" },
    { ...good, adapterRevision: "other" }, { ...good, entryId: "0123abcd" }])
    assert.equal(waitOf(event(value), batch), false);
  assert.equal(waitOf({ ...event(good), method: "select" }, batch), false);
  assert.equal(waitOf({ ...event(good), type: "message_end" }, batch), false);
  assert.equal(waitOf({ ...event(good), message: PI_WAIT_PREFIX + "{" }, batch), false);
});

for (const result of [false, true, "error"] as const) test(`DR27: persisted tool boundary observes wait=${result}`, async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-wait-hook-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, value] of Object.entries({ OMA_BATCH_VIEW: root, OMA_FRAME_BYTES: "65536", OMA_BATCH_MAX_MESSAGES: "24" })) {
    const old = process.env[name]; process.env[name] = value;
    t.after(() => { if (old === undefined) delete process.env[name]; else process.env[name] = old; });
  }
  writeFileSync(join(root, `batch-${batch.id}.json`), JSON.stringify({ id: batch.id, agent: batch.agent,
    incarnation: batch.incarnation, messageIds: batch.messageIds, deliveryMode: batch.deliveryMode, notice: batch.notice }));
  // Explicit extension boundary fixture, not an engine persistence proof.
  type Hook = (event: any, ctx: any) => unknown;
  const hooks = new Map<string, Hook>();
  let command!: (args: string, ctx: any) => Promise<void>;
  const notices: string[] = []; const entries: string[] = [];
  let aborted = 0; let observations = 0;
  const pi = { on: (name: string, hook: Hook) => hooks.set(name, hook),
    registerCommand: (_name: string, definition: { handler: typeof command }) => { command = definition.handler; },
    sendMessage: async () => {}, appendEntry: (name: string) => { entries.push(name); } } as unknown as ExtensionAPI;
  registerDelivery(pi, async () => { observations++; if (result === "error") throw new Error("broker unavailable"); return result; });
  const ctx = { abort: () => { aborted++; }, ui: { notify: (message: string) => notices.push(message) },
    sessionManager: { getSessionFile: () => join(root, "session.jsonl"),
      getLeafEntry: () => ({ type: "custom", customType: entries.at(-1), id: "0123abcd" }) } };
  await command(batch.id, ctx);
  await hooks.get("turn_end")!({ toolResults: [] }, ctx);
  assert.equal(observations, 0);
  await hooks.get("message_end")!({ message: { role: "assistant", stopReason: "toolUse" } }, ctx);
  assert.equal(observations, 0, "no observation before persisted tool results");
  await hooks.get("turn_end")!({ toolResults: [{}], toolResultEntryIds: ["0123abcd"] }, ctx);
  assert.equal(observations, 1);
  assert.equal(aborted, result === false ? 0 : 1);
  // Even a later terminal stop cannot turn a wait/unknown into delivery success.
  await hooks.get("message_end")!({ message: { role: "assistant", stopReason: "stop" } }, ctx);
  await hooks.get("agent_settled")!({}, ctx);
  assert.deepEqual(entries, result === false ? ["oma-delivery-boundary"] : []);
  assert.equal(notices.some(message => message.startsWith(PI_WAIT_PREFIX)), result === true);
  assert.deepEqual(notices.filter(message => message.startsWith(PI_WAIT_OBSERVATION_PREFIX))
    .map(message => JSON.parse(message.slice(PI_WAIT_OBSERVATION_PREFIX.length)).phase),
    ["begin", result === "error" ? "failed" : "end"]);
  if (result === "error") assert.ok(notices.some(message => message.includes("unconfirmed")));
  const count = notices.length;
  await hooks.get("agent_settled")!({}, ctx);
  assert.equal(notices.length, count, "settle consumes only this engine's pending attempt");
});
