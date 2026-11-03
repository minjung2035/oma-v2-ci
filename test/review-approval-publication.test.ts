/** #15: acceptance is not physical publication; this read projection grants no approval authority. */
import test from "node:test";
import assert from "node:assert/strict";
import { fixture, messages } from "./fixtures/review-fixture.js";

test("001. An accepted but unpublished approval does not expose a hidden request to the Principal", async t => {
  const f = fixture({ workers: ["alice", "bob", "carol"] }); t.after(f.close);
  const candidate = f.candidateWith({ "one.txt": "a" });
  await f.submit("alice", candidate);
  await f.open("alice", { tier: "HIGH", candidate }, "open");
  const name = f.requestName("open");
  await f.vote("bob", name, "approve", "bob approves", "bob-vote");
  const materialize = f.mail.materialize.bind(f.mail);
  f.mail.materialize = async id => {
    const operation = f.store.getOperationById(id);
    if (operation?.kind === "attest.record" && operation.plan.messages.some(message => message.review?.role === "approval"))
      throw new Error("injected approval publication interruption");
    return materialize(id);
  };
  const vote = await f.vote("carol", name, "approve", "carol approves", "carol-vote");
  assert.equal(vote.state, "pending");
  const approval = messages(f, "carol", "carol-vote").find(message => message.review?.role === "approval")!;
  assert.ok(approval);
  assert.equal(f.store.getDelivery(approval.id, "principal")!.materialized, 0);
  assert.throws(() => f.reviews.status(f.auth("principal"), { name }, 65536, "hidden"), { code: "CAPABILITY_DENIED" });
  const accepted = f.store.getOperation("carol", "carol-vote")!;
  f.mail.materialize = materialize;
  await f.mail.materialize(accepted.id);
  assert.equal(f.store.getOperation("carol", "carol-vote")!.planJson, accepted.planJson);
  assert.equal(f.store.getDelivery(approval.id, "principal")!.materialized, 1);
  const visible = f.reviews.status(f.auth("principal"), { name }, 65536, "published");
  assert.ok("approval" in visible);
  assert.equal(visible.approval, approval.id);
  assert.equal(f.git(["rev-parse", "refs/heads/main"]), f.base, "publication is not a Principal decision or integration");
});
