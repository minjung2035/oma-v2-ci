/** The sixth review's regressions (implementation/priority-0-audit.md,
 * "6차 점검", P0V-74 on): each is the review's counterexample, run against
 * the code that fixed it. */
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { closeSync, ftruncateSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "../src/store.js";
import { errorCodeOf, publicFailure } from "../src/domain/errors.js";
import { AdmissionGate } from "../src/domain/admission.js";

const schemaPath = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "implementation", "schema-v1.sql");

test("P0V-75 / R6-02, P0-5: an INTEGER the driver cannot hand over is corruption the fence sees, and nothing else with that code is", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-overflow-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "runtime.sqlite");
  const raw = new DatabaseSync(path);
  raw.exec("PRAGMA journal_mode=WAL;");
  raw.exec(readFileSync(schemaPath, "utf8"));
  raw.prepare(`INSERT INTO agents (name,spec_hash,role,desired,incarnation,profile,created_by,spec_json,created_at_ms,updated_at_ms)
    VALUES ('principal',?,'principal','enabled',0,'p',NULL,'{}',1,1)`).run("0".repeat(64));
  // A value the file itself now holds, and no writer of this product makes.
  raw.prepare("UPDATE agents SET updated_at_ms=? WHERE name='principal'").run(9007199254740993n);
  raw.close();
  const store = new Store(path);
  t.after(() => store.close());
  let native: unknown = null;
  try { store.getAgent("principal"); } catch (error) { native = error; }
  assert.equal(errorCodeOf(native), "STORE_CORRUPT");
  assert.equal(publicFailure(native).retry, "after-repair");
  const gate = new AdmissionGate(); gate.observe(native);
  assert.equal(gate.state, "corrupt", "new acceptance stays open on a ledger that says it is not intact");
  // The same Node code from something that is not the database is not storage.
  let buffer: unknown = null;
  try { Buffer.alloc(4).writeUInt32BE(-1, 0); } catch (error) { buffer = error; }
  assert.equal((buffer as { code: string }).code, "ERR_OUT_OF_RANGE");
  assert.equal(errorCodeOf(buffer), "INTERNAL_ERROR");
  const healthy = new AdmissionGate(); healthy.observe(buffer);
  assert.equal(healthy.state, "healthy");
});

test("P0V-76 / R6-03: an Enter after a paste's burst submits even when the wall clock was set back meanwhile", async () => {
  const { KeyDecoder } = await import("../src/tui/keys.js");
  const { TERMINAL_BOUNDS } = await import("../src/tui/limits.js");
  const wall = Date.now;
  let offset = 0;
  // The wall clock is under the test's hand from before the decoder exists.
  Date.now = () => wall() + offset;
  try {
    const decoder = new KeyDecoder();
    decoder.push(Buffer.from("\u001b[200~pasted\u001b[201~"));
    offset = -3600_000;
    await new Promise(resolve => setTimeout(resolve, TERMINAL_BOUNDS.pasteBurstMs.value + 30));
    assert.deepEqual(decoder.push(Buffer.from("\r")), [{ kind: "enter" }], "the Enter was held as a newline by a clock set back an hour");
  } finally { Date.now = wall; }
});

// ---- R6-04: native preparation trees carry a proof of their makers' death ----
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { TreeLease, collectLeasedTree, leasePathOf, treeQuiescence } from "../src/storage/tree-lease.js";
import { collectRepositoryStaging, provisionSociety } from "../src/runtime/provision.js";
import { collectUnacceptedArtifacts } from "../src/reconcile/preaccept.js";

const leaseModule = join(fileURLToPath(new URL(".", import.meta.url)), "..", "src", "storage", "tree-lease.js");
/** A maker that takes a tree's lease, makes the tree, starts a child that
 * inherits the lease (as a git or a namespace command would), and is then
 * SIGKILLed. Answers the surviving child's pid. */
function crashedMaker(tree: string): number {
  const script = `
    import { spawn } from "node:child_process";
    import { mkdirSync, writeFileSync } from "node:fs";
    const { TreeLease } = await import(${JSON.stringify(leaseModule)});
    const lease = TreeLease.take(${JSON.stringify(tree)});
    mkdirSync(${JSON.stringify(tree)}); writeFileSync(${JSON.stringify(join(tree, "half"))}, "half-written");
    const child = spawn("/bin/sleep", ["60"], { stdio: ["ignore", "ignore", "ignore", lease.descriptor], detached: true });
    child.unref();
    process.stdout.write(String(child.pid));
    process.kill(process.pid, "SIGKILL");`;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(run.signal, "SIGKILL", run.stderr);
  return Number(run.stdout);
}
const kill = (pid: number): void => { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } };
async function gone(pid: number): Promise<void> {
  for (let i = 0; i < 200; i++) { try { process.kill(pid, 0); } catch { return; } await new Promise(r => setTimeout(r, 10)); }
}

test("P0V-77 / R6-04, P0-4: a crashed maker's tree is kept while a child still holds its lease, and collected once none does", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-lease-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tree = join(root, "quarantine-ns-x");
  const child = crashedMaker(tree);
  t.after(() => kill(child));
  assert.deepEqual(treeQuiescence(tree), { kind: "active" }, "the maker is dead, its child is not");
  assert.deepEqual(collectLeasedTree(tree), { kind: "active" });
  assert.equal(existsSync(join(tree, "half")), true, "kept while something works in it");
  assert.throws(() => TreeLease.take(tree), /still working/, "nobody else starts on it either");
  kill(child); await gone(child);
  assert.deepEqual(collectLeasedTree(tree), { kind: "quiescent" });
  assert.equal(existsSync(tree), false);
  assert.equal(existsSync(leasePathOf(tree)), false, "the lease goes with its tree");
  // A tree with no lease was made before leases: nothing proves anything, it stays.
  mkdirSync(join(root, "legacy")); writeFileSync(join(root, "legacy", "x"), "x");
  assert.equal(collectLeasedTree(join(root, "legacy")).kind, "unknown");
  assert.equal(existsSync(join(root, "legacy", "x")), true);
});

test("P0V-77 / R6-04: the next provision collects a crashed repository staging only when its lease is free", async t => {
  const stateRoot = mkdtempSync(join(tmpdir(), "oma-provision-lease-"));
  t.after(() => rmSync(stateRoot, { recursive: true, force: true }));
  mkdirSync(join(stateRoot, "repos"), { recursive: true });
  const staging = join(stateRoot, "repos", ".project.git.staging.0011223344556677");
  const child = crashedMaker(staging);
  t.after(() => kill(child));
  assert.deepEqual(collectRepositoryStaging(stateRoot), { removed: [], kept: [".project.git.staging.0011223344556677"] });
  kill(child); await gone(child);
  provisionSociety(stateRoot);
  assert.equal(existsSync(staging), false, "the next provision collected it");
  assert.equal(existsSync(leasePathOf(staging)), false);
  assert.equal(existsSync(join(stateRoot, "repos", "project.git")), true, "and made the repository");
});

test("P0V-77 / R6-04: startup recovery collects an unaccepted quarantine or context tree by its lease, and keeps a held or unleased one", async t => {
  const stateRoot = mkdtempSync(join(tmpdir(), "oma-preaccept-lease-"));
  t.after(() => rmSync(stateRoot, { recursive: true, force: true }));
  const staging = join(stateRoot, "staging"); mkdirSync(staging, { recursive: true });
  const freeTree = join(staging, "quarantine-ns-free");
  const held = crashedMaker(join(staging, "quarantine-ns-held"));
  t.after(() => kill(held));
  const free = crashedMaker(freeTree); kill(free); await gone(free);
  mkdirSync(join(staging, "quarantine-ns-legacy"));
  writeFileSync(join(staging, "quarantine-ns-orphan.lease"), "");
  const store = { getOperationById: () => null } as never;
  const collection = collectUnacceptedArtifacts(stateRoot, store);
  assert.ok(collection.removed.includes(freeTree));
  assert.ok(collection.removed.includes(join(staging, "quarantine-ns-orphan")), "a lease whose tree is gone goes too");
  assert.deepEqual(collection.kept.map(entry => entry.path).sort(), [join(staging, "quarantine-ns-held"), join(staging, "quarantine-ns-legacy")].sort());
  assert.match(collection.kept.find(entry => entry.path.endsWith("held"))!.reason, /still holds its lease/);
  assert.equal(existsSync(freeTree), false);
});

test("R6-04: a synchronous command inherits the descriptors it is given, from 3 on, as a git holding a lease must", async t => {
  const { runProcessSync } = await import("../src/process/run.js");
  const root = mkdtempSync(join(tmpdir(), "oma-inherit-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const lease = TreeLease.take(join(root, "tree"));
  try {
    const seen = runProcessSync({ executable: "/usr/bin/readlink", argv: ["/proc/self/fd/3"], env: {}, timeoutMs: 5000, stdoutBytes: 4096, stderrBytes: 4096 },
      undefined, [lease.descriptor]);
    assert.equal(seen.kind, "exited");
    assert.equal(seen.stdout.toString("utf8").trim(), leasePathOf(join(root, "tree")));
  } finally { lease.release(); }
});

/** A CLI effect run in its own process: `fail` ends the process it runs in. */
function cliChild(script: string, options: { cwd?: string; env?: Record<string, string> } = {}) {
  const at = (module: string) => new URL(module, import.meta.url).href;
  const source = script.replace(/@(\.\.\/src\/[\w/.-]+\.js)/g, (_all, module: string) => at(module));
  return spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    cwd: options.cwd, encoding: "utf8", timeout: 60_000,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...options.env },
  });
}

test("P0V-78 / R6-05, INV10: a context tree is read only up to the context stream's bound, refused before the document that overflows it is read", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-context-bound-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tree = join(root, "ctx");
  mkdirSync(tree);
  writeFileSync(join(tree, "GOAL.md"), "goal\n");
  // 64 MiB, sparse: the reader this replaced allocated all of it first.
  const big = openSync(join(tree, "RATIONALE.md"), "w");
  ftruncateSync(big, 64 * 1024 * 1024);
  closeSync(big);
  const prepare = `
    import { prepareContextEffects } from "@../src/cli/effects/context.js";
    process.on("exit", () => process.stdout.write(JSON.stringify({ arrayBuffers: process.memoryUsage().arrayBuffers })));
    const prepared = prepareContextEffects(${JSON.stringify(tree)});
    process.stdout.write(JSON.stringify({ bytes: prepared.digest.bytes }) + "\\n");`;
  const refused = cliChild(prepare);
  assert.equal(refused.status, 2, refused.stderr);
  assert.match(refused.stderr, /context is larger than a request can carry \(8388608 bytes\) at RATIONALE\.md/);
  assert.ok(JSON.parse(refused.stdout).arrayBuffers < 8 * 1024 * 1024, `the refused document was allocated: ${refused.stdout}`);

  // The bound is the society's, carried in the environment; the edge is exact.
  writeFileSync(join(tree, "RATIONALE.md"), "why\n");
  const total = 5 + 4;
  const fits = cliChild(prepare, { env: { OMA_CONTEXT_BYTES: String(total) } });
  assert.equal(fits.status, 0, fits.stderr);
  assert.equal(JSON.parse(fits.stdout.split("\n")[0]!).bytes, total);
  const over = cliChild(prepare, { env: { OMA_CONTEXT_BYTES: String(total - 1) } });
  assert.equal(over.status, 2);
  assert.match(over.stderr, /larger than a request can carry \(8 bytes\) at RATIONALE\.md/);
});

test("P0V-78 / R6-05, INV10: a submission's bundle is read only up to the bundle stream's bound", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-bundle-bound-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { GIT_CONFIG_NOSYSTEM: "1", HOME: root, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid",
    GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid", PATH: process.env.PATH ?? "/usr/bin:/bin" };
  const git = (...argv: string[]) => {
    const result = spawnSync("git", argv, { cwd: root, env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "-q");
  writeFileSync(join(root, "a.txt"), "a\n");
  git("add", "a.txt");
  git("commit", "-q", "-m", "a");
  const candidate = git("rev-parse", "HEAD");
  const submit = `
    import { prepareSubmitEffects } from "@../src/cli/effects/submit.js";
    try {
      const prepared = prepareSubmitEffects(${JSON.stringify(candidate)}, "cli-${randomUUID()}", { hasCandidate: false, prerequisites: [] });
      process.stdout.write(JSON.stringify({ bytes: prepared.content.length }));
    } catch (error) { process.stdout.write(JSON.stringify({ code: error.code, message: error.message })); }`;
  const whole = JSON.parse(cliChild(submit, { cwd: root, env }).stdout);
  assert.ok(whole.bytes > 0, JSON.stringify(whole));
  const fits = JSON.parse(cliChild(submit, { cwd: root, env: { ...env, OMA_BUNDLE_BYTES: String(whole.bytes) } }).stdout);
  assert.equal(fits.bytes, whole.bytes);
  const over = JSON.parse(cliChild(submit, { cwd: root, env: { ...env, OMA_BUNDLE_BYTES: String(whole.bytes - 1) } }).stdout);
  assert.equal(over.code, "LIMIT_EXCEEDED");
  assert.match(over.message, new RegExp(`larger than a request can carry \\(${whole.bytes - 1} bytes\\)`));
});

test("P0V-78 / R6-05, CFG-003: every environment the CLI runs in carries the society's stream bounds, and an omitted one is the reference value", async () => {
  const { principalEnvironment } = await import("../src/tui/session.js");
  const { cliEnvironment } = await import("../src/extension/mail-tools.js");
  const { cliBundleBytes, cliContextBytes } = await import("../src/cli/transport.js");
  const { defaultHostConfig } = await import("../src/config/defaults.js");
  const limits = { frameBytes: 256 * 1024, mailBodyBytes: 1024, batchMaxMessages: 4, contextBytes: 12345, bundleBytes: 67890 };
  const principal = principalEnvironment({ stateRoot: "/srv/oma", runRoot: "/run/oma", libdir: "/opt/oma" },
    { society: "demo", provider: "pi", model: "current", workspaceBytes: 1024, extensions: [] }, limits);
  assert.equal(principal.OMA_CONTEXT_BYTES, "12345");
  assert.equal(principal.OMA_BUNDLE_BYTES, "67890");
  // A Resident's engine, whose shell and tools run the same CLI.
  const { planPiSpawn } = await import("../src/runtime/pi-spawn-plan.js");
  const resident = planPiSpawn({ actor: "alice", society: "demo", paths: { piCommand: "/usr/bin/node", coreExtension: "/opt/oma/ext.js", cli: "/opt/oma/cli.js",
    workspace: "/srv/oma/w", sessionDir: "/srv/oma/s", agentHome: "/srv/oma/h", mailArchive: "/srv/oma/m", batchView: "/srv/oma/v", socket: "/run/oma/control.sock" },
    profile: { provider: "p", model: "m", turnSeconds: 1, prompt: "", workspaceBytes: 1024, extensions: [] },
    limits: { ...limits, idleStreamSeconds: 1, receiptWaitSeconds: 1 } });
  assert.equal(resident.env.OMA_CONTEXT_BYTES, "12345");
  assert.equal(resident.env.OMA_BUNDLE_BYTES, "67890");
  const saved = { context: process.env.OMA_CONTEXT_BYTES, bundle: process.env.OMA_BUNDLE_BYTES };
  try {
    process.env.OMA_CONTEXT_BYTES = principal.OMA_CONTEXT_BYTES;
    process.env.OMA_BUNDLE_BYTES = principal.OMA_BUNDLE_BYTES;
    const forwarded = cliEnvironment("/h", "/s", "/a");
    assert.equal(forwarded.OMA_CONTEXT_BYTES, "12345", "the tools' CLI environment drops the context bound");
    assert.equal(forwarded.OMA_BUNDLE_BYTES, "67890", "the tools' CLI environment drops the bundle bound");
    assert.equal(cliContextBytes(), 12345);
    assert.equal(cliBundleBytes(), 67890);
    process.env.OMA_CONTEXT_BYTES = "8 MiB";
    assert.throws(() => cliContextBytes(), /OMA_CONTEXT_BYTES must be decimal bytes/);
    delete process.env.OMA_CONTEXT_BYTES;
    delete process.env.OMA_BUNDLE_BYTES;
    const reference = defaultHostConfig({ society: "demo", node: "/usr/bin/node", libdir: "/opt/oma", rootfs: "/state/rootfs", deploymentDigest: "a".repeat(64) }).limits;
    assert.equal(cliContextBytes(), reference.contextBytes);
    assert.equal(cliBundleBytes(), reference.bundleBytes);
  } finally {
    for (const [name, value] of [["OMA_CONTEXT_BYTES", saved.context], ["OMA_BUNDLE_BYTES", saved.bundle]] as const)
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

test("P0V-79 / R6-06: an SS3 report is one key or none, never an Escape and the characters behind it", async () => {
  const { KeyDecoder, decodeKeys } = await import("../src/tui/keys.js");
  const ss3 = (text: string) => decodeKeys(Buffer.from(`\u001bO${text}`));
  // Application cursor mode's arrows are the arrows.
  assert.deepEqual(ss3("A"), [{ kind: "up" }]);
  assert.deepEqual(ss3("B"), [{ kind: "down" }]);
  assert.deepEqual(ss3("C"), [{ kind: "right" }]);
  assert.deepEqual(ss3("D"), [{ kind: "left" }]);
  // F1–F4, Home, End, a modified F1, and a report nobody names: nothing is typed.
  for (const tail of ["P", "Q", "R", "S", "H", "F", "2P", "x"]) assert.deepEqual(ss3(tail), [], `ESC O ${tail}`);
  // Around text, in the same read.
  assert.deepEqual(decodeKeys(Buffer.from("a\u001bOPb")), [{ kind: "char", value: "a" }, { kind: "char", value: "b" }]);
  // Cut between reads, it is still one report.
  const decoder = new KeyDecoder();
  assert.deepEqual(decoder.push(Buffer.from("\u001bO")), []);
  assert.notEqual(decoder.pendingDelayMs, null, "a half report waits for its end");
  assert.deepEqual(decoder.push(Buffer.from("A")), [{ kind: "up" }]);
  // One that never ends is dropped at the deadline, and the next key is itself.
  assert.deepEqual(decoder.push(Buffer.from("\u001bO")), []);
  assert.deepEqual(decoder.flushPending(), []);
  assert.deepEqual(decoder.push(Buffer.from("q")), [{ kind: "char", value: "q" }]);
  // A lone Escape is still the Escape key, and CSI is unchanged.
  assert.deepEqual(decodeKeys(Buffer.from("\u001b")), [{ kind: "escape" }]);
  assert.deepEqual(decodeKeys(Buffer.from("\u001b[A")), [{ kind: "up" }]);
});

test("P0V-79 / R6-06: the terminal owner asks for normal cursor keys when it takes the terminal and whenever it repaints", async () => {
  const { openTerminal } = await import("../src/tui/screen.js");
  const input = { isTTY: false, resume() {}, pause() {}, on() {}, setRawMode() {} } as unknown as NodeJS.ReadStream;
  const written: string[] = [];
  const output = { columns: 80, rows: 24, write(text: string) { written.push(text); return true; }, on() {} } as unknown as NodeJS.WriteStream;
  const terminal = openTerminal({ input, output });
  const DECCKM_OFF = "\u001b[?1l";
  assert.ok(written.join("").includes(DECCKM_OFF), "application cursor mode left by another program stays on");
  written.length = 0;
  terminal.repaint();
  assert.ok(written.join("").includes(DECCKM_OFF), "a newly attached screen is not told again");
  terminal.restore();
});

/** A child that publishes `bytes` at `target` and is SIGKILLed at `point`/`phase`. */
function publishKilledAt(target: string, bytes: string, point: string, phase: string) {
  const module = new URL("../src/storage/durable-fs.js", import.meta.url).href;
  return spawnSync(process.execPath, ["--input-type=module", "-e", `
    const { publishNoReplace } = await import(${JSON.stringify(module)});
    publishNoReplace(${JSON.stringify(target)}, ${JSON.stringify(bytes)}, 0o600, fault => {
      if (fault.point === ${JSON.stringify(point)} && fault.phase === ${JSON.stringify(phase)}) process.kill(process.pid, "SIGKILL");
    });
    process.stdout.write("finished");`], { encoding: "utf8", timeout: 30_000 });
}

test("P0V-83, P0V-84 / R6-08: a no-replace publication killed at any step leaves its name absent or whole, and the next one collects what it left", async t => {
  const { publishNoReplace } = await import("../src/storage/durable-fs.js");
  const root = mkdtempSync(join(tmpdir(), "oma-no-replace-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const points = [["file-create", "before"], ["file-create", "after-visible"], ["file-write", "before"], ["file-write", "ambiguous"],
    ["file-fsync", "ambiguous"], ["file-fsync", "after-visible"], ["publication-link", "before"], ["publication-link", "after-visible"],
    ["temporary-cleanup", "before"], ["directory-fsync", "ambiguous"], ["directory-fsync", "after-visible"]] as const;
  const linked = new Set(["publication-link/after-visible", "temporary-cleanup/before", "directory-fsync/ambiguous", "directory-fsync/after-visible"]);
  for (const [point, phase] of points) {
    const dir = join(root, `${point}-${phase}`);
    mkdirSync(dir);
    const target = join(dir, "k.json");
    const run = publishKilledAt(target, "whole bytes", point, phase);
    assert.equal(run.signal, "SIGKILL", `${point}/${phase}: the child was not killed there: ${run.stdout}${run.stderr}`);
    const names = readdirSync(dir);
    if (linked.has(`${point}/${phase}`)) assert.equal(readFileSync(target, "utf8"), "whole bytes", `${point}/${phase}: the name is not whole`);
    else assert.equal(existsSync(target), false, `${point}/${phase}: the name appeared before its link`);
    assert.ok(names.every(name => name === "k.json" || /^\.k\.json\.[0-9a-f-]{36}\.tmp$/.test(name)), names.join(" "));
    // The next publication of the name collects its dead writer's temporary.
    const next = publishNoReplace(target, "whole bytes");
    assert.equal(next, linked.has(`${point}/${phase}`) ? "existing" : "created", `${point}/${phase}`);
    assert.deepEqual(readdirSync(dir), ["k.json"], `${point}/${phase}: a dead writer's temporary was left behind`);
    assert.equal(readFileSync(target, "utf8"), "whole bytes");
  }
});

test("P0V-84 / R6-08: a temporary whose writer is alive is not collected, and another name's never is", async t => {
  const { publishNoReplace } = await import("../src/storage/durable-fs.js");
  const root = mkdtempSync(join(tmpdir(), "oma-no-replace-live-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const module = new URL("../src/storage/durable-fs.js", import.meta.url).href;
  const { spawn } = await import("node:child_process");
  // A writer stopped between its write and its link: alive, holding its lock.
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    const { publishNoReplace } = await import(${JSON.stringify(module)});
    publishNoReplace(${JSON.stringify(join(root, "k.json"))}, "late", 0o600, fault => {
      if (fault.point === "publication-link" && fault.phase === "before") { process.stdout.write("stopped\\n"); process.kill(process.pid, "SIGSTOP"); }
    });`], { stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => { child.kill("SIGKILL"); });
  await new Promise<void>(resolve => { child.stdout!.once("data", () => { resolve(); }); });
  const live = readdirSync(root).filter(name => name.endsWith(".tmp"));
  assert.equal(live.length, 1);
  // Another name's dead temporary is not this name's to collect.
  writeFileSync(join(root, ".other.json.00000000-0000-4000-8000-000000000000.tmp"), "x");
  assert.equal(publishNoReplace(join(root, "k.json"), "first"), "created");
  assert.ok(readdirSync(root).includes(live[0]!), "a live writer's temporary was collected");
  assert.ok(readdirSync(root).includes(".other.json.00000000-0000-4000-8000-000000000000.tmp"));
  child.kill("SIGKILL");
  await new Promise(resolve => child.once("exit", resolve));
  assert.equal(publishNoReplace(join(root, "k.json"), "first"), "existing");
  assert.deepEqual(readdirSync(root).sort(), [".other.json.00000000-0000-4000-8000-000000000000.tmp", "k.json"]);
  assert.equal(readFileSync(join(root, "k.json"), "utf8"), "first");
});

test("P0V-85 / R6-08, P0-7: provisioning killed at the canonical main's creation leaves no main or the one it made, and the next start keeps it", async t => {
  const provision = new URL("../src/runtime/provision.js", import.meta.url).href;
  for (const point of ["before-main", "after-main"] as const) {
    const stateRoot = mkdtempSync(join(tmpdir(), `oma-main-${point}-`));
    t.after(() => rmSync(stateRoot, { recursive: true, force: true }));
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import cp from "node:child_process";
      import { syncBuiltinESMExports } from "node:module";
      const spawn = cp.spawnSync;
      cp.spawnSync = (command, args, options) => {
        const main = Array.isArray(args) && args.includes("update-ref") && args.includes("refs/heads/main");
        if (main && ${JSON.stringify(point)} === "before-main") process.kill(process.pid, "SIGKILL");
        const result = spawn(command, args, options);
        if (main) process.kill(process.pid, "SIGKILL");
        return result;
      };
      syncBuiltinESMExports();
      const { provisionSociety } = await import(${JSON.stringify(provision)});
      provisionSociety(${JSON.stringify(stateRoot)});
      process.stdout.write("finished");`], { encoding: "utf8", timeout: 60_000 });
    assert.equal(run.signal, "SIGKILL", `${point}: not killed at the main's creation: ${run.stdout}${run.stderr}`);
    const repository = join(stateRoot, "repos", "project.git");
    const observe = () => spawnSync("git", ["--git-dir", repository, "rev-parse", "--verify", "--quiet", "refs/heads/main^{commit}"], { encoding: "utf8" });
    const left = observe();
    if (point === "before-main") assert.equal(left.status, 1, "a main appeared before its creation");
    else assert.equal(left.status, 0, "the main the killed start created is gone");
    // The next start: what the dead one made is kept, nothing is made twice.
    const report = provisionSociety(stateRoot);
    const main = observe();
    assert.equal(main.status, 0);
    if (point === "after-main") {
      assert.equal(main.stdout, left.stdout, "the next start replaced the main the killed one had made");
      assert.equal(report.seeded, false, "the next start seeded a main that already existed");
    } else assert.equal(report.seedSource, "empty");
    assert.equal(spawnSync("git", ["--git-dir", repository, "fsck", "--strict"], { encoding: "utf8" }).status, 0);
    assert.deepEqual(readdirSync(join(stateRoot, "repos")).filter(name => name.startsWith(".") || name.endsWith(".lease")), [],
      "a staging or lease was left behind");
  }
});
