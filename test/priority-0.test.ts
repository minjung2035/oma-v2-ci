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
import { UnitsModule as Units, assertUserManagerReachable, unitCommandError, type UnitsModule } from "../src/units.js";
import type { LifecycleModule } from "../src/lifecycle.js";
import { preparedFixture } from "./fixtures/delivery-receipt.js";
import { readCurrentHostPolicy } from "../src/config.js";
import { defaultHostConfig } from "../src/config/defaults.js";
import { loadConfiguration, validateConfig } from "../src/config.js";
import { collectManagedGenerations, commitInlineConfiguration, createInlineConfiguration } from "../src/config/generations.js";
import { applyField, commitField, readSettings, WORKER_LIMIT } from "../src/tui/sources/settings.js";
import { DurabilityFaultError, type DurabilityObserver } from "../src/storage/durable-fs.js";
import { createCompleteConfigurationFixture } from "./fixtures/configuration.js";
import { runCliProcess } from "../src/extension/cli-process.js";
import { cliFailure } from "../src/extension/mail-tools.js";
import { guardWorkspaceTools } from "../src/extension/workspace-guard.js";
import { collectBindingTemporaries, observeProjectBinding, projectBindingDecision, publishProjectBinding, stateRootHasSociety } from "../src/runtime/provision.js";
import { ERROR_METADATA, errorExit, StoreError, unobserved } from "../src/domain/errors.js";
import { loadConfig } from "../src/config.js";
import { assertExtensionIntegrity } from "../src/runtime/extension-integrity.js";
import { assertHostDirectoryLayout } from "../src/runtime/assets.js";
import { assertDirectory } from "../src/storage/directory.js";
import { codeFor } from "../src/tui/exit.js";
import type { ErrorCode } from "../implementation/contracts/errors.js";
import { Broker } from "../src/broker.js";
import { ViewsModule } from "../src/views.js";
import { statusViewPath } from "../src/protocol/status-view.js";
import type { ResolvedAgentSpec } from "../implementation/contracts.js";
import { TEST_VIEW_LIMITS } from "./fixtures/limits.js";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
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
    const units = { bindIncarnationReader: () => undefined, ensureResident: () => undefined, assertResidentNamesFree: () => undefined, start: () => undefined,
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

test("DR13 / P0-5: a unit command that did not finish is an unknown outcome, not an unsupported profile", async () => {
  const unknown = { kind: "unknown", stdout: "", stderr: "", status: null, signal: null } as const;
  assert.equal(unitCommandError(unknown, "start")?.code, "DEADLINE_EXCEEDED");
  assert.equal(unitCommandError({ ...unknown, kind: "failed", status: 1, stderr: "start-limit-hit" }, "start")?.code, "START_LIMIT");
  assert.equal(unitCommandError({ ...unknown, kind: "failed", status: 1 }, "start")?.code, "INTERNAL_ERROR");
  assert.equal(unitCommandError({ ...unknown, kind: "succeeded", status: 0 }, "start"), null);
  // The real path: a systemctl that is killed before it answers.
  const bin = mkdtempSync(join(tmpdir(), "oma-dr13-units-"));
  writeFileSync(join(bin, "systemctl"), "#!/bin/sh\nkill -KILL $$\n"); chmodSync(join(bin, "systemctl"), 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path ?? ""}`;
  try {
    assert.throws(() => assertUserManagerReachable(), { code: "DEADLINE_EXCEEDED" });
    const units = new Units("demo", { node: "/usr/bin/node", libdir: "/opt/oma", state: bin, society: "demo", agent: "", config: join(bin, "c.json"), run: bin, brokerUnit: "" }, bin);
    assert.throws(() => units.start("alice", false), { code: "DEADLINE_EXCEEDED" });
  } finally { process.env.PATH = path; rmSync(bin, { recursive: true, force: true }); }
});

test("DR12 / P0-3, CONFIG-CONTRACT: an inline edit from a snapshot that is no longer current is refused, and the newer file is kept", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const settings = readSettings(f.input);
    assert.equal(settings.layout.kind, "inline");
    // The Human edits the file by hand after the screen read it.
    const manual = { ...f.config, quota: { ...f.config.quota, societyAgents: f.config.quota.societyAgents + 5 } };
    writeFileSync(f.input, JSON.stringify(manual));
    assert.throws(() => commitField(settings, WORKER_LIMIT, f.config.quota.societyAgents + 1), { code: "POLICY_CHANGED" });
    assert.equal(JSON.parse(readFileSync(f.input, "utf8")).quota.societyAgents, manual.quota.societyAgents, "the newer edit is not lost");
  } finally { f.close(); }
});

test("DR12 / P0-3: a crash before an inline commit point changes nothing, one after it leaves a configuration that loads", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const original = readFileSync(f.input);
    const settings = readSettings(f.input);
    const candidate = validateConfig(applyField(settings, WORKER_LIMIT, f.config.quota.societyAgents + 1));
    const crashAt = (phase: "before" | "after-visible"): DurabilityObserver => event => {
      if (event.point === "derived-rename" && event.phase === phase) throw new DurabilityFaultError(event);
    };
    assert.throws(() => commitInlineConfiguration(settings.snapshot!, candidate, crashAt("before")), DurabilityFaultError);
    assert.deepEqual(readFileSync(f.input), original, "nothing is committed before the rename");
    assert.equal(collectManagedGenerations({ layout: settings.snapshot!.layout }).length, 1, "the crashed temporary is collected");
    assert.throws(() => commitInlineConfiguration(settings.snapshot!, candidate, crashAt("after-visible")), DurabilityFaultError);
    assert.equal(loadConfiguration(f.input).config.quota.societyAgents, f.config.quota.societyAgents + 1,
      "a committed configuration is one the loader loads");
  } finally { f.close(); }
});

test("DR12: a flush that fails after the inline commit point is reported as unconfirmed, and the next edit flushes first", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const settings = readSettings(f.input);
    const candidate = validateConfig(applyField(settings, WORKER_LIMIT, f.config.quota.societyAgents + 1));
    let failed = false;
    const failFlush: DurabilityObserver = event => {
      if (!failed && event.point === "directory-fsync" && event.phase === "ambiguous" && event.path === f.root) { failed = true; throw new Error("EIO: injected flush failure"); }
    };
    assert.throws(() => commitInlineConfiguration(settings.snapshot!, candidate, failFlush), /published but its durability is unconfirmed/);
    assert.equal(loadConfiguration(f.input).config.quota.societyAgents, f.config.quota.societyAgents + 1, "the rename happened");
    assert.equal(commitField(readSettings(f.input), WORKER_LIMIT, f.config.quota.societyAgents + 2).kind, "saved");
  } finally { f.close(); }
});

test("DR12: a first-run configuration is created where none exists and never overwrites one another start made", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const path = join(f.root, "fresh.json");
    const first = validateConfig(f.config);
    assert.equal(createInlineConfiguration(path, first), "created");
    const bytes = readFileSync(path); const inode = statSync(path).ino;
    const other = validateConfig({ ...f.config, quota: { ...f.config.quota, societyAgents: f.config.quota.societyAgents + 1 } });
    assert.equal(createInlineConfiguration(path, other), "existing");
    assert.deepEqual(readFileSync(path), bytes); assert.equal(statSync(path).ino, inode);
    assert.deepEqual(readdirSync(f.root).filter(name => name.endsWith(".tmp")), [], "no temporary is left behind");
  } finally { f.close(); }
});

test("DR13 / P0-5: a CLI a tool stopped gave no answer; the tool says the outcome is unknown and names the key", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-dr13-cli-"));
  try {
    const slow = join(dir, "slow.mjs"); writeFileSync(slow, "setTimeout(() => {}, 30000);\n");
    const answered = join(dir, "answered.mjs"); writeFileSync(answered, "process.stderr.write('oma: REQUEST_KEY_REUSED: key k'); process.exit(2);\n");
    const run = (cli: string, timeoutMs: number) => runCliProcess({ node: process.execPath, cli, args: [], cwd: dir,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin" }, grant: null, timeoutMs });
    const stopped = await run(slow, 200);
    assert.equal(stopped.finished, false, "a CLI this process stopped did not answer");
    const unknown = cliFailure(stopped, ["send", "--request", "pi-key-1", "--", "b"]);
    assert.match(unknown!.message, /결과 불명확/);
    assert.match(unknown!.message, /pi-key-1/, "the key to look the outcome up with is named");
    const done = await run(answered, 10_000);
    assert.equal(done.finished, true);
    assert.equal(cliFailure(done, ["send", "--request", "pi-key-2"])?.message, "oma: REQUEST_KEY_REUSED: key k", "an answer speaks for itself");
    assert.equal(cliFailure({ code: 0, stdout: "ok", stderr: "", finished: true }, []), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("P0V-15 / P0-5: a workspace entry that cannot be observed is not zero bytes; the guard refuses the write", { skip: process.getuid?.() === 0 }, () => {
  const workspace = mkdtempSync(join(tmpdir(), "oma-p0v15-"));
  const locked = join(workspace, "locked");
  try {
    writeFileSync(join(workspace, "a.txt"), "small\n");
    mkdirSync(locked); writeFileSync(join(locked, "big.bin"), "x".repeat(64));
    let handler: ((event: { toolName: string; input: Record<string, unknown> }) => unknown) | null = null;
    guardWorkspaceTools({ on: (_name: string, listener: typeof handler) => { handler = listener; } } as never, workspace, 1024, true);
    const write = { toolName: "write", input: { path: "note.txt", content: "hello" } };
    assert.equal(handler!(write), undefined, "an observable small workspace admits a small write");
    chmodSync(locked, 0o600); // listable, but its entries cannot be looked at
    assert.deepEqual(handler!(write), { block: true, reason: "agent workspace quota would be exceeded" },
      "what could not be observed was counted as nothing");
  } finally { chmodSync(locked, 0o700); rmSync(workspace, { recursive: true, force: true }); }
});

test("P0-7: a draining broker removes its status view, so a view that is there is a live broker's", async () => {
  const f = await preparedFixture();
  const cgroup = readFileSync("/proc/self/cgroup", "utf8").trim().split("\n")[0]!.slice(3);
  const units = { onRevokeRun: undefined, bindIncarnationReader: () => undefined, unitCgroup: () => "",
    observe: () => ({ activeState: "active", subState: "running", result: "success", execMainStatus: 0, cgroup, invocationId: "a".repeat(32) }),
    observeStatus: async () => new Map() } as unknown as UnitsModule;
  const lifecycle = new Lifecycle(f.store, units, { stateRoot: f.root, projectGit: join(f.root, "repos", "project.git"),
    society: "demo", hasGoal: () => true, activationAllowed: () => true },
    (_parent: unknown, input: { name: string; from: string; brief: string }) => ({ ...input }) as unknown as ResolvedAgentSpec, f.mail);
  const broker = new Broker(f.store, f.mail, units, new ViewsModule(f.store, f.root, "demo", "p", TEST_VIEW_LIMITS), lifecycle, null, null,
    { stateRoot: f.root, runRoot: join(f.root, "run"), society: "demo", hasGoal: () => true });
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
      assert.throws(() => commitField(settings, WORKER_LIMIT, f.config.quota.societyAgents + 1), { code: "BROKER_UNAVAILABLE" });
    } finally { chmodSync(f.input, 0o600); }
    assert.deepEqual(readFileSync(f.input), original, "nothing is committed");
    rmSync(f.input);
    assert.throws(() => commitField(settings, WORKER_LIMIT, f.config.quota.societyAgents + 1), { code: "POLICY_CHANGED" }, "a file that is gone has changed");
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
