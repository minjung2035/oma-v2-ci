import { serializePlanIntent } from "../dist/test/fixtures/plan.js";
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, linkSync, unlinkSync, writeFileSync, symlinkSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { physicalLedger } from "./helpers/physical-ledger.mjs";
import { inspectIntegrity } from "#oma-test/app/diagnostics/integrity";
import { NodeIntegrityFiles, FILE_INSPECTION_LIMITS } from "#oma-test/app/diagnostics/files";
import { sha256Hex } from "@oma/domain/canonical-json";
import { publishImmutableFile } from "@oma/storage/immutable-file";
import { writeExclusiveFsyncedFile } from "@oma/storage/durable-fs";
const inspect = (f, overrides = {}) => inspectIntegrity(f.snapshot(), f.context, { files: new NodeIntegrityFiles(), ...overrides });
const has = (report, code) => report.issues.some(issue => issue.code === code);
test("P6 files: accepted pending intent with immutable source is consistent but not complete", t => {
  const f = physicalLedger(t), before = f.store.getOperationById(f.id), report = inspect(f);
  assert.equal(report.status, "PASS", JSON.stringify(report)); assert.equal(report.pendingPublications, 1);
  assert.equal(report.pendingOperations, 1); assert.deepEqual(f.store.getOperationById(f.id), before);
  assert.equal(existsSync(f.archive), false);
});
test("P6 files: post-publication/pre-SQL crash window is not a fabricated failure or success", t => {
  const f = physicalLedger(t); f.publish(false); f.reopen();
  const report = inspect(f); assert.equal(report.status, "PASS", JSON.stringify(report));
  assert.equal(f.store.getOperationById(f.id).state, "pending");
  assert.equal(f.store.getDelivery(f.message.id, "alice").materialized, 0);
  assert.ok(readFileSync(f.object).equals(f.bytes));
});
test("P6 files: source hash corruption and source loss are reported without repair", t => {
  const f = physicalLedger(t); chmodSync(f.object, 0o600);
  const changed = Buffer.from(f.bytes); changed[changed.length - 1] ^= 1; writeFileSync(f.object, changed);
  assert.equal(inspect(f).status, "FAIL"); assert.ok(readFileSync(f.object).equals(changed));
  unlinkSync(f.object); assert.ok(has(inspect(f), "MAIL_OBJECT_MISSING"));
  assert.equal(existsSync(f.object), false);
});
test("P6 files: missing materialized name and publication before archive violate physical relations", t => {
  const f = physicalLedger(t); f.publish();
  unlinkSync(f.inbox()); assert.ok(has(inspect(f), "MATERIALIZED_FILE_MISSING"));
  linkSync(f.object, f.inbox()); unlinkSync(f.archive);
  assert.ok(has(inspect(f), "DELIVERY_WITHOUT_ARCHIVE"));
});
test("P6 files: duplicate new/cur names and orphan archive names are not silently removed", t => {
  const f = physicalLedger(t); f.publish(); mkdirSync(join(f.root, "mail/inboxes/alice/cur")); linkSync(f.object, f.inbox("cur"));
  assert.ok(has(inspect(f), "DUPLICATE_MAILBOX_NAMES"));
  const orphan = join(f.root, "mail/archive/cur/orphan"); writeFileSync(orphan, "x");
  assert.ok(has(inspect(f), "ARCHIVE_DIRECTORY_UNOWNED")); assert.equal(existsSync(orphan), true);
});
test("P6 files: unaccepted object orphan is unknown, not repaired or mislabelled accepted", t => {
  const f = physicalLedger(t), orphan = join(f.root, "mail/objects/orphan.eml"); writeFileSync(orphan, "x");
  const report = inspect(f); assert.equal(report.status, "UNKNOWN"); assert.ok(has(report, "OBJECT_DIRECTORY_UNOWNED"));
  assert.equal(existsSync(orphan), true); assert.equal(f.store.getOperationById(f.id).state, "pending");
});
test("P6 files: symlink targets are not treated as immutable source files", t => {
  const f = physicalLedger(t), target = join(f.root, "external"); writeFileSync(target, f.bytes);
  unlinkSync(f.object); symlinkSync(target, f.object);
  assert.equal(inspect(f).status, "FAIL"); assert.ok(readFileSync(target).equals(f.bytes));
});
test("P6 files: observation budgets and unobserved live units remain UNKNOWN", t => {
  const f = physicalLedger(t);
  assert.equal(inspect(f, { files: new NodeIntegrityFiles({ ...FILE_INSPECTION_LIMITS, maxFileBytes: 1 }) }).status, "UNKNOWN");
  assert.equal(inspect(f, { mode: "live" }).status, "UNKNOWN");
});
test("P6 files: malformed persisted plans never reach physical observers", t => {
  const f = physicalLedger(t), snapshot = structuredClone(f.snapshot()); snapshot.tables.operations[0].plan_json = '{"path":"/should-not-be-read"}';
  let calls = 0;
  const report = inspectIntegrity(snapshot, f.context, { files: { file() { calls++; throw new Error(); }, names() { calls++; throw new Error(); }, contextTree() { calls++; throw new Error(); }, symlink() { calls++; throw new Error(); } } });
  assert.equal(report.status, "FAIL"); assert.equal(calls, 0);
});
test("P6 files: context trees retain exact names, bytes, modes and no-link policy", t => {
  const f = physicalLedger(t), root = join(f.root, "revision"), bytes = Buffer.from("goal\n"); mkdirSync(root);
  const file = join(root, "GOAL.md"); writeFileSync(file, bytes, { mode: 0o644 }); chmodSync(root, 0o555);
  const entries = [{ path: "GOAL.md", bytes: bytes.length, sha256: sha256Hex(bytes) }];
  assert.equal(new NodeIntegrityFiles().contextTree(root, entries).kind, "present");
  chmodSync(root, 0o755); writeFileSync(join(root, "extra.md"), "x"); chmodSync(root, 0o555);
  assert.equal(new NodeIntegrityFiles().contextTree(root, entries).kind, "corrupt");
  chmodSync(root, 0o755); unlinkSync(join(root, "extra.md")); linkSync(file, join(f.root, "alias")); chmodSync(root, 0o555);
  assert.equal(new NodeIntegrityFiles().contextTree(root, entries).kind, "corrupt");
  assert.equal(new NodeIntegrityFiles().contextTree(root, [] ).kind, "corrupt");
});

test("P6 files: a matching file hash does not hide contradictory frozen headers", t => {
  const f = physicalLedger(t, { editHeaders: text => text.replace("X-OMA-Kind: message", "X-OMA-Kind: alert") });
  const report = inspectIntegrity(f.snapshot(), f.context, { files: new NodeIntegrityFiles() });
  assert.equal(report.status, "FAIL", JSON.stringify(report));
  assert.ok(report.issues.some(issue => issue.code === "MAIL_OBJECT_INVALID"));
  assert.equal(f.store.getOperationById(f.id).state, "pending");
});

test("P6 files: worker-audience mail is expected under mail/workers, never the public archive", async t => {
  const f = physicalLedger(t); f.publish();
  const { generateOperationId } = await import("@oma/native/identity");
    const { messageIdForOperation: generateMessageId } = await import("@oma/domain/derived");
  const { reviewRequestNameFor } = await import("@oma/domain/identifiers");
  const { requestHash } = await import("@oma/domain/request-identity");
  const { mailWorkersPathAt, mailObjectPathAt: objectPathAt, mailInboxPathAt: inboxPathAt } = await import("@oma/domain/paths");
  const { buildEml } = await import("@oma/mail/serialize");
  const id = generateOperationId(), name = reviewRequestNameFor("merge", id), mid = generateMessageId(id, 0);
  const candidate = "2".repeat(40), base = "1".repeat(40);
  const identity = { repo: "project", targetRef: "refs/heads/main", expectedBase: base, candidate, policyRevision: "p1" };
  const eml = await buildEml({ from: "alice@fixture.oma.invalid", to: ["residents@fixture.oma.invalid"],
    replyTo: ["alice@fixture.oma.invalid"], subject: "review", body: "thread", kind: "message",
    contextRevision: null, inReplyTo: null, references: [], messageId: `${mid}@fixture.oma.invalid` });
  const message = { id: mid, objectPath: `mail/objects/${mid}.eml`, sha256: eml.sha256, bytes: eml.bytes,
    dateMs: eml.dateMs, to: ["residents"], recipients: ["alice"], kind: "message", contextRevision: null,
    replyHeaders: { replyTo: ["alice"], inReplyTo: null, references: [] }, audience: "workers",
    review: { role: "thread", request: id, name, revision: 0 } };
  const fact = { kind: "merge.open", version: 1, name, title: "Fix", reason: "needed", tier: "MEDIUM",
    identity, submitters: ["alice"] };
  const payload = { kind: "merge.open", tier: "MEDIUM", title: "Fix", reason: "needed", candidate, base };
  const object = objectPathAt(f.root, mid);
  writeExclusiveFsyncedFile(object, Buffer.from(eml.text, "utf8"), 0o444);
  f.store.transaction(tx => {
    tx.operations.insert({ id, actor: "alice", requestKey: randomUUID(), requestHash: requestHash("attest.record", payload),
      kind: "attest.record", payloadJson: JSON.stringify(payload),
      planJson: serializePlanIntent({ kind: "attest.record", fact, messages: [message] }) });
    tx.deliveries.insert([{ messageId: mid, recipient: "alice", operationId: id }]);
  });
  publishImmutableFile(object, mailWorkersPathAt(f.root, mid), eml.sha256);
  publishImmutableFile(object, inboxPathAt(f.root, "alice", mid, "new"), eml.sha256);
  f.store.transaction(tx => tx.deliveries.materialize(mid, "alice"));
  const clean = inspect(f);
  assert.equal(clean.status, "PASS", JSON.stringify(clean));
  // A copy planted in the public archive is unowned there, and a public
  // message planted in the workers archive is unowned in the other direction.
  const stray = join(f.root, "mail/archive/cur", `${mid}:2,`);
  linkSync(object, stray);
  assert.ok(has(inspect(f), "ARCHIVE_DIRECTORY_UNOWNED"));
  unlinkSync(stray);
  const wrong = join(f.root, "mail/workers/cur", `${f.message.id}:2,`);
  linkSync(f.object, wrong);
  assert.ok(has(inspect(f), "WORKERS_DIRECTORY_UNOWNED"));
  unlinkSync(wrong);
});
