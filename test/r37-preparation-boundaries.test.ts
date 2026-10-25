import { lifecycleEffects } from "#oma-test/app/broker/lifecycle-composition";
import { lifecycleLedger } from "#oma-test/app/broker/lifecycle-ledger";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@oma/storage";
import { sha256Hex } from "@oma/domain/canonical-json";
import { QuarantineImporter } from "@oma/git/quarantine";
import { ContextRepository } from "@oma/git/context-repository";
import { CreateCoordinator } from "@oma/lifecycle/create";
import { WorkspaceCoordinator } from "@oma/git/workspace";
import { LifecyclePolicy } from "@oma/lifecycle/policy";
import { PolicyExecution } from "./fixtures/execution.js";
import { gitFixture, seedGit, gitCommand, gitAuth } from "./fixtures/git-crash.js";
import { makeValidAgent, makeValidResolvedSpec, ALL_CAPS } from "./fixtures/spec.js";
import { removeTree } from "./fixtures/cleanup.js";
import { StoreError, publicFailure } from "@oma/domain/errors";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}
async function atBoundary(entered: Promise<void>, work: Promise<unknown>): Promise<void> {
  await Promise.race([entered, work.then(() => { throw new Error("workflow completed before the controlled preparation boundary"); })]);
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "oma-r37-boundary-"));
  seedGit(root);
  const base = gitCommand(root, ["--git-dir", join(root, "repos/project.git"), "rev-parse", "refs/heads/main"]);
  const store = new Store(join(root, "runtime.sqlite"));
  store.transaction(tx => {
    tx.insertAgent(makeValidAgent("principal", { from: base }));
    for (const name of ["a", "b"]) tx.insertAgent(makeValidAgent(name, { from: base, createdBy: "principal" }));
  });
  const caps = new Set(ALL_CAPS);
  const auth = { ...gitAuth, capabilities: caps };
  return { root, base, store, caps, auth, ...gitFixture(root, store),
    close() { store.close(); removeTree(root); } };
}

test("R37: submit facade awaits quarantined preparation and retains accepted bundle after live revocation", { timeout: 30000 }, async () => {
  const f = fixture(); const entered = deferred(); const release = deferred();
  const original = QuarantineImporter.prototype.importBundle;
  // A controlled pending effect, not a replacement for a successful isolation proof.
  QuarantineImporter.prototype.importBundle = async () => { entered.resolve(); await release.promise; };
  let work: Promise<unknown> | undefined;
  try {
    const body = readFileSync(join(f.root, "candidate.bundle"));
    const candidate = gitCommand(join(f.root, "seed"), ["rev-parse", "HEAD"]);
    work = f.git.submit(f.auth, "await-import", { candidate, exportRef: "refs/oma/export/crash", prerequisites: [f.base],
      to: ["b"], subject: "candidate", body: "body", paths: [],
      bundle: { bytes: body.length, sha256: sha256Hex(body), mediaType: "application/x-git-bundle" } },
      (async function* () { yield body; })());
    let settled = false; void work.then(() => { settled = true; }, () => { settled = true; });
    await atBoundary(entered.promise, work); await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false, "a facade must not discard the import Promise");
    const accepted = f.store.getOperation("a", "await-import");
    assert.ok(accepted?.kind === "git.submit"); assert.equal(accepted.state, "pending");
    const before = accepted.planJson; assert.ok(accepted.plan.bundle);
    const bundlePath = accepted.plan.bundle.path;
    assert.equal(gitCommand(f.root, ["--git-dir", f.paths.projectGit, "for-each-ref", "--format=%(refname)", accepted.plan.publishedRef]), "");
    const rejected = assert.rejects(work, { code: "CAPABILITY_DENIED" });
    f.caps.delete("git.submit"); release.resolve(); await rejected;
    assert.equal(f.store.getOperation("a", "await-import")?.planJson, before);
    assert.equal(existsSync(bundlePath), true, "accepted bundle evidence is not connection-owned cleanup");
    assert.equal(gitCommand(f.root, ["--git-dir", f.paths.projectGit, "for-each-ref", "--format=%(refname)", accepted.plan.publishedRef]), "");
  } finally {
    release.resolve(); await work?.catch(() => undefined);
    QuarantineImporter.prototype.importBundle = original; f.close();
  }
});

for (const change of ["none", "revoke", "main"] as const) {
  test(`R37: context preparation boundary preserves ${change === "none" ? "the successful control" : change + " rejection"}`,
    { skip: process.platform !== "linux", timeout: 30000 }, async () => {
      const f = fixture(); const entered = deferred(); const release = deferred();
      const original = ContextRepository.prototype.prepareCandidate;
      let prepared: string | null = null; let work: Promise<unknown> | undefined;
      ContextRepository.prototype.prepareCandidate = async function(tree, entries, expected) {
        const candidate = await original.call(this, tree, entries, expected);
        prepared = candidate; entered.resolve(); await release.promise; return candidate;
      };
      try {
        const body = Buffer.from("# GOAL\nR37 immutable context\n");
        work = f.git.publishContext(f.auth, "context-await", { expected: null,
          entries: [{ path: "GOAL.md", bytes: body.length, sha256: sha256Hex(body) }],
          content: { bytes: body.length, sha256: sha256Hex(body), mediaType: "application/vnd.oma.context-v1" } },
          (async function* () { yield body; })());
        void work.catch(() => undefined);
        await atBoundary(entered.promise, work);
        assert.equal(f.store.getOperation("a", "context-await"), null);
        assert.ok(prepared);
        if (change === "revoke") f.caps.delete("context.publish");
        if (change === "main") gitCommand(f.root, ["--git-dir", f.paths.contextGit, "update-ref", "refs/heads/main", prepared]);
        const assertion = change === "none" ? null : assert.rejects(work, { code: change === "revoke" ? "CAPABILITY_DENIED" : "CONTEXT_CONFLICT" });
        release.resolve();
        if (assertion) {
          await assertion; assert.equal(f.store.getOperation("a", "context-await"), null);
        } else {
          await work;
          const accepted = f.store.getOperation("a", "context-await");
          assert.ok(accepted?.kind === "context.publish"); assert.equal(accepted.state, "succeeded");
          assert.equal(accepted.plan.candidate, prepared);
        }
        const main = gitCommand(f.root, ["--git-dir", f.paths.contextGit, "for-each-ref", "--format=%(objectname)", "refs/heads/main"]);
        assert.equal(main, change === "revoke" ? "" : prepared);
      } finally {
        release.resolve(); await work?.catch(() => undefined);
        ContextRepository.prototype.prepareCandidate = original; f.close();
      }
    });
}

test("R37: creation awaits a real private workspace before unit publication and rechecks the live lease", { skip: process.platform !== "linux", timeout: 30000 }, async () => {
  const f = fixture(); const entered = deferred(); const release = deferred();
  const paths = { stateRoot: f.root, projectGit: f.paths.projectGit, society: "crash", hasGoal: () => false, activationAllowed: () => true };
  const workspace = new WorkspaceCoordinator(paths); const original = workspace.ensure.bind(workspace);
  workspace.ensure = async plan => { await original(plan); entered.resolve(); await release.promise; };
  const units = new PolicyExecution();
  let unitPublications = 0;
  units.ensureResident = () => { unitPublications++; throw new Error("unit publication must not be reached after revocation"); };
  const policy = new LifecyclePolicy(lifecycleLedger(f.store), (_parent, input) => makeValidResolvedSpec(input.name, "p", ALL_CAPS, input.from, input.brief));
  const creates = new CreateCoordinator(lifecycleLedger(f.store), units, paths, policy, workspace, f.mail, lifecycleEffects(paths.stateRoot));
  let work: Promise<unknown> | undefined;
  try {
    work = creates.create(f.auth, { name: "child", from: f.base, brief: "child" }, "create-await");
    void work.catch(() => undefined);
    await atBoundary(entered.promise, work);
    const accepted = f.store.getOperation("a", "create-await");
    assert.ok(accepted?.kind === "agent.create"); assert.equal(accepted.state, "pending");
    assert.equal(unitPublications, 0); assert.equal(existsSync(join(accepted.plan.workspacePath, ".git")), true);
    const before = accepted.planJson;
    const rejected = assert.rejects(work, { code: "CAPABILITY_DENIED" });
    f.caps.delete("agent.create"); release.resolve(); await rejected;
    assert.equal(unitPublications, 0);
    assert.equal(f.store.getOperation("a", "create-await")?.planJson, before);
    assert.equal(f.store.getAgent("child")?.desired, "provisioning");
    assert.equal(existsSync(accepted.plan.workspacePath), true);
  } finally { release.resolve(); await work?.catch(() => undefined); f.close(); }
});

/** AV27 -- GIT-002: the ninth functional run. A Resident told by a submit mail
 * to `git fetch origin <published-ref>` got "does not appear to be a git
 * repository": the workspace was cloned on the host from the host path, and
 * its `origin` named that path, which the sandbox does not have. GIT-002's
 * clone is from /git/project.git, the Resident's mount. */
test("AV27 / GIT-002: a new workspace's origin is the canonical repository as its Resident reaches it", { skip: process.platform !== "linux", timeout: 30000 }, async () => {
  // w11/U1: every Resident is confined, so the origin is always the sandbox
  // mount -- an omitted override resolves to the default mount, never to the
  // host path the unconfined profile once used.
  for (const residentProjectGit of ["/git/project.git", undefined]) {
    const f = fixture();
    try {
      const paths = { stateRoot: f.root, projectGit: f.paths.projectGit, society: "crash", hasGoal: () => false, activationAllowed: () => true,
        ...(residentProjectGit === undefined ? {} : { residentProjectGit }) };
      const workspace = new WorkspaceCoordinator(paths);
      const units = new PolicyExecution();
      // Stop after the workspace: this is about what the preparation left.
      units.ensureResident = () => { throw new Error("stop after the workspace"); };
      const policy = new LifecyclePolicy(lifecycleLedger(f.store), (_parent, input) => makeValidResolvedSpec(input.name, "p", ALL_CAPS, input.from, input.brief));
      const creates = new CreateCoordinator(lifecycleLedger(f.store), units, paths, policy, workspace, f.mail, lifecycleEffects(paths.stateRoot));
      await creates.create(f.auth, { name: "child", from: f.base, brief: "child" }, "create-origin").catch(() => undefined);
      const accepted = f.store.getOperation("a", "create-origin");
      assert.ok(accepted?.kind === "agent.create");
      assert.equal(gitCommand(accepted.plan.workspacePath, ["remote", "get-url", "origin"]), residentProjectGit ?? "/git/project.git");
      assert.equal(gitCommand(accepted.plan.workspacePath, ["rev-parse", "HEAD"]), f.base, "the base still came from the host path");
    } finally { f.close(); }
  }
});

/** AV28 -- the error table ("STALE_BASE, NOT_DESCENDANT: actual OID 반환") and
 * arch §11 ("main이 이동하면 STALE_BASE와 actual OID를 반환한다"): the ninth
 * functional run's second integrate answered "STALE_BASE: STALE_BASE" and
 * nothing else, so the integrator had to find main by itself. */
test("AV28 / ERR-001, arch §11: a stale integration names the main it found, and only such conflicts carry a value", { timeout: 30000 }, async () => {
  const f = fixture();
  try {
    const body = readFileSync(join(f.root, "candidate.bundle"));
    const candidate = gitCommand(join(f.root, "seed"), ["rev-parse", "HEAD"]);
    const submitted = await f.git.submit(f.auth, "av28-submit", { candidate, exportRef: "refs/oma/export/crash", prerequisites: [f.base],
      to: ["b"], subject: "candidate", body: "body", paths: [],
      bundle: { bytes: body.length, sha256: sha256Hex(body), mediaType: "application/x-git-bundle" } }, (async function* () { yield body; })());
    assert.equal(submitted.state, "succeeded", JSON.stringify(submitted));
    const error = await f.git.integrate(f.auth, "av28-stale", { candidate, expected: candidate }).then(() => null, (reason: unknown) => reason);
    assert.equal((error as { code?: string } | null)?.code, "STALE_BASE");
    assert.deepEqual(publicFailure(error).details, { actual: f.base });
    assert.equal(f.store.getOperation("a", "av28-stale"), null, "a stale base is refused before acceptance");
    // A value is carried only where the table returns one.
    assert.equal(publicFailure(new StoreError("CAPABILITY_DENIED", "denied", { details: { actual: f.base } })).details, undefined);
  } finally { f.close(); }
});
