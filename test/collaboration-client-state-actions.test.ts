/** Fresh Client effects, with real stores/repositories/receipts/native scopes.
 * No provider, whole-broker crash, product Worker activation or peer proof claimed. */
import test from "node:test";
import assert from "node:assert/strict";
import { ClientError } from "@oma/client/errors";
import { resolvedSpecOf } from "@oma/domain/agent-spec";
import { sha256Hex } from "@oma/domain/canonical-json";
import { runGitText, GIT_ENV } from "@oma/process/policies";
import { runProcessSync } from "@oma/process/run";
import { join } from "node:path";
import { collaborationClient } from "./fixtures/collaboration-client.js";

const ownReceipt = <T extends { disposition: string }>(value: T): Exclude<T, { disposition: "existing" }> => {
  if (value.disposition === "existing") assert.fail("this action must own a receipt, not an existing-proposal resolution");
  return value as Exclude<T, { disposition: "existing" }>;
};

test("001. Client: follow/unfollow affects only future accepted recipients; original replay does not resubscribe or acknowledge mail", async t => {
  const h = await collaborationClient(t), { f } = h;
  const send = (key: string) => f.mail.send(f.auth("alice"), key, { to: ["topic/parser"], kind: "message", subject: "parser", body: key });
  const original = await send("before-follow");
  assert.equal(original.state, "succeeded");
  assert.deepEqual(f.store.deliveriesForOperation(original.operation), []);
  const follow = h.call("bob", "oma_follow", { topic: "parser", enabled: true });
  const followed = ownReceipt(await follow.invoke()); assert.equal(followed.receipt.state, "succeeded");
  assert.deepEqual(f.store.subscribers("parser"), ["bob"]);
  assert.deepEqual(f.store.deliveriesForOperation(original.operation), [], "no retroactive topic delivery");
  const subscribed = await send("while-followed"), accepted = f.store.deliveriesForOperation(subscribed.operation);
  assert.equal(accepted.length, 1); assert.equal(accepted[0]!.recipient, "bob");
  const unfollowed = ownReceipt(await h.call("bob", "oma_follow", { topic: "parser", enabled: false }).invoke());
  assert.equal(unfollowed.receipt.state, "succeeded"); assert.deepEqual(f.store.subscribers("parser"), []);
  assert.deepEqual(f.store.deliveriesForOperation(subscribed.operation), accepted, "unfollow preserves already accepted recipient snapshots and ACK state");
  const replay = ownReceipt(await follow.invoke()); assert.deepEqual(replay.receipt, followed.receipt);
  assert.deepEqual(f.store.subscribers("parser"), [], "replaying an old successful follow cannot undo a later unfollow");
  const after = await send("after-unfollow"); assert.deepEqual(f.store.deliveriesForOperation(after.operation), []);
  const fresh = ownReceipt(await h.call("bob", "oma_follow", { topic: "parser", enabled: true }).invoke());
  assert.notEqual(fresh.receipt.operation, followed.receipt.operation); assert.deepEqual(f.store.subscribers("parser"), ["bob"]);
  assert.deepEqual(f.store.deliveriesForOperation(subscribed.operation), accepted);
  const beforeDenied = f.store.acceptedOperationPage().items;
  await assert.rejects(h.call("principal", "oma_follow", { topic: "parser", enabled: true }).invoke(), error => {
    assert.ok(error instanceof ClientError); assert.equal(error.code, "INVALID_REQUEST"); return true;
  });
  assert.deepEqual(f.store.acceptedOperationPage().items, beforeDenied);
});

test("002. Client: exact full-context GOAL CAS preserves other bytes, refuses stale/null overwrites and replays its original notification", async t => {
  const h = await collaborationClient(t), { f } = h;
  const repository = join(f.root, "context.git");
  assert.equal(runGitText(["init", "--bare", repository]).status, 0);
  const documents = [{ path: "GOAL.md", data: Buffer.from("Original objective\n") },
    { path: "RATIONALE.md", data: Buffer.from("\uFEFFRetain exact context bytes\r\nNo normalization.\r\n") }];
  const bytes = Buffer.concat(documents.map(document => document.data));
  const seeded = await f.module.publishContext(f.auth("principal"), "seed-context", { expected: null,
    entries: documents.map(({ path, data }) => ({ path, bytes: data.length, sha256: sha256Hex(data) })),
    content: { bytes: bytes.length, sha256: sha256Hex(bytes), mediaType: "application/vnd.oma.context-v1" } }, (async function* () { yield bytes; })());
  assert.equal(seeded.state, "succeeded"); assert.equal(seeded.result?.kind, "context.publish");
  if (seeded.result?.kind !== "context.publish") assert.fail("initial full context must exist");
  const revision = seeded.result.revision, goal = "\uFEFFNew complete objective\r\nKeep constraints and observable completion criteria.\r\n";
  const request = h.call("principal", "oma_goal", { content: { kind: "text", value: goal }, expectedRevision: revision });
  const outcome = ownReceipt(await request.invoke()); assert.equal(outcome.receipt.state, "succeeded");
  const published = f.store.getOperationById(outcome.receipt.operation); assert.ok(published?.kind === "context.publish");
  assert.equal(published.plan.base, revision);
  const read = (oid: string, path: string) => {
    const result = runProcessSync({ executable: "/usr/bin/git", argv: ["--git-dir", repository, "show", `${oid}:${path}`], env: GIT_ENV,
      timeoutMs: 10000, stdoutBytes: 8192, stderrBytes: 8192 });
    assert.equal(result.kind, "exited"); assert.equal(result.exitCode, 0, result.stderr.toString()); return result.stdout;
  };
  assert.deepEqual(read(published.plan.candidate, "RATIONALE.md"), documents[1]!.data);
  assert.deepEqual(read(published.plan.candidate, "GOAL.md"), Buffer.from(goal));
  const notification = f.mail.readRecord("bob", published.plan.message.id); assert.equal(notification.state, "published");
  if (notification.state !== "published") assert.fail("GOAL notification must materialize");
  assert.equal(notification.record.body, goal);
  assert.equal(notification.record.subject, "GOAL updated");
  const deliveries = f.store.deliveriesForOperation(published.id), count = f.store.acceptedOperationPage().items.length;
  for (const expectedRevision of [null, revision])
    await assert.rejects(h.call("principal", "oma_goal", { content: { kind: "text", value: "Cannot overwrite a later context" }, expectedRevision }).invoke(), error => {
      assert.ok(error instanceof ClientError); assert.match(error.message, /STALE_BASE|BASE_MISMATCH|context.*changed|expected.*context|CONTEXT_CONFLICT/u); return true;
    });
  assert.equal(f.store.acceptedOperationPage().items.length, count);
  assert.equal(runGitText(["rev-parse", "refs/heads/main"], { gitDir: repository }).stdout.trim(), published.plan.candidate);
  const replay = ownReceipt(await request.invoke()); assert.deepEqual(replay.receipt, outcome.receipt);
  assert.deepEqual(f.store.deliveriesForOperation(published.id), deliveries);
  assert.deepEqual(f.store.getOperationById(published.id), published);
});

test("003. Client: succeeded close proves real isolated native scope death; opening preserves individual stop ownership and old close replay has no new effect", async t => {
  const h = await collaborationClient(t), { f, units } = h;
  const agent = f.store.getAgent("bob")!, spec = resolvedSpecOf(agent);
  await units.ensureResident("bob", spec.profile, spec.modelProfile);
  await units.start("bob", false, () => {});
  assert.equal(units.confirmDead("bob", agent.incarnation), false, "native keepalive must actually be running before close");
  const desired = f.store.listAgents().map(({ name, desired, incarnation }) => ({ name, desired, incarnation }));
  const close = h.call("principal", "oma_society", { action: "close" });
  const closed = ownReceipt(await close.invoke());
  assert.equal(closed.receipt.state, "succeeded"); assert.equal(f.store.societyOpen(), false);
  assert.equal(units.confirmDead("bob", agent.incarnation), true, "success requires physical scope death, not desired=closed alone");
  assert.deepEqual(f.store.listAgents().map(({ name, desired, incarnation }) => ({ name, desired, incarnation })), desired);
  const stopped = await h.lifecycle.stop({ ...f.auth("principal"), channel: "host" }, "bob", "individual-host-stop");
  assert.equal(stopped.state, "succeeded");
  const stopOwner = f.store.latestAgentAction("bob");
  const opened = ownReceipt(await h.call("principal", "oma_society", { action: "open" }).invoke());
  assert.equal(opened.receipt.state, "succeeded"); assert.equal(f.store.societyOpen(), true);
  assert.equal(f.store.getAgent("bob")!.desired, "stopped"); assert.deepEqual(f.store.latestAgentAction("bob"), stopOwner);
  assert.equal(units.confirmDead("bob", agent.incarnation), true, "this fixture never activates product Workers");
  const replay = ownReceipt(await close.invoke()); assert.deepEqual(replay.receipt, closed.receipt);
  assert.equal(f.store.societyOpen(), true, "historical close replay cannot override the newer open fact");
});
