import { serializePlanIntent } from "./fixtures/plan.js";
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LedgerReader } from "@oma/storage/ledger-reader";
import { StoreError } from "@oma/domain/errors";
import { readDiagnosticSnapshot, Store } from "@oma/storage";
import { requestHash } from "@oma/domain/request-identity";
import { messageIdForOperation, publishedRefFor } from "@oma/domain/derived";
import { reviewRequestNameFor } from "@oma/domain/identifiers";
import { makeValidAgent } from "./fixtures/spec.js";
import { pendingWork, pendingWorkByAgent } from "#oma-test/app/views/pending-work";
import { ViewsModule } from "#oma-test/app/views";
import { InternalDispatcher, projectInternalPeers } from "@oma/broker/internal-dispatcher";
import { type InternalDispatchDependencies } from "@oma/broker/ports";
import { createInternalDispatchDataPorts } from "#oma-test/app/broker/composition";
import type { MailModule } from "@oma/mail";
import type { BoundPeer } from "@oma/broker/ports";
import type { AuthContext } from "@oma/contracts";

/** P0 BATCH-1 oracle: operational ledger reads carry no shared diagnostics
 * budget. A society past the former 10k-row cap still answers every read the
 * runner, status and recovery paths issue, completely and in acceptance
 * order; only the administrator's diagnostic snapshot keeps LIMIT_EXCEEDED.
 * Failure remains failure -- a broken read is never answered as empty. */

const UNBATCHED = 10_001;
const BATCHED = 300;
const SUBMITS = 2;
const ATTESTS = 1;
const EXTRA_AGENTS = 10_000; // alice plus a-0..a-9999 -> 10_001 agents
const OID = (n: number) => n.toString(16).padStart(40, "0");

interface SendFixture { readonly id: string; readonly key: string; readonly payloadJson: string; readonly planJson: string; readonly hash: string; readonly messageId: string }
function sendOperation(index: number): SendFixture {
  const id = `op-${randomUUID()}`;
  const key = `send-${index}`;
  const messageId = messageIdForOperation(id, 0);
  const payload = { to: ["alice"], subject: "s", kind: "message", body: "b" };
  const plan = { kind: "mail.send", message: {
    id: messageId, objectPath: `mail/objects/${messageId}.eml`, sha256: "a".repeat(64),
    bytes: 8, dateMs: 1, to: ["alice"], recipients: ["alice"], kind: "message",
    contextRevision: null,
    replyHeaders: { replyTo: ["alice"], inReplyTo: null, references: [] } } };
  return { id, key, messageId,
    payloadJson: JSON.stringify(payload), planJson: serializePlanIntent(plan),
    hash: requestHash("mail.send", payload) };
}
function submitOperation(index: number): SendFixture {
  const id = `op-${randomUUID()}`;
  const key = `submit-${index}`;
  const messageId = messageIdForOperation(id, 0);
  const exportRef = `refs/oma/export/${key}`;
  const payload = { candidate: OID(1), exportRef, prerequisites: [], to: [], subject: "s", body: "b", paths: [] };
  const plan = { kind: "git.submit", candidate: OID(1), exportRef, prerequisites: [], bundle: null,
    publishedRef: publishedRefFor("alice", id),
    message: { id: messageId, objectPath: `mail/objects/${messageId}.eml`, sha256: "b".repeat(64),
      bytes: 8, dateMs: 1, to: ["commons"], recipients: [], kind: "result",
      contextRevision: null,
      replyHeaders: { replyTo: [], inReplyTo: null, references: [] } } };
  return { id, key, messageId,
    payloadJson: JSON.stringify(payload), planJson: serializePlanIntent(plan),
    hash: requestHash("git.submit", payload) };
}
function attestOperation(index: number): SendFixture {
  const id = `op-${randomUUID()}`;
  const key = `attest-${index}`;
  const payload = { kind: "merge.open", tier: "LOW", title: "t", reason: "r", candidate: OID(1), base: OID(2) };
  const plan = { kind: "attest.record", fact: {
      kind: "merge.open", version: 1, name: reviewRequestNameFor("merge", id), title: "t", reason: "r", tier: "LOW",
      identity: { repo: "project", targetRef: "refs/heads/main", expectedBase: OID(2), candidate: OID(1), policyRevision: "r1" },
      submitters: ["alice"] },
    messages: [] };
  return { id, key, messageId: messageIdForOperation(id, 0),
    payloadJson: JSON.stringify(payload), planJson: serializePlanIntent(plan),
    hash: requestHash("attest.record", payload) };
}

/** A ledger past the former operational cap, written by the same statements
 * acceptance uses, so every relation a reader validates is a real one. */
function seedLargeLedger(root: string): { path: string; batchId: string; firstMessage: string; lastMessage: string; sampleOpId: string } {
  const path = join(root, "runtime.sqlite");
  new Store(path).close(); // applies the shipped schema, then yields the file
  const db = new DatabaseSync(path);
  const batchId = `b-${randomUUID()}`;
  const sent: string[] = [];
  let sampleOpId = "";
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("BEGIN");
    const agent = db.prepare(`INSERT INTO agents (name, spec_hash, role, desired, incarnation, profile, created_by, spec_json, created_at_ms, updated_at_ms)
      VALUES (?,?,?,?,?,?,?,?,1,1)`);
    for (const name of ["alice", ...Array.from({ length: EXTRA_AGENTS }, (_, i) => `a-${i}`)]) {
      const row = makeValidAgent(name);
      agent.run(row.name, row.specHash, row.role, row.desired, row.incarnation, row.profile, row.createdBy, row.specJson);
    }
    const subscription = db.prepare("INSERT INTO subscriptions (topic, agent, created_at_ms) VALUES ('t-shared', ?, 1)");
    for (const name of ["alice", ...Array.from({ length: EXTRA_AGENTS }, (_, i) => `a-${i}`)]) subscription.run(name);
    const operation = db.prepare(`INSERT INTO operations (id, actor, request_key, request_hash, kind, payload_json, plan_json, state, result_json, error_code, created_at_ms, updated_at_ms)
      VALUES (?, 'alice', ?, ?, ?, ?, ?, 'pending', NULL, NULL, 1, 1)`);
    const delivery = db.prepare(`INSERT INTO deliveries (message_id, recipient, operation_id, materialized, batch_id, presented, acknowledged, created_at_ms, materialized_at_ms)
      VALUES (?, 'alice', ?, 1, ?, 0, 0, 1, 1)`);
    // The batch row must exist before deliveries name it; its manifest is the
    // immutable set the linked rows settle, so it is stamped after they land.
    db.prepare(`INSERT INTO batches (id, agent, incarnation, message_ids_json, session_path, state, created_at_ms, completed_at_ms)
      VALUES (?, 'alice', 1, '[]', NULL, 'prepared', 1, NULL)`).run(batchId);
    const batchedMessages: string[] = [];
    for (let i = 0; i < UNBATCHED + BATCHED; i++) {
      const row = sendOperation(i);
      operation.run(row.id, row.key, row.hash, "mail.send", row.payloadJson, row.planJson);
      const batched = i >= UNBATCHED;
      if (batched) batchedMessages.push(row.messageId);
      else sent.push(row.messageId);
      if (i === UNBATCHED + BATCHED - 1) sampleOpId = row.id; // a batched op: exercises linked-batch validation
      delivery.run(row.messageId, row.id, batched ? batchId : null);
    }
    db.prepare("UPDATE batches SET message_ids_json=? WHERE id=?").run(JSON.stringify(batchedMessages), batchId);
    for (let i = 0; i < SUBMITS; i++) {
      const row = submitOperation(i);
      operation.run(row.id, row.key, row.hash, "git.submit", row.payloadJson, row.planJson);
    }
    for (let i = 0; i < ATTESTS; i++) {
      const row = attestOperation(i);
      operation.run(row.id, row.key, row.hash, "attest.record", row.payloadJson, row.planJson);
      db.prepare("INSERT INTO attestations (operation_id) VALUES (?)").run(row.id);
    }
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* the failure already says what happened */ }
    throw error;
  } finally { db.close(); }
  return { path, batchId, firstMessage: sent[0]!, lastMessage: sent.at(-1)!, sampleOpId };
}

test("G02-ledger-r2: operational reads return complete results past the former diagnostic cap", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "oma-opread-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const seeded = seedLargeLedger(root);
  const store = new Store(seeded.path);
  try {
    // runner.pending's count is a COUNT query, not a materialized list.
    assert.equal(store.pendingDeliveryCount("alice"), UNBATCHED);
    // Complete enumerations survive whole societies, in acceptance order.
    const pending = store.pendingDeliveries("alice");
    assert.equal(pending.length, UNBATCHED);
    assert.equal(pending[0]!.messageId, seeded.firstMessage);
    assert.equal(pending.at(-1)!.messageId, seeded.lastMessage);
    // status.get's one validated projection reads every row it counts.
    const work = await store.pendingWorkRows();
    assert.equal(work.unbatched.length, UNBATCHED);
    assert.equal(work.prepared.length, 1);
    assert.equal(work.linked.length, BATCHED);
    assert.equal(work.agents.length, EXTRA_AGENTS + 1);
    const summary = pendingWorkByAgent(work).get("alice");
    assert.equal(summary?.pendingDeliveryMessages, UNBATCHED);
    assert.equal(summary?.preparedBatchCount, 1);
    assert.equal(summary?.preparedMessageCount, BATCHED);
    assert.equal(summary?.pendingMessages, UNBATCHED + BATCHED);
    // The per-agent projection recovery keeps agrees on the same complete set.
    assert.equal(pendingWork(store, "alice").pendingMessages, UNBATCHED + BATCHED);
    const status = await new ViewsModule(store, root, "demo", "p").status("alice");
    assert.deepEqual(status.map(row => [row.agent, row.pending, row.preparedBatches]), [["alice", UNBATCHED + BATCHED, 1]]);
    // The recovery snapshot lists every pending/unknown operation.
    assert.equal(store.recoverableOperations().length, UNBATCHED + BATCHED + SUBMITS + ATTESTS);
    // Whole-ledger enumerations the broker reconciles and reviews against.
    assert.equal(store.agentNames().length, EXTRA_AGENTS + 1);
    assert.equal(store.listAgents().length, EXTRA_AGENTS + 1);
    assert.equal(store.subscribers("t-shared").length, EXTRA_AGENTS + 1);
    assert.equal(store.allSubscriptions().length, EXTRA_AGENTS + 1);
    assert.equal(store.submittedOperations().length, SUBMITS);
    assert.equal(store.attestationFacts().length, ATTESTS);
    const batch = store.getBatch(seeded.batchId);
    assert.equal(batch?.agent, "alice");
    assert.equal(JSON.parse(batch!.messageIdsJson).length, BATCHED);
    assert.equal(store.preparedBatches("alice").length, 1);
    assert.equal(store.preparedBatches("alice")[0]!.id, seeded.batchId);
    // Per-operation linked reads validate the whole set, not a page of it.
    assert.equal(store.deliveriesForOperation(seeded.sampleOpId).length, 1);
    assert.equal(store.getDelivery(seeded.firstMessage, "alice")?.recipient, "alice");
    // The internal dispatcher's runner.pending answers over the same store.
    const peers = {
      requireRunnerPeer: () => undefined,
      runnerActor: () => "alice" as const,
      runnerAuth: () => ({ actor: "alice" }) as unknown as AuthContext,
    };
    const ports = { ...createInternalDispatchDataPorts(store, {} as unknown as MailModule, root), peers: projectInternalPeers(peers) };
    const dispatcher = new InternalDispatcher({
      store: ports.store, mail: ports.mail, peers: ports.peers,
      isDraining: () => false, assertAdmission: () => undefined,

      failureAnswer: (id: string, error: unknown) => ({ v: 1, id, ok: false, error }),
      refreshViews: () => undefined,
      openRun: () => Promise.reject(new Error("no run is opened here")),
    } as unknown as InternalDispatchDependencies);
    const answer = await dispatcher.dispatch(
      { v: 1, id: "pending", method: "runner.pending", params: {} },
      { pid: 1, uid: 1, gid: 1, alive: () => true, sameSender: () => false, retainForExecution: () => () => undefined, releaseConnection: () => undefined } as BoundPeer,
      null, "runner");
    assert.deepEqual(answer, { v: 1, id: "pending", ok: true,
      result: { pending: UNBATCHED, recoverableBatchIds: [seeded.batchId] } });
  } finally { store.close(); }
  // The administrator's diagnostic snapshot still enforces its documented bound.
  assert.throws(() => readDiagnosticSnapshot(root), { code: "LIMIT_EXCEEDED" });
});

test("G02-ledger-r2: operational reads propagate query failure, never a partial or empty answer", async () => {
  const db = { prepare: () => { throw new StoreError("STORE_CORRUPT", "synthetic read failure"); } } as unknown as Pick<DatabaseSync, "prepare">;
  const reader = new LedgerReader(db, "/unused", () => null);
  for (const read of [() => reader.agentNames(), () => reader.recoverableIds(), () => reader.pendingDeliveries("alice"),
    () => reader.pendingDeliveryCount("alice")])
    assert.throws(read, { code: "STORE_CORRUPT" });
  await assert.rejects(() => reader.pendingWorkRows(), { code: "STORE_CORRUPT" });
});

test("G02-ledger-r2: delivery keyset pages close before yielding and exclude later accepts", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE deliveries(message_id TEXT, recipient TEXT, materialized INTEGER, presented INTEGER, batch_id TEXT)");
    const insert = db.prepare("INSERT INTO deliveries VALUES (?, 'alice', 1, 0, NULL)");
    for (let i = 0; i < 300; i++) insert.run(`m-${i}`);
    const reader = new LedgerReader(db, "/unused", () => null);
    // This oracle isolates traversal from row/relationship decoding; actual
    // validated deliveries are exercised by the batch and mail suites.
    Object.defineProperty(reader, "deliveryRow", { value: (raw: { message_id: string }) => ({ messageId: raw.message_id }) });
    const cursor = reader.pendingDeliveryRows("alice");
    assert.equal(cursor.next().value?.messageId, "m-0");
    insert.run("later");
    db.exec("DELETE FROM deliveries WHERE message_id='m-150'");
    const rest = [...cursor].map(row => row.messageId);
    assert.equal(rest.length, 298);
    assert.equal(rest.includes("later"), false);
    assert.equal(rest.includes("m-150"), false);
    assert.equal(rest.at(-1), "m-299");
    assert.equal(new Set(rest).size, rest.length);
    assert.equal([...reader.pendingDeliveryRows("alice")].at(-1)?.messageId, "later");
  } finally { db.close(); }
});
