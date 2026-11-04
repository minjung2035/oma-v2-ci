/** Registered current Worker tools -> original SDK journal -> real Unix
 * dispatcher -> original Review/Mail/Git owners. Authentication is a fixture
 * input. Actual native Worker/provider paths are covered by scenario tests. */
import test from "node:test";
import assert from "node:assert/strict";
import { collaborationClient } from "./fixtures/collaboration-client.js";
import { CollaborationMailViews } from "#oma-test/app/views/collaboration-mail";
import { inboxCount } from "./fixtures/review-fixture.js";

type Harness = Awaited<ReturnType<typeof collaborationClient>>;
const execute = async (h: Harness, actor: string, tool: string, args: Parameters<Harness["call"]>[2]) =>
  JSON.parse((await h.call(actor, tool, args).invokeTool()).content[0]!.text!);
async function open(h: Harness, tier: "LOW" | "MEDIUM" | "HIGH") {
  const candidate = h.f.candidateWith({ "work.txt": "exact committed work\n" });
  await h.f.submit("alice", candidate);
  const result = await execute(h, "alice", "oma_merge", { tier, title: "Worker proposal", reason: "Ready for independent review",
    change: { candidate, base: h.f.base } });
  assert.equal(result.receipt.state, "succeeded");
  const op = h.f.store.getOperationById(result.receipt.operation);
  assert.ok(op?.kind === "attest.record" && op.plan.fact.kind === "merge.open");
  return { request: op.id, name: op.plan.fact.name, candidate, op };
}
const main = (h: Harness) => h.f.git(["rev-parse", "refs/heads/main"]);
async function vote(h: Harness, actor: string, request: string, decision: "approve" | "reject" = "approve") {
  return execute(h, actor, "oma_review", { target: h.target(actor, request, "review"), decision, reason: "Independent exact-source findings" });
}

test("001. A LOW merge through a Worker's own tools applies and notifies commons+principal", async t => {
  const h = await collaborationClient(t), proposal = await open(h, "LOW");
  assert.equal(main(h), proposal.candidate);
  for (const actor of ["alice", "bob", "principal"]) assert.ok(inboxCount(h.f, actor) > 0, `${actor} missed its notice`);
  const integrations = h.f.store.acceptedOperationPage().items.filter(row => row.operation.kind === "git.integrate");
  assert.equal(integrations.length, 1);
});

test("002. A MEDIUM merge needs one peer vote; the other Worker supplies it through the tools", async t => {
  const h = await collaborationClient(t), proposal = await open(h, "MEDIUM");
  assert.equal(main(h), h.f.base); assert.equal(inboxCount(h.f, "principal"), 0);
  const result = await vote(h, "bob", proposal.request);
  assert.equal(result.receipt.state, "succeeded");
  assert.equal(main(h), proposal.candidate);
  assert.ok(inboxCount(h.f, "principal") > 0);
});

test("003. The requester withdraws a HIGH submission; a later exact Worker vote creates no accepted effect", async t => {
  const h = await collaborationClient(t), proposal = await open(h, "HIGH"), stale = h.target("bob", proposal.request, "review");
  const result = await execute(h, "alice", "oma_review", { target: h.target("alice", proposal.request, "submission"), decision: "withdraw", reason: "Cancel exactly this proposal" });
  assert.equal(result.receipt.state, "succeeded");
  const before = h.f.store.acceptedOperationPage().items;
  const refused = await execute(h, "bob", "oma_review", { target: stale, decision: "approve", reason: "Cannot resurrect a closed submission" });
  assert.match(JSON.stringify(refused), /STALE_TARGET|APPROVAL_STALE|REQUEST_CLOSED|WRONG_TARGET_KIND/);
  assert.deepEqual(h.f.store.acceptedOperationPage().items, before);
  assert.equal(main(h), h.f.base);
});

test("004. Self-review and authored approval authority refuse; a fresh exact vote supersedes only its owner's earlier verdict", async t => {
  const h = await collaborationClient(t), proposal = await open(h, "HIGH");
  const self = await execute(h, "alice", "oma_review", { target: h.target("alice", proposal.request, "proposal"), decision: "approve", reason: "Cannot approve myself" });
  assert.match(JSON.stringify(self), /SELF_REVIEW|CAPABILITY_DENIED|WRONG_TARGET_KIND/);
  const target = h.target("bob", proposal.request, "review"), calls = h.calls.length;
  await assert.rejects(h.call("bob", "oma_review", { target, decision: "approve", reason: "No invented approval", approval: "mail-id" }).invokeTool(), /INVALID_ARGUMENT/);
  assert.equal(h.calls.length, calls);
  const approved = await vote(h, "bob", proposal.request), rejected = await vote(h, "bob", proposal.request, "reject");
  assert.equal(approved.receipt.state, "succeeded"); assert.equal(rejected.receipt.state, "succeeded");
  assert.notEqual(approved.receipt.operation, rejected.receipt.operation);
  const facts = h.f.store.attestations.all().map(row => row.operation).filter(op => op.actor === "bob" && op.plan.fact.kind === "vote");
  assert.equal(facts.length, 2); assert.equal(main(h), h.f.base);
});

test("005. A HIGH challenge opened by tool reverts an applied merge on the Principal's exact vote", async t => {
  const h = await collaborationClient(t), merged = await open(h, "LOW");
  const correction = await execute(h, "bob", "oma_challenge", { merge: h.target("bob", merged.request, "applied"), tier: "HIGH", reason: "Regression in the exact applied change" });
  assert.equal(correction.receipt.state, "succeeded");
  const op = h.f.store.getOperationById(correction.receipt.operation);
  assert.ok(op?.kind === "attest.record" && op.plan.fact.kind === "challenge.open");
  for (const actor of ["carol", "dave"]) assert.equal((await vote(h, actor, op.id)).receipt.state, "succeeded");
  assert.equal(main(h), merged.candidate);
  assert.equal((await vote(h, "principal", op.id)).receipt.state, "succeeded");
  assert.notEqual(main(h), merged.candidate);
  assert.equal(h.f.git(["ls-tree", "--name-only", "refs/heads/main"]), "");
});

test("006. Re-executing one original Pi open observes its frozen receipt without a second publication or record", async t => {
  const h = await collaborationClient(t), candidate = h.f.candidateWith({ "replay.txt": "frozen work\n" });
  await h.f.submit("alice", candidate);
  const original = h.call("alice", "oma_merge", { tier: "HIGH", reason: "Original call", change: { candidate, base: h.f.base } });
  const first = JSON.parse((await original.invokeTool()).content[0]!.text!);
  const before = h.f.store.acceptedOperationPage().items;
  const again = JSON.parse((await original.invokeTool()).content[0]!.text!);
  assert.deepEqual(again.receipt, first.receipt);
  assert.deepEqual(h.f.store.acceptedOperationPage().items, before);
  assert.equal(h.calls.filter(row => row.method === "attest.record").length, 1);
});

test("007. Worker discussion uses explicit threaded mail and grants no review authority or Principal delivery", async t => {
  const h = await collaborationClient(t), proposal = await open(h, "MEDIUM");
  const message = proposal.op.plan.messages[0]!.id;
  new CollaborationMailViews(h.f.store, h.f.mail, h.f.root, "demo").publishRecords("bob", [message]);
  const before = h.f.store.attestations.all();
  const result = await execute(h, "bob", "oma_send", { to: ["alice"], replyTo: message,
    content: { kind: "text", value: "Looks promising; please include the tests." } });
  assert.equal(result.receipt.state, "succeeded");
  const op = h.f.store.getOperationById(result.receipt.operation);
  assert.ok(op?.kind === "mail.send");
  assert.ok(op.plan.message.replyHeaders.inReplyTo?.includes(message));
  assert.deepEqual(h.f.store.attestations.all(), before);
  assert.equal(inboxCount(h.f, "principal"), 0); assert.equal(main(h), h.f.base);
});
