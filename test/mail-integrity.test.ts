import { serializePlanIntent } from "./fixtures/plan.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, linkSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "@oma/storage";
import { StoreError } from "@oma/domain/errors";
import * as productionMail from "@oma/mail";
import { gitFixture, gitAuth, seedGit } from "./fixtures/git-crash.js";
import { ALL_CAPS, resolvedSpec, storedSpec } from "./fixtures/spec.js";
import { sendWithStop } from "./fixtures/mail-faults.js";
import { overwritePublished, removeTree } from "./fixtures/cleanup.js";
import { corruptOperationForTest, readRawDeliveryFlag } from "./fixtures/corruption.js";

for (const gated of [false, true]) {
  test(`MAIL-007/008: ${gated ? "gated" : "ordinary"} publication verifies source, existing destinations and frozen metadata`, async () => {
    for (const fault of ["source", "new", "cur", "symlink", "dangling", "plan"]) {
      const root = mkdtempSync(join(tmpdir(), "oma-mail-integrity-"));
      const store = new Store(join(root, "runtime.sqlite"));
      try {
        store.transaction(() => {
          for (const name of ["a", "b"]) store.insertAgent({ name, role: "resident", profile: "p", desired: "enabled", incarnation: 1, ...storedSpec(ALL_CAPS, "p", name), createdBy: null });
        });
        const { mail, git } = gitFixture(root, store);
        assert.equal(Object.hasOwn(productionMail, "StopSignal"), false, "COMP-006: no production fault-signal export");
        assert.equal("stopAfter" in mail, false, "COMP-006: no production stop-point field");
        const publish = gated ? mail.publishGated.bind(mail) : mail.materialize.bind(mail);
        if (gated) {
          seedGit(root);
          const info = JSON.parse(readFileSync(join(root, "git-fixture.json"), "utf8"));
          mail.publishGated = async () => { throw new Error("publication paused"); };
          // The gated publication never completes as a success; the coordinator
          // reports either its own closed failure or the unproven ref state.
          await assert.rejects(git.submit(gitAuth, "original", { candidate: info.base, exportRef: info.exportRef, prerequisites: [], to: ["b"], subject: "candidate", body: "body", paths: [] }, (async function* () {})()),
            (error: unknown) => error instanceof StoreError
              && ["REF_STATE_UNKNOWN", "STORE_CORRUPT", "INTERNAL_ERROR"].includes(error.code));
        } else {
          await assert.rejects(sendWithStop(mail, store, gitAuth, "original", { to: ["b"], subject: "original", kind: "message", body: "body" }, "accepted"));
        }
        const operation = store.getOperation("a", "original")!;
        const plan = JSON.parse(operation.planJson).intent;
        const id = plan.message.id;
        const object = mail.objectPath(id);
        const bad = Buffer.from(readFileSync(object));
        bad[0] = bad[0]! ^ 1;
        const target = fault === "new" ? mail.inboxNewPath("b", id) : mail.inboxCurPath("b", id);
        mkdirSync(dirname(target), { recursive: true });
        if (fault === "plan") {
          // Accepted plan bytes are immutable through the Store API, so this
          // boundary violation uses the explicit raw corruption fixture.
          delete plan.message.sha256;
          corruptOperationForTest(join(root, "runtime.sqlite"), operation.id, "plan_json", serializePlanIntent(plan));
        } else if (fault === "source") overwritePublished(object, bad);
        else if (fault === "symlink" || fault === "dangling") symlinkSync(fault === "symlink" ? object : join(root, "missing"), target);
        else writeFileSync(target, bad);
        await assert.rejects(publish(operation.id),
          (error: unknown) => error instanceof StoreError && ["STORE_CORRUPT", "REF_STATE_UNKNOWN"].includes(error.code));
        if (fault === "plan") {
          // Corrupt accepted bytes stay unreadable, and the durable delivery row
          // is unchanged: the raw read is the only way to observe it, because the
          // Store API rejects the operation it belongs to.
          assert.throws(() => store.getDelivery(id, "b"),
            (error: unknown) => error instanceof StoreError && error.code === "STORE_CORRUPT");
          assert.equal(readRawDeliveryFlag(join(root, "runtime.sqlite"), id, "b"), 0, fault);
        } else assert.equal(store.getDelivery(id, "b")!.materialized, 0, fault);
      } finally { store.close(); removeTree(root); }
    }
  });
}

test("MAIL-005/008: replies and batch preparation reject corrupt originals; duplicate hardlinks drain", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-mail-original-"));
  const store = new Store(join(root, "runtime.sqlite"));
  try {
    store.transaction(() => {
      for (const name of ["a", "b"]) store.insertAgent({ name, role: "resident", profile: "p", desired: "enabled", incarnation: 1, ...storedSpec(ALL_CAPS, "p", name), createdBy: null });
    });
    const { mail } = gitFixture(root, store);
    await mail.send(gitAuth, "original", { to: ["b"], subject: "original", kind: "message", body: "body" });
    const plan = JSON.parse(store.getOperation("a", "original")!.planJson).intent;
    const id = plan.message.id;
    const object = mail.objectPath(id);
    const original = readFileSync(object);
    const corrupt = Buffer.from(original); corrupt[corrupt.length - 1] = corrupt[corrupt.length - 1]! ^ 1;
    overwritePublished(object, corrupt);
    await assert.rejects(mail.send(gitAuth, "reply", { to: ["b"], subject: "reply", kind: "message", body: "body", replyToMessage: id }), { code: "STORE_CORRUPT" });
    await assert.rejects(mail.prepare({ ...gitAuth, actor: "b" }), { code: "STORE_CORRUPT" });
    assert.equal(store.getOperation("a", "reply"), null);
    assert.equal(store.preparedBatches("b").length, 0);
    overwritePublished(object, original);
    const current = mail.inboxCurPath("b", id);
    mkdirSync(dirname(current), { recursive: true });
    linkSync(object, current);
    mail.moveToCur("b", [id]);
    assert.equal(existsSync(mail.inboxNewPath("b", id)), false);
    assert.deepEqual(readFileSync(current), original);
  } finally { store.close(); removeTree(root); }
});

test("mail-v1: a worker-audience message publishes only under mail/workers and reaches each recipient inbox", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-mail-workers-"));
  const store = new Store(join(root, "runtime.sqlite"));
  try {
    store.transaction(() => {
      for (const name of ["principal", "alice", "bob"])
        store.insertAgent({ name, role: name === "principal" ? "principal" : "resident", profile: "p",
          desired: "enabled", incarnation: 1, ...storedSpec(ALL_CAPS, "p", name), createdBy: null });
    });
    const { mail } = gitFixture(root, store);
    const { generateOperationId } = await import("@oma/native/identity");
    const { messageIdForOperation: generateMessageId } = await import("@oma/domain/derived");
    const { reviewRequestNameFor } = await import("@oma/domain/identifiers");
    const { requestHash } = await import("@oma/domain/request-identity");
    const { mailObjectPathAt, mailArchivePathAt, mailWorkersPathAt, mailInboxPathAt } = await import("@oma/domain/paths");
    const { ensureDurableDirectory, writeExclusiveFsyncedFile } = await import("@oma/storage/durable-fs");
    const { buildEml } = await import("@oma/mail/serialize");
    const operationId = generateOperationId();
    const name = reviewRequestNameFor("merge", operationId);
    const messageId = generateMessageId(operationId, 0);
    const eml = await buildEml({ from: "alice@crash.oma.invalid", to: ["residents@crash.oma.invalid"],
      replyTo: ["alice@crash.oma.invalid"], subject: "review", body: "review thread", kind: "message",
      contextRevision: null, inReplyTo: null, references: [], messageId: `${messageId}@crash.oma.invalid` });
    const message = { id: messageId, objectPath: `mail/objects/${messageId}.eml`, sha256: eml.sha256,
      bytes: eml.bytes, dateMs: eml.dateMs, to: ["residents"], recipients: ["alice", "bob"], kind: "message" as const,
      contextRevision: null, replyHeaders: { replyTo: ["alice"], inReplyTo: null, references: [] },
      audience: "workers" as const,
      review: { role: "thread" as const, request: operationId, name, revision: 0 } };
    const candidate = "2".repeat(40), base = "1".repeat(40);
    const fact = { kind: "merge.open" as const, version: 1, name, title: "Fix", reason: "needed",
      tier: "MEDIUM" as const,
      identity: { repo: "project", targetRef: "refs/heads/main", expectedBase: base, candidate, policyRevision: "p1" },
      submitters: ["alice"] };
    const payload = { kind: "merge.open", tier: "MEDIUM", title: "Fix", reason: "needed", candidate, base };
    ensureDurableDirectory(join(root, "mail", "objects"));
    writeExclusiveFsyncedFile(mailObjectPathAt(root, messageId), Buffer.from(eml.text, "utf8"), 0o444);
    store.transaction(tx => {
      assert.equal(tx.acceptOperation({ id: operationId, actor: "alice", requestKey: `review-${operationId}`,
        requestHash: requestHash("attest.record", payload), kind: "attest.record",
        payloadJson: JSON.stringify(payload),
        planJson: serializePlanIntent({ kind: "attest.record", fact, messages: [message] }) }), "inserted");
      tx.insertDeliveries([
        { messageId, recipient: "alice", operationId },
        { messageId, recipient: "bob", operationId },
      ]);
    });
    // The workers archive exists on any provisioned root; provision runs before
    // a broker touches mail.
    mkdirSync(join(root, "mail", "workers", "cur"), { recursive: true });
    await mail.materialize(operationId);
    assert.equal(existsSync(mailWorkersPathAt(root, messageId)), true);
    assert.equal(existsSync(mailArchivePathAt(root, messageId)), false,
      "worker mail never lands in the public archive");
    for (const recipient of ["alice", "bob"]) {
      assert.equal(existsSync(mailInboxPathAt(root, recipient, messageId, "new")), true);
      assert.equal(store.getDelivery(messageId, recipient)?.materialized, 1);
    }
  } finally { store.close(); removeTree(root); }
});
