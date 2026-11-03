/** DR72/MCS-S13: an old accepted integration plan is data, not a current executor.
 * Real Store/Mail/Git; direct component auth is a fixture, not peer qualification. */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import type { Receipt } from "@oma/contracts";
import { withAsyncCleanup } from "@oma/native/cleanup";
import { applyRequestKeyFor } from "@oma/domain/identifiers";
import { requestHash } from "@oma/domain/request-identity";
import { serializePlanIntent } from "./fixtures/plan.js";
import { fixture } from "./fixtures/review-fixture.js";

const freshRecovery = `
  import assert from "node:assert/strict";
  import { join } from "node:path";
  import { Store } from "@oma/storage";
  import { createMailModule } from "#oma-test/app/broker/mail-composition";
  import { createGitServices } from "#oma-test/app/broker/git-composition";
  const [root, id, rawPolicy] = process.argv.slice(1);
  const policy = JSON.parse(rawPolicy);
  const store = new Store(join(root, "runtime.sqlite"), 0, { society: "demo" });
  try {
    const original = store.getOperationById(id);
    assert.equal(original?.kind, "git.integrate");
    const paths = { stateRoot: root, society: "demo", projectGit: join(root, "repos/project.git"),
      contextGit: join(root, "context.git"), worldDir: join(root, "world") };
    const mail = createMailModule(paths, store, 64);
    const { git } = createGitServices(paths, store, mail, policy, () => policy);
    await assert.rejects(git.reconcile(id), { code: "UNSUPPORTED_PROFILE" });
    assert.deepEqual(store.getOperationById(id), original);
    console.log(JSON.stringify({ pid: process.pid, state: original.state,
      payloadJson: original.payloadJson, planJson: original.planJson, requestHash: original.requestHash }));
  } finally { store.close(); }
`;

for (const version of [1, 2] as const) for (const state of ["pending", "unknown"] as const) {
  for (const main of ["base", "candidate", "third"] as const) {
    test(`001. Accepted integration v${version}/${state}/${main}: current scope cannot promote the original direct plan`, { timeout: 30_000 }, async () => {
      const f = fixture();
      let release!: () => void, entered!: () => void;
      const held = new Promise<void>(resolve => { release = resolve; });
      const ready = new Promise<void>(resolve => { entered = resolve; });
      let voting: Promise<Receipt> | undefined;
      await withAsyncCleanup(async () => {
        const candidate = f.candidateWith({ "original.txt": "original accepted candidate\n" });
        await f.submit("alice", candidate, "source");
        await f.open("alice", { tier: "MEDIUM", candidate }, "current-original-scope");
        const open = f.store.getOperation("alice", "current-original-scope")!;
        assert.ok(open.kind === "attest.record");
        assert.equal(open.plan.fact.version, 3);
        const materialize = f.mail.materialize.bind(f.mail);
        // Hold a real accepted qualified vote before its materialization/advance.
        // No fake quorum, missing preparation callback, or legacy live factory.
        f.mail.materialize = async id => {
          const operation = f.store.getOperationById(id);
          if (operation?.kind === "attest.record" && operation.actor === "bob" && operation.plan.fact.kind === "vote") {
            entered(); await held;
          }
          await materialize(id);
        };
        voting = f.vote("bob", f.requestName("current-original-scope"), "approve", "qualified current vote", "current-vote");
        await Promise.race([ready, voting.then(() => { throw new Error("the vote did not reach the owned materialization hold"); })]);
        const scope = f.stateOf(f.requestName("current-original-scope"));
        assert.equal(scope.ready, true);
        assert.equal(scope.preparation, null);
        const policy = f.module.boundPolicy()!;
        const id = "op-00000000-0000-4000-8000-000000000009";
        const key = applyRequestKeyFor(open.id);
        const input = { candidate, expected: f.base, tier: "MEDIUM" as const };
        const payloadJson = JSON.stringify(input, null, 2) + "\n";
        const planJson = serializePlanIntent({ kind: "git.integrate", repo: "project", target: "refs/heads/main",
          base: f.base, candidate, policyRevision: policy.policyRevision,
          checkProfileDigest: policy.checkProfileDigest, policyIdentity: policy.policyIdentity, noopRef: null,
          merge: { version, request: open.id, name: scope.name, tier: "MEDIUM", notice: [],
            ...(version === 2 ? { revision: 0, attemptNumber: 0 } : {}) } });
        // Explicit original stored corpus, using the original acceptance/decoder
        // owner; not a callable compatibility API or migration/drain qualification.
        f.store.transaction(tx => {
          tx.acceptOperation({ id, actor: "alice", requestKey: key, kind: "git.integrate",
            requestHash: requestHash("git.integrate", input), payloadJson, planJson });
          if (state === "unknown") tx.setOperationUnknown(id);
        });
        const original = f.store.getOperationById(id)!;
        assert.ok(original.kind === "git.integrate");
        assert.equal(original.state, state);
        assert.equal(original.planJson, planJson);
        assert.equal(original.payloadJson, payloadJson);
        if (main !== "base") {
          const target = main === "candidate" ? candidate : f.candidateWith({ "third.txt": "independent main\n" });
          f.git(["update-ref", "refs/heads/main", target, f.base]);
        }
        const refs = f.git(["for-each-ref", "--format=%(refname) %(objectname)"]);
        const facts = f.store.attestations.all();
        await assert.rejects(async () => {
          try { await f.module.applyMerge(original); }
          finally {
            console.error(JSON.stringify({ event: "retired-integration-observation", version, originalState: state,
              originalMain: main, base: f.base, candidate, observedMain: f.git(["rev-parse", "refs/heads/main"]),
              observedState: f.store.getOperationById(id)?.state }));
          }
        }, { code: "UNSUPPORTED_PROFILE" });
        assert.deepEqual(f.store.getOperationById(id), original);
        assert.deepEqual(f.store.attestations.all(), facts);
        assert.equal(f.git(["for-each-ref", "--format=%(refname) %(objectname)"]), refs);
        release();
        await voting;
        voting = undefined;
        assert.deepEqual(f.store.getOperationById(id), original, "the current vote continuation cannot execute the old plan");
        for (let reopen = 0; reopen < 2; reopen++) {
          f.reopen();
          await assert.rejects(f.module.reconcile(id), { code: "UNSUPPORTED_PROFILE" });
          assert.deepEqual(f.store.getOperationById(id), original);
          const replay = await f.module.integrate(f.auth("alice"), key, input);
          assert.deepEqual(replay, { operation: id, state }, "same-key observation is not execution or terminalization");
          assert.deepEqual(f.store.getOperationById(id), original);
          assert.equal(f.git(["for-each-ref", "--format=%(refname) %(objectname)"]), refs);
        }
        const factsAfterVote = f.store.attestations.all();
        const child = JSON.parse(execFileSync(process.execPath,
          ["--input-type=module", "--eval", freshRecovery, f.root, id, JSON.stringify(f.policy)],
          { encoding: "utf8", timeout: 10_000, env: { ...process.env, NODE_DISABLE_COMPILE_CACHE: "1" } }));
        assert.ok(Number.isSafeInteger(child.pid) && child.pid > 0 && child.pid !== process.pid);
        assert.deepEqual(child, { pid: child.pid, state, payloadJson, planJson, requestHash: original.requestHash });
        assert.deepEqual(f.store.getOperationById(id), original);
        assert.deepEqual(f.store.attestations.all(), factsAfterVote);
        assert.equal(f.git(["for-each-ref", "--format=%(refname) %(objectname)"]), refs);
      }, async () => {
        release();
        await withAsyncCleanup(async () => { await voting; }, () => f.close());
      });
    });
  }
}

test("002. Current direct-integration refusal never advertises retired review tools", async () => {
  const f = fixture();
  try {
    const input = { candidate: f.candidateWith({ "fresh.txt": "fresh\n" }), expected: f.base };
    const refs = f.git(["for-each-ref", "--format=%(refname) %(objectname)"]);
    await assert.rejects(f.module.integrate(f.auth("alice"), "fresh-direct", input), (error: unknown) => {
      assert.ok(error instanceof Error && "code" in error);
      assert.equal(error.code, "UNSUPPORTED_PROFILE");
      assert.match(error.message, /current reviewed collaboration path/);
      assert.doesNotMatch(error.message, /oma_merge_open|oma_challenge_open|oma_review_status|oma_review_diff|oma_review_respond/);
      return true;
    });
    assert.equal(f.store.getOperation("alice", "fresh-direct"), null);
    assert.equal(f.git(["for-each-ref", "--format=%(refname) %(objectname)"]), refs);
  } finally { f.close(); }
});

for (const version of [1, 2] as const) for (const state of ["succeeded", "failed"] as const) {
  test(`003. Terminal integration v${version}/${state}: original receipt is data under unavailable current policy`, async () => {
    let unavailable = false, reads = 0;
    const f = fixture({ reader: policy => { reads++; if (unavailable) throw new Error("current policy unavailable"); return policy; } });
    try {
      const candidate = f.candidateWith({ "terminal.txt": "original terminal candidate\n" });
      await f.submit("alice", candidate, "terminal-source");
      await f.open("alice", { tier: "MEDIUM", candidate }, "terminal-scope");
      const open = f.store.getOperation("alice", "terminal-scope")!;
      const policy = f.module.boundPolicy()!;
      const id = "op-00000000-0000-4000-8000-000000000009", key = applyRequestKeyFor(open.id);
      const name = f.requestName("terminal-scope");
      const input = { candidate, expected: f.base, tier: "MEDIUM" as const };
      const planJson = serializePlanIntent({ kind: "git.integrate", repo: "project", target: "refs/heads/main",
        base: f.base, candidate, policyRevision: policy.policyRevision, checkProfileDigest: policy.checkProfileDigest,
        policyIdentity: policy.policyIdentity, noopRef: null, merge: { version, request: open.id, name, tier: "MEDIUM", notice: [],
          ...(version === 2 ? { revision: 0, attemptNumber: 0 } : {}) } });
      const result = { kind: "git.integrate", base: f.base, candidate, target: "refs/heads/main",
        policyRevision: policy.policyRevision, changed: true, merge: { name, notices: [], recipientCount: 0 } };
      // Explicit historical corpus and original effect, not a live legacy executor.
      if (state === "succeeded") f.git(["update-ref", "refs/heads/main", candidate, f.base]);
      f.store.transaction(tx => {
        tx.acceptOperation({ id, actor: "alice", requestKey: key, kind: "git.integrate", requestHash: requestHash("git.integrate", input),
          payloadJson: JSON.stringify(input, null, 2) + "\n", planJson });
        if (state === "succeeded") tx.setOperationSucceeded(id, JSON.stringify(result, null, 2) + "\n");
        else tx.setOperationFailed(id, "CHECK_FAILED");
      });
      const original = f.store.getOperationById(id)!;
      assert.ok(original.kind === "git.integrate");
      const refs = f.git(["for-each-ref", "--format=%(refname) %(objectname)"]), beforeReads = reads;
      unavailable = true;
      for (let reopen = 0; reopen < 2; reopen++) {
        f.reopen();
        const restored = f.store.getOperationById(id);
        assert.ok(restored?.kind === "git.integrate");
        await f.module.applyMerge(restored);
        await f.module.reconcile(id);
        const receipt = await f.module.integrate(f.auth("alice"), key, input);
        assert.deepEqual(receipt, state === "succeeded" ? { operation: id, state, result }
          : { operation: id, state, error: { code: "CHECK_FAILED", message: "CHECK_FAILED", retry: "never" } });
        assert.deepEqual(f.store.getOperationById(id), original);
        assert.equal(f.git(["for-each-ref", "--format=%(refname) %(objectname)"]), refs);
        assert.equal(reads, beforeReads, "terminal replay must not consult current policy");
      }
    } finally { f.close(); }
  });
}
