import { generateOperationId } from "@oma/native/identity";
import { lifecycleLedger } from "#oma-test/app/broker/lifecycle-ledger";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AuthContext } from "@oma/contracts";
import { MailModule } from "@oma/mail";
import { ownedMessages } from "@oma/domain/durable";
import { Store } from "@oma/storage";
import { StoreError } from "@oma/domain/errors";
import { RegistryOperations } from "@oma/lifecycle/registry-operations";
import { LifecyclePolicy } from "@oma/lifecycle/policy";
import { makeValidAgent, makeValidResolvedSpec, ALL_CAPS } from "./fixtures/spec.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "oma-r25-"));
  const store = new Store(join(root, "state.sqlite"), 0, { society: "r25test" });
  store.transaction(tx => {
    tx.insertAgent(makeValidAgent("principal"));
    tx.insertAgent(makeValidAgent("alice", { createdBy: "principal" }));
    tx.insertAgent(makeValidAgent("child", { createdBy: "alice" }));
    tx.insertAgent(makeValidAgent("peer", { createdBy: "principal" }));
  });
  const auth: AuthContext = { actor: "alice", role: "resident", incarnation: 1, channel: "actor",
    capabilities: new Set(ALL_CAPS), peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } };
  return { root, store, auth, registry: new RegistryOperations(lifecycleLedger(store), { nextOperationId: generateOperationId }), close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}
const code = (expected: string) => (error: unknown) => error instanceof StoreError && error.code === expected;

test("R25: subscription replay keeps one durable identity and unchanged terminal bytes", t => {
  const f = fixture(); t.after(() => f.close());
  const key = randomUUID();
  const first = f.registry.follow(f.auth, "updates", true, key);
  assert.equal(first.state, "succeeded");
  const before = f.store.getOperation(f.auth.actor, key);
  assert.ok(before);
  const again = f.registry.follow(f.auth, "updates", true, key);
  assert.deepEqual(again, first);
  assert.deepEqual(f.store.subscribers("updates"), ["alice"]);
  assert.equal(f.store.getOperation(f.auth.actor, key)?.resultJson, before.resultJson);
  assert.throws(() => f.registry.follow(f.auth, "other", true, key), code("REQUEST_KEY_REUSED"));
});

test("R25: identity-only subscription replay does not authorize a fresh stopped-actor action", t => {
  const f = fixture(); t.after(() => f.close());
  const key = randomUUID();
  const first = f.registry.follow(f.auth, "updates", true, key);
  f.store.transaction(tx => tx.updateAgent({ name: "alice", desired: "stopped" }));
  assert.deepEqual(f.registry.follow(f.auth, "updates", true, key), first);
  const nextKey = randomUUID();
  assert.throws(() => f.registry.follow(f.auth, "updates", false, nextKey), code("STALE_RUN"));
  assert.equal(f.store.getOperation("alice", nextKey), null);
  assert.throws(() => f.registry.follow({ ...f.auth, incarnation: 0 }, "updates", true, key), code("STALE_RUN"));
});

test("R25: management scope uses the same lineage and current live lease", t => {
  const f = fixture(); t.after(() => f.close());
  const policy = new LifecyclePolicy(lifecycleLedger(f.store), (_parent, input) => makeValidResolvedSpec(input.name, "p", ALL_CAPS, input.from, input.brief));
  assert.doesNotThrow(() => policy.requireManage(f.auth, "alice"));
  assert.doesNotThrow(() => policy.requireManage(f.auth, "child"));
  assert.throws(() => policy.requireManage(f.auth, "peer"), code("CAPABILITY_DENIED"));
  assert.throws(() => policy.requireManage({ ...f.auth, capabilities: new Set() }, "child"), code("CAPABILITY_DENIED"));
  f.store.transaction(tx => tx.updateAgent({ name: "alice", desired: "stopped" }));
  assert.throws(() => policy.requireManage(f.auth, "child"), code("STALE_RUN"));
});

test("R25: host refresh and transaction-time revision comparison are separate", t => {
  const f = fixture(); t.after(() => f.close());
  let revision = "first"; let refreshes = 0;
  const resolver = Object.assign((_parent: unknown, input: { name: string; from: string; brief: string }) =>
    makeValidResolvedSpec(input.name, "p", ALL_CAPS, input.from, input.brief), {
    refresh() { assert.equal(f.store.inTransaction, false); refreshes++; },
    revision() { return revision; },
  });
  const policy = new LifecyclePolicy(lifecycleLedger(f.store), resolver);
  const observed = policy.refresh();
  assert.equal(refreshes, 1);
  f.store.transaction(() => policy.assertRevision(observed));
  revision = "changed";
  assert.throws(() => f.store.transaction(() => policy.assertRevision(observed)), code("POLICY_CHANGED"));
  assert.equal(refreshes, 1);
});


test("DR27: ACK explains absent message versus another recipient without creating a fact", async t => {
  const f = fixture(); t.after(() => f.close());
  const mail = createMailModule({ stateRoot: f.root, society: "r25test" }, f.store, 64);
  await mail.send(f.auth, "to-peer", { to: ["peer"], kind: "message", subject: "review", body: "body" });
  const operation = f.store.getOperation("alice", "to-peer")!;
  const message = ownedMessages(operation.plan)[0]!;
  assert.throws(() => f.registry.ack(f.auth, message.id, "not-mine"), (error: unknown) =>
    error instanceof StoreError && error.code === "REQUEST_NOT_FOUND" && /not addressed to alice/.test(error.message));
  const absent = message.id.replace(/-[0-9]+$/, "-999");
  assert.throws(() => f.registry.ack(f.auth, absent, "absent"), (error: unknown) =>
    error instanceof StoreError && error.code === "REQUEST_NOT_FOUND" && /does not exist in this society/.test(error.message));
  assert.equal(f.store.getOperation("alice", "not-mine"), null);
  assert.equal(f.store.getOperation("alice", "absent"), null);
  assert.equal(f.store.getDelivery(message.id, "peer")?.acknowledged, 0);
  const peer = { ...f.auth, actor: "peer" };
  const receipt = f.registry.ack(peer, message.id, "ack-mine");
  assert.equal(receipt.state, "succeeded");
  f.store.transaction(tx => tx.updateAgent({ name: "peer", desired: "stopped" }));
  assert.deepEqual(f.registry.ack(peer, message.id, "ack-mine"), receipt);
});
