// R20 wiring oracle: real Store, Git objects/refs and MIME publication.
// No bundle parser sandbox or deployment gate is replaced by a fake success.
// Authored NOT_RUN; runtime execution remains a separate validation gate.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@oma/storage";
import { makeValidAgent } from "./fixtures/spec.js";
import { gitFixture, gitAuth, gitCommand, seedGit } from "./fixtures/git-crash.js";
import type { SubmitInput } from "@oma/git/submit";

async function* empty(): AsyncIterable<Uint8Array> {}
function fixture(format: "sha1" | "sha256") {
  const root = mkdtempSync(join(tmpdir(), "oma-r20-wiring-"));
  const store = new Store(join(root, "runtime.sqlite"));
  store.transaction(tx => { tx.insertAgent(makeValidAgent("a")); tx.insertAgent(makeValidAgent("b")); });
  seedGit(root, format);
  const f = gitFixture(root, store);
  const candidate = gitCommand(join(root, "seed"), ["rev-parse", "HEAD"]);
  const base = gitCommand(root, ["--git-dir", f.paths.projectGit, "rev-parse", "refs/heads/main"]);
  // Test setup imports a trusted local fixture commit. Production no-bundle
  // submission can only observe that already-present canonical object.
  gitCommand(root, ["--git-dir", f.paths.projectGit, "fetch", "--no-tags", join(root, "seed"), "HEAD"]);
  const input: SubmitInput = { candidate, exportRef: "refs/oma/export/wiring", prerequisites: [base],
    to: ["b"], subject: "wiring", body: "immutable result", paths: ["change.txt"] };
  return { ...f, root, store, candidate, base, input,
    close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

for (const format of ["sha1", "sha256"] as const) {
  test(`R20 ${format}: public submit facade supplies actual publication evidence and preserves main`, async () => {
    const f = fixture(format);
    try {
      let publications = 0;
      const publish = f.mail.publishGated.bind(f.mail);
      f.mail.publishGated = (id, proof) => {
        assert.ok(proof, "the facade must reach SubmitCoordinator, not the old unproved mail path");
        publications++;
        return publish(id, proof);
      };
      const receipt = await f.git.submit(gitAuth, "wiring", f.input, empty());
      assert.equal(receipt.state, "succeeded");
      const operation = f.store.getOperationById(receipt.operation);
      assert.ok(operation?.kind === "git.submit");
      const plan = operation.plan;
      assert.equal(plan.bundle, null);
      assert.equal(gitCommand(f.root, ["--git-dir", f.paths.projectGit, "rev-parse", plan.publishedRef]), f.candidate);
      assert.equal(gitCommand(f.root, ["--git-dir", f.paths.projectGit, "rev-parse", "refs/heads/main"]), f.base);
      const eml = readFileSync(f.mail.objectPath(plan.message.id));
      assert.deepEqual(readFileSync(f.mail.archivePath(plan.message.id)), eml);
      assert.deepEqual(readFileSync(f.mail.inboxNewPath("b", plan.message.id)), eml);
      assert.deepEqual(f.store.deliveriesForOperation(operation.id).map(row => row.materialized), [1]);
      const again = await f.git.submit(gitAuth, "wiring", f.input, empty());
      assert.deepEqual(again, receipt);
      assert.equal(publications, 1, "same-key replay must not repeat physical publication");
      assert.equal(f.store.getOperationById(operation.id)?.planJson, operation.planJson);
      assert.equal(f.store.getOperationById(operation.id)?.resultJson, operation.resultJson);
    } finally { f.close(); }
  });

  test(`R20 ${format}: a mail boundary failure recovers the original publication without rebuilding a request`, async () => {
    const f = fixture(format);
    try {
      const publish = f.mail.publishGated.bind(f.mail);
      let proofSeen = false;
      f.mail.publishGated = async (_id, proof) => {
        proofSeen = proof !== undefined;
        throw new Error("injected loss after canonical ref publication");
      };
      await assert.rejects(f.git.submit(gitAuth, "recover", f.input, empty()));
      assert.equal(proofSeen, true);
      const accepted = f.store.getOperation("a", "recover");
      assert.ok(accepted?.kind === "git.submit");
      assert.equal(accepted.state, "unknown");
      assert.equal(existsSync(f.mail.archivePath(accepted.plan.message.id)), false);
      const original = readFileSync(f.mail.objectPath(accepted.plan.message.id));
      f.mail.publishGated = publish;
      await f.git.reconcile(accepted.id);
      const settled = f.store.getOperationById(accepted.id);
      assert.ok(settled?.kind === "git.submit");
      assert.equal(settled.state, "succeeded");
      assert.equal(settled.planJson, accepted.planJson);
      assert.deepEqual(readFileSync(f.mail.archivePath(accepted.plan.message.id)), original);
      await f.git.reconcile(accepted.id);
      assert.equal(f.store.getOperationById(accepted.id)?.resultJson, settled.resultJson);
      assert.equal(gitCommand(f.root, ["--git-dir", f.paths.projectGit, "rev-parse", "refs/heads/main"]), f.base);
    } finally { f.close(); }
  });
}

test("R20: bad export ownership is rejected before staging and a foreign ref never authorizes recovery mail", async () => {
  const f = fixture("sha1");
  try {
    await assert.rejects(f.git.submit(gitAuth, "invalid", { ...f.input, exportRef: "refs/heads/main" }, empty()), { code: "INVALID_REQUEST" });
    assert.equal(f.store.getOperation("a", "invalid"), null);
    assert.equal(existsSync(join(f.root, "staging")), false);
    const publish = f.mail.publishGated.bind(f.mail);
    f.mail.publishGated = async () => { throw new Error("injected pre-mail loss"); };
    await assert.rejects(f.git.submit(gitAuth, "foreign", f.input, empty()));
    const accepted = f.store.getOperation("a", "foreign");
    assert.ok(accepted?.kind === "git.submit");
    f.mail.publishGated = publish;
    gitCommand(f.root, ["--git-dir", f.paths.projectGit, "update-ref", accepted.plan.publishedRef, f.base]);
    await f.git.reconcile(accepted.id);
    assert.equal(f.store.getOperationById(accepted.id)?.state, "unknown");
    assert.equal(f.store.getOperationById(accepted.id)?.planJson, accepted.planJson);
    assert.equal(gitCommand(f.root, ["--git-dir", f.paths.projectGit, "rev-parse", accepted.plan.publishedRef]), f.base);
    assert.equal(existsSync(f.mail.archivePath(accepted.plan.message.id)), false);
    assert.equal(f.store.getDelivery(accepted.plan.message.id, "b")?.materialized, 0);
  } finally { f.close(); }
});
