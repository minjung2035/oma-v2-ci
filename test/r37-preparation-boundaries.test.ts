import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { sha256Hex } from "../src/hash.js";
import { QuarantineImporter } from "../src/git/quarantine.js";
import { ContextRepository } from "../src/git/context-repository.js";
import { CreateCoordinator } from "../src/lifecycle/create.js";
import { WorkspaceCoordinator } from "../src/lifecycle/workspace.js";
import { LifecyclePolicy } from "../src/lifecycle/policy.js";
import { UnitsModule } from "../src/units.js";
import { gitFixture, seedGit, gitCommand, gitAuth } from "./fixtures/git-crash.js";
import { makeValidAgent, makeValidResolvedSpec, ALL_CAPS } from "./fixtures/spec.js";
import { removeTree } from "./fixtures/cleanup.js";

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
  const units = new UnitsModule("crash", { node: process.execPath, libdir: process.cwd(), state: f.root, society: "crash", agent: "" }, join(f.root, "units"));
  let unitPublications = 0;
  units.ensureResident = () => { unitPublications++; throw new Error("unit publication must not be reached after revocation"); };
  const policy = new LifecyclePolicy(f.store, (_parent, input) => makeValidResolvedSpec(input.name, "p", ALL_CAPS, input.from, input.brief), null);
  const creates = new CreateCoordinator(f.store, units, paths, policy, workspace, f.mail);
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
