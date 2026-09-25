/** Priority 0 (PRIORITY-0.md): the fixes the file-by-file audit
 * (implementation/priority-0-audit.md) derived from it, each tested where its
 * decision takes effect. DR9 and DR11 are also tested beside their owners
 * (rollover-settlement, delivery-state-model, delivery-receipt-publication). */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateOperationId } from "../src/ids.js";
import { messageIdForOperation } from "../src/domain/derived.js";
import { collectUnacceptedArtifacts } from "../src/reconcile/preaccept.js";
import { ReconcileModule } from "../src/reconcile.js";
import type { UnitsModule } from "../src/units.js";
import type { LifecycleModule } from "../src/lifecycle.js";
import { preparedFixture } from "./fixtures/delivery-receipt.js";
import { readCurrentHostPolicy } from "../src/config.js";
import { defaultHostConfig } from "../src/config/defaults.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Store } from "../src/store.js";
import { LifecycleModule as Lifecycle } from "../src/lifecycle.js";
import { gitFixture, gitAuth, seedGit } from "./fixtures/git-crash.js";
import { ALL_CAPS, makeValidAgent, makeValidResolvedSpec } from "./fixtures/spec.js";

/** Leaves, in `root`, one of every artifact a request makes before its
 * acceptance, as a broker that died before accepting would leave them. */
function strandedArtifacts(root: string, mail: { freezeObject(id: string, eml: { text: string }): unknown }) {
  const operation = generateOperationId();
  const object = messageIdForOperation(operation, 0);
  mail.freezeObject(object, { text: "Message-ID: <x>\r\n\r\nnever accepted\r\n" });
  const staging = join(root, "staging");
  mkdirSync(join(staging, "mail-objects"), { recursive: true });
  const stagedCopy = join(staging, "mail-objects", `${object}.${generateOperationId()}.tmp`);
  writeFileSync(stagedCopy, "half-frozen");
  const wire = join(staging, `rpc-${randomUUID()}.wire`);
  writeFileSync(wire, "transport copy");
  const submit = join(staging, `submit-${generateOperationId()}`);
  mkdirSync(submit); writeFileSync(join(submit, "upload.bundle"), "bundle");
  const archiveTemporary = join(root, "mail", "archive", "cur", `.${object}.eml.${randomUUID()}.tmp`);
  mkdirSync(join(root, "mail", "archive", "cur"), { recursive: true }); writeFileSync(archiveTemporary, "copy");
  const context = join(staging, `context-${generateOperationId()}`);
  mkdirSync(join(context, "commit-work"), { recursive: true });
  const quarantine = join(staging, "quarantine-ns-0123");
  mkdirSync(quarantine);
  return { object: join(root, "mail", "objects", `${object}.eml`), stagedCopy, wire, submit, archiveTemporary, context, quarantine };
}

test("DR10 / P0-4: what a broker made before an acceptance that never happened is collected; what an accepted plan names is kept", async () => {
  const f = await preparedFixture();
  try {
    const acceptedObjects = readdirSync(join(f.root, "mail", "objects"));
    assert.equal(acceptedObjects.length, 1, "the fixture's accepted message");
    const left = strandedArtifacts(f.root, f.mail);
    const collected = collectUnacceptedArtifacts(f.root, f.store);
    assert.deepEqual([...collected.removed].sort(), [left.object, left.stagedCopy, left.wire, left.submit, left.archiveTemporary].sort());
    for (const path of collected.removed) assert.equal(existsSync(path), false, path);
    // A child process may have worked in these, and a restart does not prove
    // its death (P0-5): kept, and said why.
    assert.deepEqual(collected.kept.map(entry => entry.path).sort(), [left.context, left.quarantine].sort());
    assert.ok(existsSync(left.context) && existsSync(left.quarantine));
    assert.deepEqual(readdirSync(join(f.root, "mail", "objects")), acceptedObjects, "the accepted plan's message is kept");
    assert.deepEqual(collectUnacceptedArtifacts(f.root, f.store).removed, [], "a second collection removes nothing");
  } finally { f.close(); }
});

test("DR10: startup recovery collects before anything is admitted or bootstrapped", async () => {
  const f = await preparedFixture();
  try {
    const left = strandedArtifacts(f.root, f.mail);
    const units = { confirmDead: () => true, stop: () => undefined, observeAsync: async () => ({ activeState: "inactive" }),
      bindIncarnationReader: () => undefined } as unknown as UnitsModule;
    const reconcile = new ReconcileModule(f.store, f.mail, null, units, {} as LifecycleModule,
      { projectGit: join(f.root, "repos", "project.git"), activationAllowed: () => false });
    let seenByBootstrap: boolean | null = null;
    await reconcile.startup(false, async () => { seenByBootstrap = existsSync(left.object); });
    assert.equal(seenByBootstrap, false, "the collection ran before the bootstrap step");
    assert.ok(reconcile.preacceptCollection?.removed.includes(left.object));
  } finally { f.close(); }
});

test("DR13 / P0-5: the broker's host policy reader says 'cannot be read now', never 'changed', for a policy it cannot obtain", () => {
  const config = defaultHostConfig({ society: "demo", node: "/usr/bin/node", libdir: "/opt/oma", rootfs: "/state/rootfs", deploymentDigest: "a".repeat(64) });
  assert.equal(readCurrentHostPolicy("/config.json", "demo", () => config), config);
  for (const failure of [Object.assign(new Error("EIO: i/o error"), { code: "EIO" }), new Error("config: quota.societyAgents must be a safe integer")])
    assert.throws(() => readCurrentHostPolicy("/config.json", "demo", () => { throw failure; }), { code: "BROKER_UNAVAILABLE" });
  assert.throws(() => readCurrentHostPolicy("/config.json", "other", () => config), { code: "POLICY_CHANGED" },
    "a readable policy of another society is a changed one");
});

test("P0V-10 / CREATE-003, P0-1: a host policy edited after a create was accepted does not reinterpret it", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-p0v10-"));
  const store = new Store(join(root, "runtime.sqlite"));
  try {
    seedGit(root);
    const info = JSON.parse(readFileSync(join(root, "git-fixture.json"), "utf8"));
    store.transaction(tx => {
      tx.insertAgent(makeValidAgent("principal", { from: info.base }));
      tx.insertAgent(makeValidAgent("a", { from: info.base, createdBy: "principal" }));
    });
    const { mail, paths } = gitFixture(root, store);
    const units = { bindIncarnationReader: () => undefined, ensureResident: () => undefined, start: () => undefined,
      onRevokeRun: undefined } as unknown as UnitsModule;
    // The policy resolves the accepted spec twice (preparation, acceptance
    // transaction); an edit lands right after acceptance and would resolve a
    // child with fewer capabilities from then on.
    let resolutions = 0;
    const lifecycle = new Lifecycle(store, units,
      { stateRoot: root, projectGit: paths.projectGit, society: paths.society, hasGoal: () => false, activationAllowed: () => true },
      (_parent, input) => makeValidResolvedSpec(input.name, "p", ++resolutions <= 2 ? ALL_CAPS : ["mail.send"], input.from, input.brief), mail);
    const receipt = await lifecycle.create({ ...gitAuth, capabilities: new Set(ALL_CAPS) }, { name: "child", from: info.base, brief: "brief" }, "p0v10");
    assert.equal(receipt.state, "succeeded", "the accepted plan is completed with the spec it froze");
    assert.deepEqual([...JSON.parse(store.getAgent("child")!.specJson).capabilities].sort(), [...ALL_CAPS].sort());
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
