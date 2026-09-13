import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ledgerFixture } from "./helpers/ledger-fixture.mjs";
import { RegistryOperations } from "../dist/src/lifecycle/registry-operations.js";
import { reconcileMailOperation } from "../dist/src/mail/reconcile.js";
import { generateOperationId, generateMessageId } from "../dist/src/ids.js";
import { requestHash } from "../dist/src/hash.js";
import { AdmissionGate, bindAdmissionGate } from "../dist/src/domain/admission.js";
const code = expected => error => error?.code === expected;
const auth = () => ({ actor: "alice", role: "resident", incarnation: 0, channel: "actor",
  capabilities: new Set(["mail.send", "route.follow"]), peer: { pid: 1, uid: 1, gid: 1, cgroup: null } });
function mail(store) {
  const id = generateOperationId(), message = generateMessageId(id, 0);
  const payload = { to: ["alice"], subject: "fixture", body: "x", kind: "message" };
  const plan = { kind: "mail.send", message: { id: message, objectPath: `mail/objects/${message}.eml`, sha256: "a".repeat(64), bytes: 1, dateMs: Date.now(),
    to: ["alice"], recipients: ["alice"], kind: "message", contextRevision: null,
    replyHeaders: { replyTo: ["alice"], inReplyTo: null, references: [] } } };
  store.transaction(tx => {
    tx.operations.insert({ id, actor: "alice", requestKey: randomUUID(), requestHash: requestHash("mail.send", payload), kind: "mail.send", payloadJson: JSON.stringify(payload), planJson: JSON.stringify(plan) });
    tx.deliveries.insert([{ messageId: message, operationId: id, recipient: "alice" }]);
  });
  return { id, message };
}
test("P3 facets: route acceptance/retry preserves identity and fresh authority timing", t => {
  const { store } = ledgerFixture(t), registry = new RegistryOperations(store), actor = auth();
  const receipt = registry.follow(actor, "design", true, "key");
  assert.equal(receipt.state, "succeeded"); assert.deepEqual(store.subscribers("design"), ["alice"]);
  const before = store.getOperation("alice", "key");
  store.transaction(tx => tx.agents.update({ name: "alice", desired: "stopped" }));
  assert.deepEqual(registry.follow(actor, "design", true, "key"), receipt);
  assert.deepEqual(store.getOperation("alice", "key"), before);
  assert.throws(() => registry.follow(actor, "design", false, "key"), code("REQUEST_KEY_REUSED"));
  assert.throws(() => registry.follow(actor, "fresh", true, "fresh"), code("STALE_RUN"));
  assert.throws(() => registry.follow({ ...actor, incarnation: 1 }, "design", true, "key"), code("STALE_RUN"));
});
test("P3 facets: ACK and subscription mutations reuse the one transaction", t => {
  const { store } = ledgerFixture(t), registry = new RegistryOperations(store), actor = auth();
  const owned = mail(store);
  const receipt = registry.ack(actor, owned.message, "ack");
  assert.equal(receipt.state, "succeeded");
  assert.equal(store.getDelivery(owned.message, "alice").acknowledged, 1);
  assert.equal(store.getDelivery(owned.message, "alice").presented, 0);
  assert.deepEqual(registry.ack(actor, owned.message, "ack"), receipt);
  const missing = generateMessageId(generateOperationId(), 0);
  assert.throws(() => registry.ack(actor, missing, "missing"), code("REQUEST_NOT_FOUND"));
  assert.equal(store.getOperation("alice", "missing"), null);
  registry.follow(actor, "design", true, "follow");
  registry.follow(actor, "design", false, "unfollow");
  assert.deepEqual(store.subscribers("design"), []);
});
test("P3 facets: admission closure refuses fresh intent without breaking exact replay", t => {
  const { store } = ledgerFixture(t), registry = new RegistryOperations(store), actor = auth();
  const gate = new AdmissionGate(); bindAdmissionGate(store, gate);
  const original = registry.follow(actor, "design", true, "existing"); gate.close();
  assert.deepEqual(registry.follow(actor, "design", true, "existing"), original);
  assert.throws(() => registry.follow(actor, "new", true, "new"), code("BROKER_UNAVAILABLE"));
  assert.equal(store.getOperation("alice", "new"), null);
});
test("P3 facets: mail recovery does not equate materialization completion with terminal success", async t => {
  const { store, root } = ledgerFixture(t), owned = mail(store);
  const source = join(root, "object"), archive = join(root, "archive"); writeFileSync(source, "x");
  const before = store.getOperationById(owned.id);
  const boundary = { objectPath: () => source, archivePath: () => archive,
    materialize: async () => { store.transaction(tx => tx.deliveries.materialize(owned.message, "alice")); } };
  await reconcileMailOperation(store, boundary, owned.id);
  assert.equal(store.getOperationById(owned.id).state, "pending");
  // Use the real canonical result path expected by the durable relation decoder.
  const canonical = join(root, "mail/archive/cur", `${owned.message}:2,`);
  mkdirSync(join(root, "mail/archive/cur"), { recursive: true }); writeFileSync(canonical, "x");
  boundary.archivePath = () => canonical;
  await reconcileMailOperation(store, boundary, owned.id);
  const after = store.getOperationById(owned.id); assert.equal(after.state, "succeeded");
  assert.equal(after.planJson, before.planJson); assert.equal(after.requestHash, before.requestHash);
  await reconcileMailOperation(store, boundary, owned.id);
  assert.deepEqual(store.getOperationById(owned.id), after);
});
