import test from "node:test";
import assert from "node:assert/strict";
import { selectBatch, batchViewOf } from "@oma/mail/batch-policy";
const pending = [
    { value: "public-old", publicList: true },
    { value: "direct-old", publicList: false },
    { value: "public-new", publicList: true },
    { value: "direct-new", publicList: false },
    { value: "public-last", publicList: true },
];
test("R24: the existing two-class policy preserves oldest order and direct/public alternation", () => {
    assert.deepEqual(selectBatch(pending, 4), ["direct-old", "public-old", "direct-new", "public-new"]);
    assert.deepEqual(selectBatch(pending, 5), ["direct-old", "public-old", "direct-new", "public-new", "public-last"]);
    assert.deepEqual(selectBatch(pending.filter(value => value.publicList), 2), ["public-old", "public-new"]);
    assert.deepEqual(selectBatch([], 2), []);
    assert.throws(() => selectBatch(pending, 1), { code: "UNSUPPORTED_PROFILE" });
    assert.deepEqual(pending.map(value => value.value), ["public-old", "direct-old", "public-new", "direct-new", "public-last"]);
});
test("G02-ledger-r2: bounded selection preserves both classes across a long leading backlog", () => {
    for (const leadingPublic of [true, false]) {
        let visited = 0;
        let closed = false;
        function* backlog() {
            try {
                for (let i = 0; i < 10000; i++) {
                    visited++;
                    yield { value: `leading-${i}`, publicList: leadingPublic };
                }
                for (let i = 0; i < 4; i++) {
                    visited++;
                    yield { value: `trailing-${i}`, publicList: !leadingPublic };
                }
                throw new Error("selection must stop once both classes have enough rows");
            }
            finally {
                closed = true;
            }
        }
        assert.deepEqual(selectBatch(backlog(), 4), leadingPublic
            ? ["trailing-0", "leading-0", "trailing-1", "leading-1"]
            : ["leading-0", "trailing-0", "leading-1", "trailing-1"]);
        assert.equal(visited, 10004);
        assert.equal(closed, true, "early termination closes the underlying ledger iterator");
    }
    for (const maximum of [0, -1, NaN, Infinity, 1.5])
        assert.throws(() => selectBatch([], maximum), { code: "UNSUPPORTED_PROFILE" });
});
test("R24: the extension projection has six fields and never publishes host session or index paths", () => {
    const batch = {
        id: "12345678-1234-4234-8234-123456789abc", agent: "alice", incarnation: 1,
        messageIds: ["m-12345678-1234-4234-8234-123456789abc-0"],
        sessionPath: "/private/session.jsonl", indexPath: "/inbox.md", deliveryMode: "followUp", notice: "notice",
    };
    const view = batchViewOf(batch);
    assert.deepEqual(Object.keys(view), ["id", "agent", "incarnation", "deliveryMode", "notice", "messageIds"]);
    assert.equal("sessionPath" in view, false);
    assert.equal("indexPath" in view, false);
    assert.equal(JSON.stringify(view).includes("/private"), false);
    assert.deepEqual(view.messageIds, batch.messageIds);
    assert.notEqual(view.messageIds, batch.messageIds);
    view.messageIds.length = 0;
    assert.equal(batch.messageIds.length, 1);
});
