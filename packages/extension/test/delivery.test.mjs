import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerDelivery } from "@oma/extension/delivery";
import { PI_WAIT_PREFIX, PI_WAIT_OBSERVATION_PREFIX } from "@oma/protocol/delivery-boundary";
const batch = { id: "b-00000000-0000-4000-8000-000000000001", agent: "alice", incarnation: 1,
    messageIds: [], sessionPath: null, deliveryMode: "followUp", notice: "mail", indexPath: "/inbox.md" };
for (const result of [false, true, "error"])
    test(`001. Persisted tool boundary observes wait=${result}`, async (t) => {
        const root = mkdtempSync(join(tmpdir(), "oma-wait-hook-"));
        t.after(() => rmSync(root, { recursive: true, force: true }));
        for (const [name, value] of Object.entries({ OMA_BATCH_VIEW: root, OMA_FRAME_BYTES: "65536", OMA_BATCH_MAX_MESSAGES: "24" })) {
            const old = process.env[name];
            process.env[name] = value;
            t.after(() => { if (old === undefined)
                delete process.env[name];
            else
                process.env[name] = old; });
        }
        writeFileSync(join(root, `batch-${batch.id}.json`), JSON.stringify({ id: batch.id, agent: batch.agent,
            incarnation: batch.incarnation, messageIds: batch.messageIds, deliveryMode: batch.deliveryMode, notice: batch.notice }));
        const hooks = new Map();
        let command;
        const notices = [];
        const entries = [];
        let aborted = 0;
        let observations = 0;
        const pi = { on: (name, hook) => hooks.set(name, hook),
            registerCommand: (_name, definition) => { command = definition.handler; },
            sendMessage: async () => { }, appendEntry: (name) => { entries.push(name); } };
        registerDelivery(pi, async () => { observations++; if (result === "error")
            throw new Error("broker unavailable"); return result; });
        const ctx = { abort: () => { aborted++; }, ui: { notify: (message) => notices.push(message) },
            sessionManager: { getSessionFile: () => join(root, "session.jsonl"),
                getLeafEntry: () => ({ type: "custom", customType: entries.at(-1), id: "0123abcd" }) } };
        await command(batch.id, ctx);
        await hooks.get("turn_end")({ toolResults: [] }, ctx);
        assert.equal(observations, 0);
        await hooks.get("message_end")({ message: { role: "assistant", stopReason: "toolUse" } }, ctx);
        assert.equal(observations, 0, "no observation before persisted tool results");
        await hooks.get("turn_end")({ toolResults: [{}], toolResultEntryIds: ["0123abcd"] }, ctx);
        assert.equal(observations, 1);
        assert.equal(aborted, result === false ? 0 : 1);
        // Even a later terminal stop cannot turn a wait/unknown into delivery success.
        await hooks.get("message_end")({ message: { role: "assistant", stopReason: "stop" } }, ctx);
        await hooks.get("agent_settled")({}, ctx);
        assert.deepEqual(entries, result === false ? ["oma-delivery-boundary"] : []);
        assert.equal(notices.some(message => message.startsWith(PI_WAIT_PREFIX)), result === true);
        assert.deepEqual(notices.filter(message => message.startsWith(PI_WAIT_OBSERVATION_PREFIX))
            .map(message => JSON.parse(message.slice(PI_WAIT_OBSERVATION_PREFIX.length)).phase), ["begin", result === "error" ? "failed" : "end"]);
        if (result === "error")
            assert.ok(notices.some(message => message.includes("unconfirmed")));
        const count = notices.length;
        await hooks.get("agent_settled")({}, ctx);
        assert.equal(notices.length, count, "settle consumes only this engine's pending attempt");
    });

for (const state of ['idle', 'busy', 'pending', 'send-unknown']) test(`002. Preflight ${state} emits never-started proof only when engine idleness is known`, async t => {
  const root = mkdtempSync(join(tmpdir(), 'oma-preflight-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, value] of Object.entries({ OMA_BATCH_VIEW: root, OMA_FRAME_BYTES: '65536', OMA_BATCH_MAX_MESSAGES: '24' })) {
    const old = process.env[name]; process.env[name] = value;
    t.after(() => { if (old === undefined) delete process.env[name]; else process.env[name] = old; });
  }
  const { PI_DELIVERY_NOT_STARTED_PREFIX, deliveryNotStartedOf } = await import('@oma/protocol/delivery-boundary');
  if (state === 'pending' || state === 'send-unknown') writeFileSync(join(root, `batch-${batch.id}.json`), JSON.stringify({ id: batch.id, agent: batch.agent, incarnation: batch.incarnation, messageIds: [], deliveryMode: batch.deliveryMode, notice: batch.notice }));
  let handler, sends = 0; const notices = [];
  registerDelivery({ on() {}, registerCommand(_name, definition) { handler = definition.handler; }, sendMessage() { sends++; if (state === 'send-unknown') throw new Error('ambiguous send'); } });
  const ctx = { isIdle: () => state !== 'busy', ui: { notify: message => notices.push(message) } };
  if (state === 'send-unknown') await assert.rejects(handler(batch.id, ctx), /ambiguous send/);
  else await handler(batch.id, ctx);
  if (state === 'pending' || state === 'send-unknown') await handler(batch.id, ctx);
  const proof = notices.filter(message => message.startsWith(PI_DELIVERY_NOT_STARTED_PREFIX));
  assert.equal(proof.length, state === 'idle' ? 1 : 0);
  if (proof.length) assert.deepEqual(deliveryNotStartedOf({ type: 'extension_ui_request', method: 'notify', message: proof[0] }), { batchId: batch.id, reason: 'invalid-batch' });
  assert.equal(sends, state === 'pending' || state === 'send-unknown' ? 1 : 0);
});

test("003. An idle preflight read-close error preserves its failure and supplies correlated never-started proof", async t => {
  const root = mkdtempSync(join(tmpdir(), 'oma-preflight-close-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, value] of Object.entries({ OMA_BATCH_VIEW: root, OMA_FRAME_BYTES: '65536', OMA_BATCH_MAX_MESSAGES: '24' })) {
    const old = process.env[name]; process.env[name] = value;
    t.after(() => { if (old === undefined) delete process.env[name]; else process.env[name] = old; });
  }
  writeFileSync(join(root, `batch-${batch.id}.json`), JSON.stringify({ id: batch.id, agent: batch.agent, incarnation: batch.incarnation, messageIds: [], deliveryMode: batch.deliveryMode, notice: batch.notice }));
  const { deliveryNotStartedOf } = await import('@oma/protocol/delivery-boundary');
  let handler, sends = 0; const notices = [];
  registerDelivery({ on() {}, registerCommand(_name, definition) { handler = definition.handler; }, sendMessage() { sends++; } });
  const close = fs.closeSync; let armed = true;
  try {
    fs.closeSync = fd => { close(fd); if (armed) { armed = false; throw new Error('injected read-close failure'); } }; syncBuiltinESMExports();
    await assert.rejects(handler(batch.id, { isIdle: () => true, ui: { notify: message => notices.push(message) } }), /injected read-close failure/);
  } finally { fs.closeSync = close; syncBuiltinESMExports(); }
  assert.equal(sends, 0); assert.equal(notices.length, 1);
  assert.deepEqual(deliveryNotStartedOf({ type: 'extension_ui_request', method: 'notify', message: notices[0] }), { batchId: batch.id, reason: 'invalid-batch' });
});
