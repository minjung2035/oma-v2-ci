import test from "node:test";
import assert from "node:assert/strict";
import { decodeRpcReply } from "@oma/protocol/response-codec";
import { fixture } from "./fixtures/review-fixture.js";
import { makeValidAgent } from "./fixtures/spec.js";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import { createChildSpecResolver } from "@oma/config/policy";
import { defaultHostConfig } from "@oma/config/defaults";
import { StoreError } from "@oma/domain/errors";
import { lifecycleReplayFixture } from "./fixtures/lifecycle-replay.js";

test("reviewer pages make progress without losing the latest ledger observation", async () => {
  const f = fixture();
  try {
    f.store.transaction(tx => {
      for (let index = 0; index < 40; index++) tx.insertAgent(makeValidAgent(`peer-${String(index).padStart(2, "0")}`));
    });
    const candidate = f.candidateWith({ "one.txt": "a" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "HIGH", candidate }, "open");
    const name = f.requestName("open");
    for (let index = 0; index < 20; index++) await f.review("bob", name, `comment-${index}`);
    const full = f.reviews.status(f.auth("bob"), { name }, 64 * 1024, "page");
    assert.ok("entries" in full);
    const metadata = { ...full, entries: [], reviewers: { items: [], next: null } };
    const budget = Buffer.byteLength(JSON.stringify({ v: 1, id: "page", ok: true, result: metadata })) + 800;
    const seen: string[] = [];
    let reviewerAfter: string | undefined;
    do {
      const page = f.reviews.status(f.auth("bob"), { name, ...(reviewerAfter === undefined ? {} : { reviewerAfter }) }, budget, "page");
      assert.ok("entries" in page);
      const reply = { v: 1, id: "page", ok: true, result: page };
      assert.ok(Buffer.byteLength(JSON.stringify(reply)) <= budget);
      assert.equal(decodeRpcReply("review.status", reply, "page", { name }).ok, true);
      assert.ok(page.reviewers.items.length > 0);
      assert.deepEqual(page.entries.at(-1), full.entries.at(-1));
      assert.ok(page.missing.some(item => item.includes("omitted for size")));
      seen.push(...page.reviewers.items.map(row => row.name));
      assert.ok(page.reviewers.next === null || page.reviewers.next > (reviewerAfter ?? ""));
      reviewerAfter = page.reviewers.next ?? undefined;
    } while (reviewerAfter !== undefined);
    assert.deepEqual(seen, full.reviewers.items.map(row => row.name));
    assert.throws(() => f.reviews.status(f.auth("bob"), { name }, 100, "page"), { code: "FRAME_TOO_LARGE" });
    assert.throws(() => f.reviews.status(f.auth("principal"), { name, reviewerAfter: "alice" }, budget, "page"),
      { code: "CAPABILITY_DENIED" });
  } finally { f.close(); }
});

test("creation observations share child resolution and distinguish unavailable policy from denied capabilities", () => {
  const f = lifecycleReplayFixture();
  try {
    const config = defaultHostConfig({ society: "replay", node: "/node", libdir: "/lib", deploymentDigest: "0".repeat(64) });
    config.agentProfiles.p = { modelProfile: "default", capabilities: ["agent.create", "mail.send"],
      delegable: ["mail.send"], childProfile: "child" };
    config.agentProfiles.child = { modelProfile: "default", capabilities: ["mail.send"], delegable: [], childProfile: null };
    let unavailable = false;
    const resolver = createChildSpecResolver(() => {
      if (unavailable) throw new StoreError("UNSUPPORTED_PROFILE", "host child policy is unavailable");
      return config;
    }, () => f.store.inTransaction);
    const lifecycle = createLifecycleModule(f.store, f.units, { stateRoot: f.root, projectGit: `${f.root}/project.git`,
      society: "replay", hasGoal: () => false, activationAllowed: () => false }, resolver,
      createMailModule({ stateRoot: f.root, society: "replay" }, f.store, 64));
    const observed = lifecycle.creation(f.auth);
    assert.equal(observed.capability, true);
    assert.equal(observed.childProfile, "child");
    assert.equal(observed.childHasMailSend, true);
    assert.equal(observed.error, undefined);
    assert.ok(observed.observedAtMs > 0);
    const resolved = resolver({ name: "manager", profile: "p", capabilities: [...f.capabilities] },
      { name: "child-a", from: "main", brief: "review" });
    assert.equal(observed.childProfile, resolved?.profile);
    assert.equal(observed.childHasMailSend, resolved?.capabilities.includes("mail.send"));
    const restricted = lifecycle.creation({ ...f.auth, capabilities: new Set() });
    assert.equal(restricted.capability, false);
    assert.equal(restricted.childProfile, "child");
    assert.equal(restricted.childHasMailSend, false);
    config.agentProfiles.p!.childProfile = null;
    const noChild = lifecycle.creation(f.auth);
    assert.equal(noChild.capability, true);
    assert.equal(noChild.childProfile, null);
    assert.equal(noChild.childHasMailSend, false);
    assert.equal(noChild.error, undefined);
    unavailable = true;
    const failed = lifecycle.creation(f.auth);
    assert.equal(failed.capability, true);
    assert.equal(failed.childProfile, null);
    assert.equal(failed.childHasMailSend, null);
    assert.equal(failed.error?.code, "UNSUPPORTED_PROFILE");
    assert.deepEqual(f.units.effects, [], "observing creation must not activate a child");
    assert.deepEqual(f.store.listAgents().map(agent => agent.name).sort(), ["a", "manager", "principal"]);
  } finally { f.close(); }
});
