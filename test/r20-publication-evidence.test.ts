import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store, StoreError } from "../src/store.js";
import { MailModule, buildEml, defaultLogicalReplyTo } from "../src/mail.js";
import { generateOperationId, generateMessageId } from "../src/ids.js";
import { requestHash } from "../src/hash.js";
import { publishedRefFor, mailObjectRelativePath } from "../src/domain/derived.js";
import { mailArchivePathAt } from "../src/storage/paths.js";
import { GitObserver, type GitProcessEvidence } from "../src/git/observe.js";
import { GitPublicationObserver, consumeSubmissionPublication } from "../src/git/publication.js";
import type { OperationOf } from "../src/storage/operation-codec.js";
import { makeValidAgent } from "./fixtures/spec.js";

// Real Store and frozen MIME bytes; injected command observations are a unit
// boundary, not evidence that a native Git or sandbox probe has been executed.
const candidate = "2".repeat(40);
const code = (expected: string) => (error: unknown): boolean => error instanceof StoreError && error.code === expected;
function native(changes: Partial<GitProcessEvidence> = {}): GitProcessEvidence {
  return { status: 0, signal: null, stdout: Buffer.from(`${candidate}\n`), stderr: Buffer.alloc(0), ...changes };
}

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "oma-r20-publication-"));
  const store = new Store(join(root, "runtime.sqlite"));
  const mail = new MailModule({ stateRoot: root, society: "demo" }, store, 64);
  store.transaction(tx => {
    tx.insertAgent(makeValidAgent("alice", { capabilities: ["git.submit"] }));
    tx.insertAgent(makeValidAgent("bob"));
  });
  async function accept(key: string): Promise<OperationOf<"git.submit">> {
    const id = generateOperationId(); const messageId = generateMessageId(id, 0);
    const input = { candidate, exportRef: "refs/oma/export/fixture", prerequisites: [], to: ["bob"],
      subject: "frozen result", body: "frozen body", paths: [] };
    const eml = await buildEml({
      from: "alice@demo.oma.invalid", to: ["bob@demo.oma.invalid"], replyTo: ["alice@demo.oma.invalid"],
      subject: input.subject, body: input.body, kind: "result", contextRevision: null,
      inReplyTo: null, references: [], messageId: `${messageId}@demo.oma.invalid`,
    });
    mail.freezeObject(messageId, eml);
    const plan = { kind: "git.submit", candidate, exportRef: input.exportRef, prerequisites: [], bundle: null,
      publishedRef: publishedRefFor("alice", id),
      message: { id: messageId, objectPath: mailObjectRelativePath(messageId), sha256: eml.sha256, bytes: eml.bytes,
        dateMs: eml.dateMs, to: ["bob"], recipients: ["bob"], kind: "result", contextRevision: null,
        replyHeaders: { replyTo: defaultLogicalReplyTo("alice", ["bob"]), inReplyTo: null, references: [] } } };
    store.transaction(tx => {
      tx.acceptOperation({ id, actor: "alice", requestKey: key, requestHash: requestHash("git.submit", input),
        kind: "git.submit", payloadJson: JSON.stringify(input), planJson: JSON.stringify(plan) });
      tx.insertDeliveries([{ messageId, recipient: "bob", operationId: id }]);
    });
    const operation = store.getOperationById(id);
    assert.ok(operation?.kind === "git.submit");
    return operation;
  }
  const operation = await accept("first");
  return { root, store, mail, operation, accept,
    close: () => { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("R20: an accepted submit plan alone cannot publish result mail", async () => {
  const f = await fixture();
  try {
    const path = mailArchivePathAt(f.root, f.operation.plan.message.id);
    assert.equal(existsSync(path), false);
    await assert.rejects(f.mail.publishGated(f.operation.id), code("REF_STATE_UNKNOWN"));
    assert.equal(existsSync(path), false, "missing evidence must fail before archive publication");
    assert.equal(f.store.getDelivery(f.operation.plan.message.id, "bob")?.materialized, 0);
    assert.equal(f.store.getOperationById(f.operation.id)?.state, "pending");
  } finally { f.close(); }
});

test("R20: publication proof is issued for the exact observed canonical ref and is single-use", async () => {
  const f = await fixture();
  try {
    const invocations: readonly string[][] = [];
    const calls: string[][] = [];
    const observer = new GitObserver(args => { calls.push([...args]); return native(); });
    const issuer = new GitPublicationObserver(observer, "/trusted/project.git");
    const proof = issuer.submission(f.operation);
    assert.equal(Object.isFrozen(proof), true);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], ["--git-dir", "/trusted/project.git", "rev-parse", "--verify", "--quiet", f.operation.plan.publishedRef]);
    for (const forged of [true, false, {}, { publishedRef: f.operation.plan.publishedRef, candidate }, JSON.parse(JSON.stringify(proof))]) {
      assert.throws(() => consumeSubmissionPublication(forged, f.operation), code("REF_STATE_UNKNOWN"));
    }
    const originalPlan = f.operation.planJson;
    const result = await f.mail.publishGated(f.operation.id, proof);
    assert.deepEqual(result, { message: f.operation.plan.message.id, recipientCount: 1 });
    const path = mailArchivePathAt(f.root, result.message);
    const before = readFileSync(path);
    assert.equal(f.store.getDelivery(result.message, "bob")?.materialized, 1);
    assert.equal(f.store.getOperationById(f.operation.id)?.planJson, originalPlan);
    await assert.rejects(f.mail.publishGated(f.operation.id, proof), code("REF_STATE_UNKNOWN"));
    assert.deepEqual(readFileSync(path), before);
    assert.equal(calls.length, 1, "consuming a token is not an invented new observation");
    assert.equal(invocations.length, 0);
  } finally { f.close(); }
});

test("R20: a token for another accepted operation does not authorize a matching-candidate result", async () => {
  const f = await fixture();
  try {
    const second = await f.accept("second");
    assert.equal(second.plan.candidate, f.operation.plan.candidate);
    const issuer = new GitPublicationObserver(new GitObserver(() => native()), "/trusted/project.git");
    const proof = issuer.submission(f.operation);
    await assert.rejects(f.mail.publishGated(second.id, proof), code("REF_STATE_UNKNOWN"));
    assert.equal(existsSync(mailArchivePathAt(f.root, second.plan.message.id)), false);
    await f.mail.publishGated(f.operation.id, proof);
    assert.equal(f.store.getDelivery(f.operation.plan.message.id, "bob")?.materialized, 1);
    assert.equal(f.store.getDelivery(second.plan.message.id, "bob")?.materialized, 0);
  } finally { f.close(); }
});

for (const kind of ["absent", "different", "unknown", "corrupt"] as const) {
  test(`R20: ${kind} ref evidence cannot produce a publication token`, async () => {
    const f = await fixture();
    try {
      const valid = new GitPublicationObserver(new GitObserver(() => native()), "/trusted/project.git");
      assert.doesNotThrow(() => consumeSubmissionPublication(valid.submission(f.operation), f.operation));
      const result = kind === "absent" ? native({ status: 1, stdout: Buffer.alloc(0) })
        : kind === "different" ? native({ stdout: Buffer.from(`${"3".repeat(40)}\n`) })
        : kind === "unknown" ? native({ status: null, stdout: Buffer.alloc(0) })
        : native({ stdout: Buffer.from("invalid object identity\n") });
      const issuer = new GitPublicationObserver(new GitObserver(() => result), "/trusted/project.git");
      assert.throws(() => issuer.submission(f.operation), code(kind === "corrupt" ? "STORE_CORRUPT" : "REF_STATE_UNKNOWN"));
      assert.equal(existsSync(mailArchivePathAt(f.root, f.operation.plan.message.id)), false);
      assert.equal(f.store.getDelivery(f.operation.plan.message.id, "bob")?.materialized, 0);
    } finally { f.close(); }
  });
}
