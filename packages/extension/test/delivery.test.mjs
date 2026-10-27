import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerDelivery } from "@oma/extension/delivery";
import { PI_WAIT_PREFIX, PI_WAIT_OBSERVATION_PREFIX } from "@oma/protocol/delivery-boundary";
const batch = { id: "b-00000000-0000-4000-8000-000000000001", agent: "alice", incarnation: 1,
    messageIds: [], sessionPath: null, deliveryMode: "followUp", notice: "mail", indexPath: "/inbox.md" };
for (const result of [false, true, "error"])
    test(`DR27: persisted tool boundary observes wait=${result}`, async (t) => {
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
