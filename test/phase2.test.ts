import { createMailModule } from "#oma-test/app/broker/mail-composition";
// Phase 2 acceptance: DDL/FK/idempotency/framing/fuzz (T02-T10, TEST-001).
// Normal data uses the actual Store/Mail boundaries. Deliberate SQL corruption
// is isolated after the Store closes, not smuggled into the normal constructors.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, SCHEMA_PATH } from "@oma/storage";
import { StoreError } from "@oma/domain/errors";
import { MailModule } from "@oma/mail";
import { FrameParser, FrameError, findDuplicateKey } from "@oma/protocol/frame";
import { requestHash } from "@oma/domain/request-identity";
import { sha256Hex, sortedUnique, canonicalJson } from "@oma/domain/canonical-json";
import { generateOperationId, generateBatchId, uuidV4 } from "@oma/native/identity";
import { messageIdForOperation as generateMessageId } from "@oma/domain/derived";
import { isValidActorName, isValidRequestKey, isValidFullOid, parseMessageId, isValidWirePath } from "@oma/domain/identifiers";
import type { AuthContext } from "@oma/contracts";
import { makeValidAgent } from "./fixtures/spec.js";
import { mutateRawRowAfterClose } from "./fixtures/corruption.js";

const FRAME_LIMIT = 256 * 1024;
function freshStore(): { store: Store; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "oma-t2-"));
  return { store: new Store(join(dir, "runtime.sqlite")), dir };
}
function seal(store: Store, dir: string): void {
  try { store.close(); } finally { rmSync(dir, { recursive: true, force: true }); }
}
function insertAgentTx(store: Store, name: string): void {
  store.transaction(tx => tx.insertAgent(makeValidAgent(name)));
  assert.equal(store.getAgent(name)?.name, name, "normal fixture must pass the production decoder first");
}
function mailFixture(store: Store, dir: string) {
  const mail = createMailModule({ stateRoot: dir, society: "phase2" }, store, 64);
  const auth: AuthContext = { actor: "a", incarnation: 1, role: "resident", channel: "actor",
    capabilities: new Set(["mail.send"]), peer: { pid: process.pid, uid: 1000, gid: 1000 } };
  return { mail, auth };
}
function rawFrame(text: string): Buffer {
  const body = Buffer.from(text, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  return Buffer.concat([length, body]);
}
function frameOf(value: unknown): Buffer { return rawFrame(JSON.stringify(value)); }

test("DR46 schema4: fresh DDL applies; six entities; reapply rejected", () => {
  const { store, dir } = freshStore();
  let closed = false;
  try {
    const other = new Store(join(dir, "runtime.sqlite"));
    try { assert.equal(other.transaction(() => 1), 1); } finally { other.close(); }
    const sql = readFileSync(SCHEMA_PATH, "utf8");
    assert.deepEqual([...sql.matchAll(/CREATE TABLE (\w+)/g)].map(match => match[1]).sort(),
      ["agents", "attestations", "batches", "deliveries", "operations", "subscriptions"]);
    store.close(); closed = true;
    mutateRawRowAfterClose(join(dir, "runtime.sqlite"), raw => {
      assert.equal(raw.prepare("PRAGMA user_version").get()?.user_version, 4);
      assert.throws(() => raw.exec(sql), /already exists/);
      raw.exec("ROLLBACK");
      assert.equal(raw.prepare("PRAGMA user_version").get()?.user_version, 4);
    });
  } finally { if (!closed) store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("T03: invalid enum / negative units / FK / bad flags rejected by constraints", async () => {
  const { store, dir } = freshStore();
  let closed = false;
  try {
    insertAgentTx(store, "a");
    const { mail, auth } = mailFixture(store, dir);
    const sent = await mail.send(auth, "valid-control", { to: ["a"], subject: "control", kind: "message", body: "bytes" });
    const operation = store.getOperationById(sent.operation);
    assert.ok(operation?.kind === "mail.send");
    assert.equal(operation.state, "succeeded");
    const message = operation.plan.message.id;
    assert.equal(store.getDelivery(message, "a")?.materialized, 1);
    store.close(); closed = true;
    mutateRawRowAfterClose(join(dir, "runtime.sqlite"), raw => {
      raw.exec("PRAGMA foreign_keys=ON");
      assert.throws(() => raw.prepare("UPDATE agents SET desired=? WHERE name='a'").run("invented"), /CHECK constraint failed/);
      assert.throws(() => raw.prepare("UPDATE agents SET spec_json=? WHERE name='a'").run("not-json"), /CHECK constraint failed/);
      assert.throws(() => raw.prepare("UPDATE deliveries SET materialized=2 WHERE message_id=? AND recipient='a'").run(message), /CHECK constraint failed/);
      const missingOperation = generateOperationId();
      assert.throws(() => raw.prepare(`INSERT INTO deliveries
        (message_id,recipient,operation_id,materialized,presented,acknowledged,created_at_ms)
        VALUES (?,'a',?,0,0,0,1)`).run(generateMessageId(missingOperation, 0), missingOperation), /FOREIGN KEY constraint failed/);
    });
    const reopened = new Store(join(dir, "runtime.sqlite"), 5, { society: "phase2" });
    try {
      assert.equal(reopened.getAgent("a")?.desired, "enabled");
      assert.equal(reopened.getDelivery(message, "a")?.materialized, 1);
      assert.equal(reopened.getOperationById(sent.operation)?.state, "succeeded");
    } finally { reopened.close(); }
  } finally { if (!closed) store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("T04: frame reconstruction across arbitrary byte splits", () => {
  const a = frameOf({ v: 1, id: "1", method: "status.get", params: {} });
  const b = frameOf({ v: 1, id: "2", method: "operation.get", params: { key: "k" } });
  const all = Buffer.concat([a, b]);
  for (let cut = 1; cut < all.length; cut++) {
    const parser = new FrameParser(FRAME_LIMIT);
    const got = [...parser.feed(all.subarray(0, cut)), ...parser.feed(all.subarray(cut))];
    assert.equal(got.length, 2);
    assert.equal(got[0]!.raw.id, "1");
    assert.equal(got[1]!.raw.id, "2");
  }
  const c = frameOf({ v: 1, id: "3", method: "mail.send", params: { body: "안녕하세요" } });
  for (let cut = 1; cut < c.length; cut++) {
    const parser = new FrameParser(FRAME_LIMIT);
    const got = [...parser.feed(c.subarray(0, cut)), ...parser.feed(c.subarray(cut))];
    assert.equal(got.length, 1);
    assert.deepEqual(got[0]!.raw.params, { body: "안녕하세요" });
  }
});

test("T05: malicious frames are rejected pre-accept with bounded effect", () => {
  assert.throws(() => new FrameParser(64).feed(Buffer.concat([Buffer.from([0, 0, 0, 100]), Buffer.alloc(100)])),
    (error: unknown) => error instanceof FrameError && error.code === "FRAME_TOO_LARGE");
  assert.throws(() => new FrameParser(64).feed(Buffer.from([0, 0, 0, 2, 0xff, 0xfe])),
    (error: unknown) => error instanceof FrameError && error.code === "INVALID_REQUEST");
  assert.equal(findDuplicateKey('{"a":1,"a":2}'), "a");
  assert.equal(findDuplicateKey('{"a":{"b":1,"b":2}}'), "b");
  assert.equal(findDuplicateKey('{"a":[1,2],"b":{"c":3}}'), null);
  assert.equal(findDuplicateKey(String.raw`{"a":1,"\\u0061":2}`), null);
  for (const text of ['{"a":1,"a":2}', String.raw`{"a":1,"\u0061":2}`,
    String.raw`{"nested":{"a\"b":1,"a\u0022b":2}}`, String.raw`{"😀":1,"\ud83d\ude00":2}`])
    assert.throws(() => new FrameParser(256).feed(rawFrame(text)), /duplicate JSON key/, text);
  assert.throws(() => new FrameParser(64).feed(rawFrame("[1]")), /root must be a JSON object/);
  assert.throws(() => new FrameParser(64).feed(rawFrame('{"a":NaN}')), /non-finite literal|malformed JSON/);
  for (const text of ['{"value":1e999}', '{"value":9007199254740992}'])
    assert.throws(() => new FrameParser(256).feed(rawFrame(text)), /non-finite number or unsafe integer/);
});

test("P1-9: NaN/Infinity as string values are accepted; invalid numeric literals rejected", () => {
  for (const body of ["Infinity is a concept and NaN is a number", "NaN"]) {
    const frames = new FrameParser(256).feed(frameOf({ body }));
    assert.equal(frames.length, 1);
    assert.equal(frames[0]!.raw.body, body);
  }
  for (const text of ['{"a":NaN}', '{"a":Infinity}'])
    assert.throws(() => new FrameParser(64).feed(rawFrame(text)), /malformed JSON|non-finite/);
});

test("T07: same actor/key/payload converges to one operation with identical receipts (unique constraint)", async () => {
  const { store, dir } = freshStore();
  try {
    insertAgentTx(store, "a");
    const { mail, auth } = mailFixture(store, dir);
    const input = { to: ["a"], subject: "s", kind: "message" as const, body: "x" };
    const first = await mail.send(auth, "k", input);
    assert.equal(first.state, "succeeded");
    for (let i = 1; i < 20; i++) assert.deepEqual(await mail.send(auth, "k", input), first);
    assert.equal(store.getOperation("a", "k")?.id, first.operation);
    assert.equal(store.deliveriesForOperation(first.operation).length, 1);
    assert.equal(store.pendingDeliveries("a").length, 1);
  } finally { seal(store, dir); }
});

test("T08: same key, different payload -> REQUEST_KEY_REUSED", async () => {
  const { store, dir } = freshStore();
  try {
    insertAgentTx(store, "a");
    const { mail, auth } = mailFixture(store, dir);
    const input = { to: ["a"], subject: "s", kind: "message" as const, body: "first" };
    const first = await mail.send(auth, "k", input);
    const before = store.getOperationById(first.operation);
    await assert.rejects(mail.send(auth, "k", { ...input, body: "second" }), { code: "REQUEST_KEY_REUSED" });
    assert.deepEqual(store.getOperationById(first.operation), before);
    assert.equal(store.deliveriesForOperation(first.operation).length, 1);
  } finally { seal(store, dir); }
});

test("T10: different keys are distinct operations; no semantic dedup", async () => {
  const { store, dir } = freshStore();
  try {
    insertAgentTx(store, "a");
    const { mail, auth } = mailFixture(store, dir);
    const input = { to: ["a"], subject: "same", kind: "message" as const, body: "same bytes" };
    const first = await mail.send(auth, "k1", input);
    const second = await mail.send(auth, "k2", input);
    assert.notEqual(first.operation, second.operation);
    assert.equal(store.getOperation("a", "k1")?.requestKey, "k1");
    assert.equal(store.getOperation("a", "k2")?.requestKey, "k2");
    assert.equal(store.pendingDeliveries("a").length, 2);
  } finally { seal(store, dir); }
});

test("hash: canonical key sorting, set dedupe, stability, descriptor identity", () => {
  const h1 = requestHash("mail.send", { to: sortedUnique(["b", "a", "b"]), subject: "S", kind: "message", body: "x" });
  const h2 = requestHash("mail.send", { subject: "S", kind: "message", body: "x", to: sortedUnique(["a", "b"]) });
  assert.equal(h1, h2);
  assert.equal(h1.length, 64);
  assert.notEqual(requestHash("mail.send", { body: " x ", subject: "S ", kind: "message", to: [] }),
    requestHash("mail.send", { body: "x", subject: "S", kind: "message", to: [] }));
  // The current descriptor belongs to params and contributes to identity.
  assert.notEqual(requestHash("git.submit", { bundle: { bytes: 100, sha256: "c".repeat(64) } }), requestHash("git.submit", {}));
  assert.equal(canonicalJson({ b: 1, a: [2, 1] }), '{"a":[2,1],"b":1}');
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("ids: grammar, reserved names, message ids, wire paths", () => {
  assert.ok(isValidActorName("a"));
  assert.ok(isValidActorName("agent-2"));
  for (const name of ["Agent", "principal", "commons", "topic-x", "a".repeat(33)]) assert.ok(!isValidActorName(name));
  assert.ok(isValidRequestKey("k"));
  assert.ok(isValidRequestKey("a.b_c-d".repeat(13)));
  assert.ok(!isValidRequestKey(""));
  assert.ok(!isValidRequestKey("x".repeat(97)));
  assert.ok(isValidFullOid("a".repeat(40)));
  assert.ok(isValidFullOid("b".repeat(64)));
  assert.ok(!isValidFullOid("A".repeat(40)));
  const operation = generateOperationId();
  const message = generateMessageId(operation, 0);
  assert.equal(parseMessageId(message)!.operationId, operation);
  assert.equal(parseMessageId(message)!.ordinal, 0);
  assert.equal(parseMessageId("m-x-3"), null);
  assert.ok(generateBatchId().startsWith("b-"));
  assert.ok(isValidWirePath("a/b.txt"));
  for (const path of ["../etc", "/abs", "a/../b", "a\0b"]) assert.ok(!isValidWirePath(path));
  // AV-25a: a lone surrogate is a decoding artifact, never a wire path — letting
  // it through would re-encode as replacement bytes and rename on disk.
  for (const path of ["a\uD800b", "a/\uDC00\uDC00.txt", "\uDFFF"]) assert.ok(!isValidWirePath(path));
  assert.ok(isValidWirePath("a/\u00e9.txt"), "paired non-ASCII text is still a valid path");
});

test("store: batch link cross-row invariant (DB-008/BATCH-001)", async () => {
  const { store, dir } = freshStore();
  try {
    insertAgentTx(store, "a"); insertAgentTx(store, "b");
    const { mail, auth } = mailFixture(store, dir);
    const broadcast = await mail.send(auth, "broadcast", { to: ["a", "b"], subject: "both", kind: "message", body: "broadcast" });
    const direct = await mail.send(auth, "direct", { to: ["b"], subject: "b only", kind: "message", body: "direct" });
    const first = store.getOperationById(broadcast.operation);
    const second = store.getOperationById(direct.operation);
    assert.ok(first?.kind === "mail.send" && second?.kind === "mail.send");
    const msgA = first.plan.message.id;
    const msgB = second.plan.message.id;
    assert.equal(store.getDelivery(msgA, "a")?.materialized, 1);
    assert.equal(store.getDelivery(msgA, "b")?.materialized, 1);
    assert.equal(store.getDelivery(msgB, "a"), null);
    const batch = generateBatchId();
    store.transaction(tx => {
      tx.insertPreparedBatch({ id: batch, agent: "a", incarnation: 1, messageIds: [msgA], sessionPath: null });
      tx.linkDeliveriesToBatch(batch, [msgA]);
    });
    assert.equal(store.getDelivery(msgA, "a")?.batchId, batch);
    for (const message of [msgB, msgA]) {
      const rejectedBatch = generateBatchId();
      assert.throws(() => store.transaction(tx => {
        tx.insertPreparedBatch({ id: rejectedBatch, agent: "a", incarnation: 1, messageIds: [message], sessionPath: null });
        tx.linkDeliveriesToBatch(rejectedBatch, [message]);
      }), (error: unknown) => error instanceof StoreError && error.code === "BATCH_CONFLICT");
      assert.equal(store.getBatch(rejectedBatch), null, "failed exact-set link rolls back its whole acceptance");
    }
    assert.equal(store.getDelivery(msgA, "a")?.batchId, batch);
    assert.equal(store.getDelivery(msgA, "b")?.batchId, null);
  } finally { seal(store, dir); }
});

test("ids + hash demo: complete request hash for mail.send", () => {
  const hash = requestHash("mail.send", { to: sortedUnique(["topic/auth", "b"]), subject: "S", kind: "message", body: "문의드립니다\n" });
  assert.match(hash, /^[0-9a-f]{64}$/);
});
