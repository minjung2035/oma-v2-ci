import { testBroker } from "./helpers/broker-fixture.js";
import { createReconcileModule } from "#oma-test/app/broker/reconcile-composition";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
/** Priority 0 (docs/PRIORITY-0.md): the fixes the file-by-file audit
 * (docs/priority-0-audit.md) derived from it, each tested where its
 * decision takes effect. DR9 and DR11 are also tested beside their owners
 * (rollover-settlement, delivery-state-model, delivery-receipt-publication). */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateOperationId } from "@oma/native/identity";
import { messageIdForOperation } from "@oma/domain/derived";
import { collectUnacceptedArtifacts } from "@oma/storage/preaccept-collection";
import { ReconcileModule } from "@oma/reconcile";
import { UnitsModule as Units, assertUserManagerReachable, unitCommandError, type UnitsModule } from "@oma/platform-linux/units";
import type { LifecycleModule } from "@oma/lifecycle";
import { preparedFixture } from "./fixtures/delivery-receipt.js";
import { readCurrentHostPolicy } from "@oma/config";
import { defaultHostConfig } from "@oma/config/defaults";
import { loadConfiguration, validateConfig } from "@oma/config";
import { collectManagedGenerations, commitInlineConfiguration, createInlineConfiguration } from "@oma/config/generations";
import { applyField, commitField, readSettings, INITIAL_WORKERS } from "#oma-test/app/application/settings";
import { DurabilityFaultError, type DurabilityObserver } from "@oma/storage/durable-fs";
import { createCompleteConfigurationFixture } from "./fixtures/configuration.js";
import { Client, ClientError } from "@oma/client";
import { installRuntime } from "@oma/client/runtime";
import { CLIENT_RUNTIME, installClientRuntime } from "#oma-test/app/runtime/client-runtime";
import { containWorkspaceTools } from "@oma/tool-runtime/contained-tools";
import { collectBindingTemporaries, observeProjectBinding, projectBindingDecision, publishProjectBinding, stateRootHasSociety } from "#oma-test/app/runtime/provision";
import { ERROR_METADATA, errorExit, StoreError, unobserved } from "@oma/domain/errors";
import { loadConfig } from "@oma/config";
import { assertExtensionIntegrity } from "#oma-test/app/runtime/extension-integrity";
import { assertHostDirectoryLayout } from "@oma/native/directory-layout";
import { assertDirectory } from "@oma/storage/directory";
import { codeFor } from "#oma-test/app/application/exit";
import type { ErrorCode } from "@oma/contracts/errors";
import { Broker } from "@oma/broker";
import { ViewsModule } from "#oma-test/app/views";
import { statusViewPath } from "@oma/protocol/status-view";
import type { ResolvedAgentSpec } from "@oma/contracts";
import { TEST_VIEW_LIMITS } from "./fixtures/limits.js";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { Store } from "@oma/storage";
import { LifecycleModule as Lifecycle } from "@oma/lifecycle";
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
    const reconcile = createReconcileModule(f.store, f.mail, null, null, units, {} as LifecycleModule,
      { projectGit: join(f.root, "repos", "project.git"), hasGoal: () => true, activationAllowed: () => false });
    let seenByBootstrap: boolean | null = null;
    await reconcile.startup(false, async () => { seenByBootstrap = existsSync(left.object); });
    assert.equal(seenByBootstrap, false, "the collection ran before the bootstrap step");
    assert.ok(reconcile.preacceptCollection?.removed.includes(left.object));
  } finally { f.close(); }
});

test("AV-19: a stranded context .prepare-* tree is collected; an accepted or unparseable one is kept", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-prepare-"));
  try {
    const revisions = join(root, "world", "context", "revisions");
    const acceptedId = generateOperationId();
    const orphan = join(revisions, `.prepare-${"a".repeat(64)}-${generateOperationId()}`);
    const owned = join(revisions, `.prepare-${"b".repeat(40)}-${acceptedId}`);
    const malformed = join(revisions, ".prepare-not-an-op");
    const notTree = join(revisions, `.prepare-${"c".repeat(64)}-${generateOperationId()}`);
    for (const path of [orphan, owned, malformed]) mkdirSync(path, { recursive: true });
    writeFileSync(notTree, "not a tree");
    const store = { getOperationById: (id: string) => (id === acceptedId ? { id } : null) } as never;
    const collected = collectUnacceptedArtifacts(root, store);
    assert.deepEqual(collected.removed, [orphan]);
    assert.equal(existsSync(orphan), false);
    assert.deepEqual(collected.kept.map(entry => entry.path).sort(), [owned, malformed, notTree].sort());
    assert.equal(collected.kept.find(entry => entry.path === owned)!.reason, "its operation is accepted");
    assert.ok(existsSync(owned) && existsSync(malformed) && existsSync(notTree));
    assert.deepEqual(collectUnacceptedArtifacts(root, store).removed, [], "a second collection removes nothing");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

/** Runs a startup recovery pass over the fixture's state root and returns the
 * `reconcile.preaccept` events it printed. */
async function preacceptEvents(t: import("node:test").TestContext, f: Awaited<ReturnType<typeof preparedFixture>>) {
  const units = { confirmDead: () => true, stop: () => undefined, observeAsync: async () => ({ activeState: "inactive" }),
    bindIncarnationReader: () => undefined } as unknown as UnitsModule;
  const reconcile = createReconcileModule(f.store, f.mail, null, null, units, {} as LifecycleModule,
    { projectGit: join(f.root, "repos", "project.git"), hasGoal: () => true, activationAllowed: () => false });
  const printed: string[] = [];
  const error = t.mock.method(console, "error", (...args: unknown[]) => { printed.push(args.map(String).join(" ")); });
  try { await reconcile.startup(false); } finally { error.mock.restore(); }
  const events = printed.flatMap(line => {
    try { const parsed = JSON.parse(line) as { event?: unknown }; return parsed.event === "reconcile.preaccept" ? [parsed as Record<string, unknown>] : []; }
    catch { return []; }
  });
  return { events, collected: reconcile.preacceptCollection! };
}

test("FJ-1: a published context revision is the product, not residue: only genuine residue is kept and reported", async t => {
  // The audited collection reached every `world/context/revisions/<oid>`
  // directory -- the name every real revision has (domain/derived.ts) -- and,
  // finding no `.prepare-*` binding, kept it as "not a name this broker
  // derives". Every startup then reported each published revision as residue
  // and the reconcile.preaccept event fired permanently, hiding real residue.
  const f = await preparedFixture();
  try {
    const revisions = join(f.root, "world", "context", "revisions");
    const published = [join(revisions, "a".repeat(40)), join(revisions, "b".repeat(64))];
    for (const path of published) { mkdirSync(path, { recursive: true }); writeFileSync(join(path, "GOAL.md"), "goal\n"); }
    const residue = join(revisions, "not-a-revision");
    const strayFile = join(revisions, "c".repeat(40));   // a file wearing an oid's name is still residue
    mkdirSync(residue); writeFileSync(strayFile, "not a tree");
    const collected = collectUnacceptedArtifacts(f.root, f.store);
    assert.deepEqual(collected.kept.map(entry => entry.path).sort(), [residue, strayFile].sort(),
      "only the genuinely underivable names are kept");
    assert.deepEqual(collected.removed, []);
    for (const path of published) assert.ok(existsSync(join(path, "GOAL.md")), "a published revision is untouched");

    rmSync(residue, { recursive: true }); rmSync(strayFile);
    assert.deepEqual(collectUnacceptedArtifacts(f.root, f.store).kept, [], "published revisions alone are nothing kept");
    const { events } = await preacceptEvents(t, f);
    assert.deepEqual(events, [], "with only published revisions, startup reports no preaccept residue");
  } finally { f.close(); }
});

test("FJ-2: a name that vanishes between the listing and its stat does not fail startup collection", t => {
  // The mail-object loop (and the staging decisions) called lstatSync without
  // throwIfNoEntry: a name removed between readdir and lstat threw ENOENT out
  // of startup recovery. A vanished name has nothing left to collect or keep.
  const root = mkdtempSync(join(tmpdir(), "oma-preaccept-vanished-"));
  try {
    const objects = join(root, "mail", "objects");
    const staging = join(root, "staging");
    mkdirSync(objects, { recursive: true }); mkdirSync(staging);
    const operation = generateOperationId();
    const phantoms = new Map<string, string[]>([
      [objects, [`${messageIdForOperation(operation, 0)}.eml`]],
      [staging, ["mail-objects", `submit-${generateOperationId()}`]],
    ]);
    const original = fs.readdirSync;
    t.mock.method(fs, "readdirSync", ((path: fs.PathLike, ...rest: unknown[]) => {
      const listed = (original as (...args: unknown[]) => string[])(path, ...rest);
      return [...listed, ...(phantoms.get(String(path)) ?? [])];
    }) as typeof fs.readdirSync);
    syncBuiltinESMExports();
    let collected: ReturnType<typeof collectUnacceptedArtifacts>;
    try { collected = collectUnacceptedArtifacts(root, { getOperationById: () => null }); }
    finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
    assert.deepEqual({ removed: collected.removed, kept: collected.kept }, { removed: [], kept: [] },
      "a vanished name is neither collected nor reported as kept");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FJ-3: the reconcile.preaccept event names what it kept, bounded to the first eight entries", async t => {
  // The audited event carried only counts: an operator could see that
  // something was kept but not what or why.
  const f = await preparedFixture();
  try {
    const staging = join(f.root, "staging");
    mkdirSync(staging, { recursive: true });
    for (let index = 0; index < 11; index++) writeFileSync(join(staging, `junk-${index}`), "underivable");
    const { events, collected } = await preacceptEvents(t, f);
    assert.equal(events.length, 1, "one event for the startup pass");
    const event = events[0]!;
    assert.equal(event.kept, 11, "the count still covers every kept entry");
    assert.equal(event.removed, 0);
    const entries = event.keptEntries as { path: string; reason: string }[];
    assert.ok(Array.isArray(entries), "the event carries the kept entries");
    assert.equal(entries.length, 8, "the list is bounded");
    assert.deepEqual(entries, collected.kept.slice(0, 8).map(entry => ({
      path: entry.path.slice(f.root.length + 1), reason: entry.reason })), "the first eight, relative to the state root, with reasons");
    for (const entry of entries) {
      assert.match(entry.path, /^staging\/junk-\d+$/);
      assert.equal(entry.reason, "not a name this broker derives");
    }
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
    const units = { bindIncarnationReader: () => undefined, ensureResident: () => undefined, assertResidentNamesFree: () => undefined, start: () => undefined,
      onRevokeRun: undefined } as unknown as UnitsModule;
    // The policy resolves the accepted spec twice (preparation, acceptance
    // transaction); an edit lands right after acceptance and would resolve a
    // child with fewer capabilities from then on.
    let resolutions = 0;
    const lifecycle = createLifecycleModule(store, units,
      { stateRoot: root, projectGit: paths.projectGit, society: paths.society, hasGoal: () => false, activationAllowed: () => true },
      (_parent, input) => makeValidResolvedSpec(input.name, "p", ++resolutions <= 2 ? ALL_CAPS : ["mail.send"], input.from, input.brief), mail);
    const receipt = await lifecycle.create({ ...gitAuth, capabilities: new Set(ALL_CAPS) }, { name: "child", from: info.base, brief: "brief" }, "p0v10");
    assert.equal(receipt.state, "succeeded", "the accepted plan is completed with the spec it froze");
    assert.deepEqual([...JSON.parse(store.getAgent("child")!.specJson).capabilities].sort(), [...ALL_CAPS].sort());
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("DR13 / P0-5: a unit command that did not finish is an unknown outcome, not an unsupported profile", async () => {
  const unknown = { kind: "unknown", stdout: "", stderr: "", status: null, signal: null } as const;
  assert.equal(unitCommandError(unknown, "start")?.code, "DEADLINE_EXCEEDED");
  assert.equal(unitCommandError({ ...unknown, kind: "failed", status: 1, stderr: "start-limit-hit" }, "start")?.code, "INTERNAL_ERROR");
  assert.equal(unitCommandError({ ...unknown, kind: "failed", status: 1 }, "start")?.code, "INTERNAL_ERROR");
  assert.equal(unitCommandError({ ...unknown, kind: "succeeded", status: 0 }, "start"), null);
  // The real path: a systemctl that is killed before it answers.
  const bin = mkdtempSync(join(tmpdir(), "oma-dr13-units-"));
  writeFileSync(join(bin, "systemctl"), "#!/bin/sh\nkill -KILL $$\n"); chmodSync(join(bin, "systemctl"), 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path ?? ""}`;
  try {
    assert.throws(() => assertUserManagerReachable(), { code: "DEADLINE_EXCEEDED" });
    const units = new Units("demo", { node: "/usr/bin/node", libdir: "/opt/oma", state: bin, society: "demo", agent: "", config: join(bin, "c.json"), run: bin }, bin);
    assert.throws(() => units.start("alice", false), { code: "DEADLINE_EXCEEDED" });
  } finally { process.env.PATH = path; rmSync(bin, { recursive: true, force: true }); }
});

test("DR12 / P0-3, CONFIG-CONTRACT: an inline edit from a snapshot that is no longer current is refused, and the newer file is kept", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const settings = readSettings(f.input);
    assert.equal(settings.layout.kind, "inline");
    // The Human edits the file by hand after the screen read it.
    const manual = { ...f.config, limits: { ...f.config.limits, logBytes: f.config.initialResidents.length + 5 } };
    writeFileSync(f.input, JSON.stringify(manual));
    assert.throws(() => commitField(settings, INITIAL_WORKERS, f.config.initialResidents.length + 1), { code: "POLICY_CHANGED" });
    assert.equal(JSON.parse(readFileSync(f.input, "utf8")).initialResidents.length, manual.initialResidents.length, "the newer edit is not lost");
  } finally { f.close(); }
});

test("DR12 / P0-3: a crash before an inline commit point changes nothing, one after it leaves a configuration that loads", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const original = readFileSync(f.input);
    const settings = readSettings(f.input);
    const candidate = validateConfig(applyField(settings, INITIAL_WORKERS, f.config.initialResidents.length + 1));
    const crashAt = (phase: "before" | "after-visible"): DurabilityObserver => event => {
      if (event.point === "derived-rename" && event.phase === phase) throw new DurabilityFaultError(event);
    };
    assert.throws(() => commitInlineConfiguration(settings.snapshot!, candidate, crashAt("before")), DurabilityFaultError);
    assert.deepEqual(readFileSync(f.input), original, "nothing is committed before the rename");
    assert.equal(collectManagedGenerations({ layout: settings.snapshot!.layout }).length, 1, "the crashed temporary is collected");
    assert.throws(() => commitInlineConfiguration(settings.snapshot!, candidate, crashAt("after-visible")), DurabilityFaultError);
    assert.equal(loadConfiguration(f.input).config.initialResidents.length, f.config.initialResidents.length + 1,
      "a committed configuration is one the loader loads");
  } finally { f.close(); }
});

test("DR12: a flush that fails after the inline commit point is reported as unconfirmed, and the next edit flushes first", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const settings = readSettings(f.input);
    const candidate = validateConfig(applyField(settings, INITIAL_WORKERS, f.config.initialResidents.length + 1));
    let failed = false;
    const failFlush: DurabilityObserver = event => {
      if (!failed && event.point === "directory-fsync" && event.phase === "ambiguous" && event.path === f.root) { failed = true; throw new Error("EIO: injected flush failure"); }
    };
    assert.throws(() => commitInlineConfiguration(settings.snapshot!, candidate, failFlush), /published but its durability is unconfirmed/);
    assert.equal(loadConfiguration(f.input).config.initialResidents.length, f.config.initialResidents.length + 1, "the rename happened");
    assert.equal(commitField(readSettings(f.input), INITIAL_WORKERS, f.config.initialResidents.length + 2).kind, "saved");
  } finally { f.close(); }
});

test("DR12: a first-run configuration is created where none exists and never overwrites one another start made", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const path = join(f.root, "fresh.json");
    const first = validateConfig(f.config);
    assert.equal(createInlineConfiguration(path, first), "created");
    const bytes = readFileSync(path); const inode = statSync(path).ino;
    const other = validateConfig({ ...f.config, limits: { ...f.config.limits, logBytes: f.config.initialResidents.length + 1 } });
    assert.equal(createInlineConfiguration(path, other), "existing");
    assert.deepEqual(readFileSync(path), bytes); assert.equal(statSync(path).ino, inode);
    assert.deepEqual(readdirSync(f.root).filter(name => name.endsWith(".tmp")), [], "no temporary is left behind");
  } finally { f.close(); }
});

test("DR13 / P0-5: a CLI a tool stopped gave no answer; the tool says the outcome is unknown and names the key", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-dr13-client-"));
  installRuntime({ ...CLIENT_RUNTIME, channel: () => ({ connect: async () => {}, close() {},
    call: async () => { throw new Error("connection lost"); } }) });
  try {
    const client = new Client({ cwd: dir, env: { HOME: dir, OMA_SOCKET: join(dir, "broker.sock") } });
    await assert.rejects(() => client.sendMail({ to: ["b"], subject: "s", body: "b", kind: "message" }, "pi-key-1"), error => {
      assert.ok(error instanceof ClientError);
      assert.match(error.message, /Acceptance status unknown/);
      assert.match(error.message, /pi-key-1/);
      assert.equal(error.request, "pi-key-1");
      return true;
    });
  } finally { installClientRuntime(); rmSync(dir, { recursive: true, force: true }); }
});

test("P0V-15 / P0-5: a workspace entry that cannot be observed is not zero bytes; the write is refused", { skip: process.getuid?.() === 0 }, async () => {
  const workspace = mkdtempSync(join(tmpdir(), "oma-p0v15-"));
  const locked = join(workspace, "locked");
  try {
    writeFileSync(join(workspace, "a.txt"), "small\n");
    mkdirSync(locked); writeFileSync(join(locked, "big.bin"), "x".repeat(64));
    // P0V-122: the quota's one owner is the contained write.
    const tools: Record<string, { execute(id: string, params: Record<string, unknown>, signal: undefined, update: undefined, ctx: unknown): Promise<unknown> }> = {};
    containWorkspaceTools({ registerTool: (tool: { name: string }) => { tools[tool.name] = tool as never; } } as never, workspace, true);
    const write = (path: string): Promise<unknown> => tools.write!.execute("call", { path, content: "hello" }, undefined, undefined, { cwd: workspace });
    await write("note.txt");
    chmodSync(locked, 0o600); // listable, but its entries cannot be looked at
    await write("other.txt");
    await assert.rejects(write("locked/other.txt"), /workspace|access|directory|EACCES/i,
      "the actual inaccessible destination must still refuse");
  } finally { chmodSync(locked, 0o700); rmSync(workspace, { recursive: true, force: true }); }
});

test("P0-7: a draining broker removes its status view, so a view that is there is a live broker's", async () => {
  const f = await preparedFixture();
  const cgroup = readFileSync("/proc/self/cgroup", "utf8").trim().split("\n")[0]!.slice(3);
  const units = { onRevokeRun: undefined, bindIncarnationReader: () => undefined, unitCgroup: () => "",
    observe: () => ({ activeState: "active", subState: "running", result: "success", execMainStatus: 0, cgroup, invocationId: "a".repeat(32) }),
    observeStatus: async () => new Map() } as unknown as UnitsModule;
  const lifecycle = createLifecycleModule(f.store, units, { stateRoot: f.root, projectGit: join(f.root, "repos", "project.git"),
    society: "demo", hasGoal: () => true, activationAllowed: () => true },
    (_parent: unknown, input: { name: string; from: string; brief: string }) => ({ ...input }) as unknown as ResolvedAgentSpec, f.mail);
  const broker = testBroker({ store: f.store, mail: f.mail, units: units, views: new ViewsModule(f.store, f.root, "demo", "p", TEST_VIEW_LIMITS), lifecycle: lifecycle, git: null, reviews: null, reconcile: null, paths: { stateRoot: f.root, runRoot: join(f.root, "run"), society: "demo", hasGoal: () => true } });
  try {
    await broker.start();
    for (let wait = 0; wait < 200 && !existsSync(statusViewPath(f.root)); wait++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(existsSync(statusViewPath(f.root)), "a running broker publishes its status view");
    await broker.drainAndClose();
    assert.equal(existsSync(statusViewPath(f.root)), false, "absence is a draining broker's truthful status");
  } finally { (f.store as unknown as { close(): void }).close = () => undefined; f.close(); }
});

test("P0-7: a crash while binding a society to its project leaves no binding or the whole one, and the tenure holder collects the rest", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-p0-binding-"));
  try {
    const binding = { society: "demo", canonicalProjectPath: "/project" };
    const bytes = `${JSON.stringify({ kind: "oma-project-binding-v1", ...binding }, null, 2)}\n`;
    // Died after the private temporary was written, before the link: no binding.
    writeFileSync(join(root, `.project-binding.json.${"a".repeat(16)}.tmp`), bytes, { mode: 0o600 });
    assert.equal(observeProjectBinding(root).kind, "absent");
    assert.equal(stateRootHasSociety(root), false, "a temporary is not a society");
    publishProjectBinding(root, binding);
    assert.equal(observeProjectBinding(root).kind, "bound");
    // Died after the link, before the temporary was removed: the whole binding.
    writeFileSync(join(root, `.project-binding.json.${"b".repeat(16)}.tmp`), bytes, { mode: 0o600 });
    assert.equal(observeProjectBinding(root).kind, "bound");
    assert.equal(collectBindingTemporaries(root).length, 2);
    assert.deepEqual(readdirSync(root), ["project-binding.json"]);
    assert.equal(observeProjectBinding(root).kind, "bound");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("DR13 / CLI-003, P0-2: the Control Panel's exit is the CLI's reading of the code, so an unknown is never a settled failure", () => {
  for (const code of Object.keys(ERROR_METADATA) as ErrorCode[])
    assert.equal(codeFor(new StoreError(code, code)), errorExit(code), code);
  for (const unknown of ["RUN_TERMINATION_UNKNOWN", "REF_STATE_UNKNOWN", "SESSION_BOUNDARY_UNCONFIRMED", "PROVIDER_OUTCOME_UNKNOWN", "STORE_CORRUPT", "DB_BUSY"] as const)
    assert.equal(codeFor(new StoreError(unknown, unknown)), 3, unknown);
  assert.equal(codeFor(new Error("EIO")), 3, "a failure with no code is not known to be settled");
  // A binding the process cannot vouch for is not known; one to another project is the operator's decision.
  const input = { society: "demo", canonicalProjectPath: "/project", hasSociety: true, bindRequested: false };
  const unreadable = projectBindingDecision({ ...input, observation: { kind: "unreadable", reason: "EIO" } });
  const elsewhere = projectBindingDecision({ ...input, observation: { kind: "bound", binding: { kind: "oma-project-binding-v1", society: "demo", canonicalProjectPath: "/elsewhere" } } });
  const unavailable = projectBindingDecision({ ...input, observation: { kind: "unavailable", reason: "EIO" } });
  assert.ok(unreadable.kind === "refuse" && elsewhere.kind === "refuse" && unavailable.kind === "refuse");
  assert.equal(errorExit(unreadable.code), 3);
  assert.equal(errorExit(unavailable.code), 3);
  assert.equal(unavailable.code, "BROKER_UNAVAILABLE");
  assert.equal(errorExit(elsewhere.code), 2);
});

test("DR13 / DR12: a configuration file that cannot be read now is not a changed one; the edit waits and writes nothing", { skip: process.getuid?.() === 0 }, () => {
  const f = createCompleteConfigurationFixture();
  try {
    const settings = readSettings(f.input);
    const original = readFileSync(f.input);
    chmodSync(f.input, 0o000);
    try {
      assert.throws(() => commitField(settings, INITIAL_WORKERS, f.config.initialResidents.length + 1), { code: "BROKER_UNAVAILABLE" });
    } finally { chmodSync(f.input, 0o600); }
    assert.deepEqual(readFileSync(f.input), original, "nothing is committed");
    rmSync(f.input);
    assert.throws(() => commitField(settings, INITIAL_WORKERS, f.config.initialResidents.length + 1), { code: "POLICY_CHANGED" }, "a file that is gone has changed");
  } finally { f.close(); }
});

test("DR13 / P0-5: a local observation that did not answer is 'cannot be observed now', never a changed, invalid, corrupt or unsupported fact", { skip: process.getuid?.() === 0 }, () => {
  const errno = (code: string) => Object.assign(new Error(code), { code });
  assert.equal(unobserved(errno("EACCES"), "x")?.code, "BROKER_UNAVAILABLE");
  assert.equal(unobserved(errno("EIO"), "x")?.code, "BROKER_UNAVAILABLE");
  for (const answered of [errno("ENOENT"), errno("ENOTDIR"), new SyntaxError("bad JSON"), new StoreError("INVALID_REQUEST", "x"), errno("ERR_INVALID_ARG_TYPE")])
    assert.equal(unobserved(answered, "x"), null, String(answered));

  const root = mkdtempSync(join(tmpdir(), "oma-p0-unobserved-"));
  try {
    const config = join(root, "config.json");
    writeFileSync(config, JSON.stringify(defaultHostConfig({ society: "demo", node: process.execPath, libdir: root, rootfs: root, deploymentDigest: "0".repeat(64) })));
    chmodSync(config, 0o000);
    try { assert.throws(() => loadConfig(config), { code: "BROKER_UNAVAILABLE" }, "a configuration that cannot be read now"); }
    finally { chmodSync(config, 0o600); }
    writeFileSync(config, "{");
    assert.throws(() => loadConfig(config), { code: "INVALID_REQUEST" }, "bytes read and refused");

    const extension = join(root, "tool.js");
    writeFileSync(extension, "export {};\n");
    chmodSync(extension, 0o000);
    try { assert.throws(() => assertExtensionIntegrity([{ path: extension, sha256: "0".repeat(64) }]), { code: "BROKER_UNAVAILABLE" }); }
    finally { chmodSync(extension, 0o600); }
    rmSync(extension);
    assert.throws(() => assertExtensionIntegrity([{ path: extension, sha256: "0".repeat(64) }]), { code: "UNSUPPORTED_PROFILE" }, "a recorded extension that is gone");

    const closed = join(root, "closed");
    mkdirSync(join(closed, "inside"), { recursive: true });
    chmodSync(closed, 0o000);
    try {
      assert.throws(() => stateRootHasSociety(closed), { code: "BROKER_UNAVAILABLE" }, "a state root that cannot be listed is not corrupt");
      assert.throws(() => assertHostDirectoryLayout(join(closed, "inside")), { code: "BROKER_UNAVAILABLE" }, "a layout that cannot be observed is not unsupported");
      assert.equal(observeProjectBinding(join(closed, "inside")).kind, "unavailable", "a binding that cannot be read now is not an unreadable one");
      assert.throws(() => assertDirectory(join(closed, "inside")), { code: "BROKER_UNAVAILABLE" }, "a directory that cannot be opened now is not one of another type");
    } finally { chmodSync(closed, 0o700); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("DR13 / P0-5: a ledger query that failed without saying the database is corrupt does not fence the society as corrupt", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-p0-query-"));
  try {
    const store = new Store(join(root, "runtime.sqlite"));
    store.close();
    assert.throws(() => store.findSucceededContext("a".repeat(40)),
      (error: unknown) => !(error instanceof StoreError && error.code === "STORE_CORRUPT"),
      "a query that could not run is not a corrupt ledger");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
