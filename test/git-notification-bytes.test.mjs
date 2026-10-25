import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@oma/storage";
import { buildEml } from "@oma/mail/serialize";
import { generateOperationId } from "@oma/native/identity";
import { messageIdForOperation } from "@oma/domain/derived";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import { makeValidAgent } from "../dist/test/fixtures/spec.js";

for (const kind of ["result", "context"]) {
  test(`DR46 Git ${kind}: notification port preserves the original exact MIME recipe`, async t => {
    const root = mkdtempSync(join(tmpdir(), "oma-git-mail-bytes-"));
    const store = new Store(join(root, "runtime.sqlite"));
    t.after(() => { try { store.close(); } finally { rmSync(root, { recursive: true, force: true }); } });
    store.transaction(tx => tx.insertAgent(makeValidAgent("alice")));
    const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 64);
    const id = messageIdForOperation(generateOperationId(), 0), dateMs = 1730000000000;
    t.mock.method(Date, "now", () => dateMs);
    const to = kind === "result" ? ["alice", "commons", "topic/release"] : ["residents"];
    const contextRevision = kind === "context" ? "1".repeat(40) : null;
    const body = "\ufeffexact body\nsecond line without final LF";
    const subject = "  exact  subject =?literal?=";
    // The literal RFC options are the former submit/context call-site recipe.
    const expected = await buildEml({ from: "alice@demo.oma.invalid",
      to: kind === "result" ? ["alice@demo.oma.invalid", "commons@demo.oma.invalid", "topic-release@demo.oma.invalid"] : ["residents@demo.oma.invalid"],
      replyTo: kind === "result" ? ["commons@demo.oma.invalid", "topic-release@demo.oma.invalid"] : ["residents@demo.oma.invalid"],
      messageId: `${id}@demo.oma.invalid`, kind, contextRevision, subject, body,
      inReplyTo: null, references: [] });
    const frozen = await mail.freezeNotification(id, "alice", { to, kind, contextRevision, subject, body });
    assert.equal(readFileSync(mail.objectPath(id), "utf8"), expected.text);
    assert.equal(frozen.message.sha256, expected.sha256);
    assert.equal(frozen.message.bytes, expected.bytes);
    assert.equal(frozen.message.dateMs, expected.dateMs);
    assert.deepEqual(frozen.message.recipients, []);
    assert.deepEqual(frozen.message.to, to);
    assert.deepEqual(frozen.message.replyHeaders.replyTo, kind === "result" ? ["commons", "topic/release"] : ["residents"]);
    frozen.artifact.discardUnaccepted();
  });
}
