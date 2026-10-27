import { residentEngineEffects } from "#oma-test/app/engine/resident-effects";
import { testBroker } from "./helpers/broker-fixture.js";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
/** The sixth review's regressions (docs/priority-0-audit.md,
 * "6차 점검", P0V-74 on): each is the review's counterexample, run against
 * the code that fixed it. */
import test from "node:test";
import { residentOptions } from "./fixtures/resident.js";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { closeSync, ftruncateSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Store, SCHEMA_PATH } from "@oma/storage";
import { StoreError, errorCodeOf, publicFailure } from "@oma/domain/errors";
import { AdmissionGate } from "@oma/domain/admission";

const schemaPath = SCHEMA_PATH;

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
  const { KeyDecoder } = await import("@oma/tui/keys");
  const { TERMINAL_BOUNDS } = await import("@oma/domain/surface-bounds");
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
import { TreeLease, collectLeasedTree, leasePathOf, treeQuiescence } from "@oma/storage/tree-lease";
import { collectRepositoryStaging, provisionSociety } from "#oma-test/app/runtime/provision";
import { collectUnacceptedArtifacts } from "@oma/storage/preaccept-collection";

const leaseModule = fileURLToPath(import.meta.resolve("@oma/storage/tree-lease"));
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
  const { runProcessSync } = await import("@oma/process/run");
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
  return spawnSync(process.execPath, ["--input-type=module", "-e", script], {
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
    import { prepareContextEffects } from ${JSON.stringify(import.meta.resolve("#oma-test/app/cli/effects/context"))};
    process.on("exit", () => process.stdout.write(JSON.stringify({ arrayBuffers: process.memoryUsage().arrayBuffers })));
    // w10: fail() throws a ClientError the CLI's fatal() ends; the child ends it the same way.
    try {
      const prepared = prepareContextEffects(${JSON.stringify(tree)});
      process.stdout.write(JSON.stringify({ bytes: prepared.digest.bytes }) + "\\n");
    } catch (error) { process.stderr.write("oma: " + error.message + "\\n"); process.exit(error.exitCode ?? 1); }`;
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
    import { prepareSubmitEffects } from ${JSON.stringify(import.meta.resolve("#oma-test/app/cli/effects/submit"))};
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
  const { principalEnvironment } = await import("@oma/engine/principal-session");
  const { cliEnvironment } = await import("@oma/extension/mail-tools");
  const { cliBundleBytes, cliContextBytes } = await import("#oma-test/app/cli/transport");
  const { defaultHostConfig } = await import("@oma/config/defaults");
  const limits = { frameBytes: 256 * 1024, mailBodyBytes: 1024, batchMaxMessages: 4, addresses: 64, contextBytes: 12345, bundleBytes: 67890 };
  const principal = principalEnvironment({ stateRoot: "/srv/oma", runRoot: "/run/oma", libdir: "/opt/oma" },
    { society: "demo", provider: "pi", model: "current", extensions: [] }, limits);
  assert.equal(principal.OMA_CONTEXT_BYTES, "12345");
  assert.equal(principal.OMA_BUNDLE_BYTES, "67890");
  // A Resident's engine, whose shell and tools run the same CLI.
  const { planPiSpawn } = await import("@oma/engine/pi-spawn-plan");
  const options = residentOptions("/srv/oma");
  const resident = planPiSpawn(residentEngineEffects.sandbox, { ...options, limits: { ...options.limits, ...limits } });
  assert.equal(resident.args[resident.args.indexOf("OMA_CONTEXT_BYTES") + 1], "12345");
  assert.equal(resident.args[resident.args.indexOf("OMA_BUNDLE_BYTES") + 1], "67890");
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
    const reference = defaultHostConfig({ society: "demo", node: "/usr/bin/node", libdir: "/opt/oma",  deploymentDigest: "a".repeat(64) }).limits;
    assert.equal(cliContextBytes(), reference.contextBytes);
    assert.equal(cliBundleBytes(), reference.bundleBytes);
  } finally {
    for (const [name, value] of [["OMA_CONTEXT_BYTES", saved.context], ["OMA_BUNDLE_BYTES", saved.bundle]] as const)
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

test("P0V-79 / R6-06: an SS3 report is one key or none, never an Escape and the characters behind it", async () => {
  const { KeyDecoder } = await import("@oma/tui/keys");
  const { decodeKeys } = await import("./fixtures/keys.js");
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
  const { openTerminal } = await import("@oma/tui/screen");
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
  const module = new URL(import.meta.resolve("@oma/storage/durable-fs"), import.meta.url).href;
  return spawnSync(process.execPath, ["--input-type=module", "-e", `
    const { publishNoReplace } = await import(${JSON.stringify(module)});
    publishNoReplace(${JSON.stringify(target)}, ${JSON.stringify(bytes)}, 0o600, fault => {
      if (fault.point === ${JSON.stringify(point)} && fault.phase === ${JSON.stringify(phase)}) process.kill(process.pid, "SIGKILL");
    });
    process.stdout.write("finished");`], { encoding: "utf8", timeout: 30_000 });
}

test("P0V-83, P0V-84 / R6-08: a no-replace publication killed at any step leaves its name absent or whole, and the next one collects what it left", async t => {
  const { publishNoReplace } = await import("@oma/storage/durable-fs");
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
    assert.ok(names.every(name => name === "k.json" || /^\.k\.json\.[0-9a-f-]{36}\.held\.tmp$/.test(name)), names.join(" "));
    // The next publication of the name collects its dead writer's temporary.
    const next = publishNoReplace(target, "whole bytes");
    assert.equal(next, linked.has(`${point}/${phase}`) ? "existing" : "created", `${point}/${phase}`);
    assert.deepEqual(readdirSync(dir), ["k.json"], `${point}/${phase}: a dead writer's temporary was left behind`);
    assert.equal(readFileSync(target, "utf8"), "whole bytes");
  }
});

test("P0V-84 / R6-08, P0V-111: a temporary whose writer is alive is not collected, nor one written without a lock", async t => {
  const { publishNoReplace } = await import("@oma/storage/durable-fs");
  const root = mkdtempSync(join(tmpdir(), "oma-no-replace-live-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const module = new URL(import.meta.resolve("@oma/storage/durable-fs"), import.meta.url).href;
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
  assert.match(live[0]!, /\.held\.tmp$/, "a locked temporary is named as one");
  // A temporary written without a lock (a configuration's) proves nothing by a free lock.
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
  const provision = new URL(import.meta.resolve("#oma-test/app/runtime/provision")).href;
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

test("P0V-86 / R6-09, IPC-001: every UTF-8 reading keeps a U+FEFF as the character it is, so strict JSON refuses a BOM", async () => {
  const owner = await import("@oma/domain/utf8");
  const vectors: Array<[string, Uint8Array]> = [
    ["leading BOM", Buffer.from("﻿a")], ["BOM only", Buffer.from("﻿")], ["inner BOM", Buffer.from("a﻿b")],
    ["two BOMs", Buffer.from("﻿﻿")], ["Korean", Buffer.from("한글")], ["empty", new Uint8Array(0)],
    ["overlong", Uint8Array.from([0xc0, 0xaf])], ["cut", Uint8Array.from([0xe3, 0x81])], ["surrogate", Uint8Array.from([0xed, 0xa0, 0x80])],
  ];
  const answer = (decode: (bytes: Uint8Array) => string, bytes: Uint8Array) => { try { return { text: decode(bytes) }; } catch { return { refused: true }; } };
  for (const [name, bytes] of vectors) {
    const expected = answer(bytes => Buffer.from(bytes).toString("utf8"), bytes);
    if (!("refused" in answer(owner.decodeUtf8, bytes))) assert.deepEqual(answer(owner.decodeUtf8, bytes), expected, `${name} is not read as its bytes`);
  }
  assert.equal(owner.decodeUtf8(Buffer.from("﻿a")), "﻿a");
  // A stream keeps a BOM that a read boundary cuts, wherever it falls.
  const bom = Buffer.from("x﻿y");
  for (let split = 0; split <= bom.length; split++) {
    const decoder = owner.utf8Decoder();
    assert.equal(decoder.decode(bom.subarray(0, split), { stream: true }) + decoder.decode(bom.subarray(split)), "x﻿y", `split at ${split}`);
  }
  // The wire: a BOM-prefixed frame is not JSON (G06's `== BOM at start ==`).
  const { parseJsonObject } = await import("@oma/protocol/frame");
  assert.throws(() => parseJsonObject(Buffer.from('﻿{"a":1}')), (error: unknown) => (error as { code?: string }).code === "INVALID_REQUEST");
  assert.deepEqual(parseJsonObject(Buffer.from('{"a":"﻿"}')).raw, { a: "﻿" }, "a U+FEFF inside a string is data");
  // The engine's JSONL: a BOM-prefixed line is not an event.
  const { JsonlReader } = await import("@oma/protocol/jsonl");
  const reader = new JsonlReader(1024);
  assert.throws(() => reader.feed(Buffer.from('﻿{"type":"x"}\n'), () => {}), /malformed UTF-8 or JSON/);
  // A process's output is its bytes.
  const { decodeProcessText } = await import("@oma/process/run");
  assert.equal(decodeProcessText(Buffer.from("﻿line\n")), "﻿line\n");
  // Context: the text keeps it; a document of nothing but it is still empty.
  const { contextFileCheck } = await import("@oma/domain/context-policy");
  assert.equal(contextFileCheck("GOAL.md", Buffer.from("﻿")), "GOAL.md must not be empty");
  assert.equal(contextFileCheck("GOAL.md", Buffer.from("﻿﻿")), null, "only the one that begins the document is its signature");
  assert.equal(contextFileCheck("GOAL.md", Buffer.from("﻿goal")), null);
});

test("P0V-87 / R6-10: mail accepted after the clock was set back is still delivered after the mail accepted before it", async t => {
  const { MailModule } = await import("@oma/mail");
  const { makeValidAgent } = await import("./fixtures/spec.js");
  const dir = mkdtempSync(join(tmpdir(), "oma-order-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // The wall clock is under the test's hand before anything that reads it exists.
  const wall = Date.now;
  let offset = 0;
  Date.now = () => wall() + offset;
  t.after(() => { Date.now = wall; });
  const store = new Store(join(dir, "runtime.sqlite"));
  t.after(() => store.close());
  store.transaction(() => { for (const name of ["a", "b"]) store.insertAgent(makeValidAgent(name, { desired: "enabled", incarnation: 1 })); });
  const mail = createMailModule({ stateRoot: dir, society: "demo" }, store, 64);
  const auth = { actor: "a", incarnation: 1, role: "resident" as const, channel: "actor" as const, capabilities: new Set(["mail.send" as const]),
    peer: { pid: 1, uid: 1000, gid: 1000 } };
  try {
    // Each one accepted an hour earlier, on the wall clock, than the one before it.
    for (let index = 0; index < 5; index++) {
      await mail.send(auth, `order-${index}`, { to: ["b"], subject: `s${index}`, kind: "message", body: `m${index}` });
      offset -= 3600_000;
    }
  } finally { Date.now = wall; }
  const stamps = store.pendingDeliveries("b").map(row => row.createdAtMs);
  assert.ok(stamps.every((stamp, index) => index === 0 || stamp < stamps[index - 1]!), `the wall clock was not set back between acceptances: ${stamps.join(" ")}`);
  const accepted = [0, 1, 2, 3, 4].map(index => {
    const operation = store.transaction(() => store.getOperation("a", `order-${index}`))!;
    return (JSON.parse(operation.planJson).intent as { message: { id: string } }).message.id;
  });
  assert.deepEqual(store.pendingDeliveries("b").map(row => row.messageId), accepted, "the recipient reads its mail in another order than it was accepted");
  assert.deepEqual((await store.pendingWorkRows()).unbatched.filter(row => row.recipient === "b").map(row => row.messageId), accepted);
});

test("P0V-87 / R6-10: ledger SQL that orders by a wall-clock column is refused", async () => {
  const { transactionRuleFindings } = await import(new URL("../../scripts/architecture/rules/transaction-rules.mjs", import.meta.url).href);
  const root = mkdtempSync(join(tmpdir(), "oma-order-rule-"));
  try {
    mkdirSync(join(root, "apps/oma/src"), { recursive: true }); mkdirSync(join(root, "implementation"));
    writeFileSync(join(root, "implementation/mutation-owners.json"), JSON.stringify({ mutations: {} }));
    const findings = (sql: string) => { writeFileSync(join(root, "apps/oma/src/reader.ts"), `export const q = \`${sql}\`;`);
      return (transactionRuleFindings(root) as Array<{ rule: string }>).filter(value => value.rule === "ledger-order-clock"); };
    assert.equal(findings("SELECT * FROM deliveries WHERE recipient=? ORDER BY rowid").length, 0);
    assert.equal(findings("SELECT * FROM batches ORDER BY agent, rowid").length, 0, "a column that is not a clock may lead");
    assert.equal(findings("SELECT created_at_ms FROM operations ORDER BY rowid").length, 0, "reading the clock is display");
    assert.equal(findings("SELECT * FROM deliveries ORDER BY created_at_ms, message_id").length, 1);
    assert.equal(findings("SELECT id FROM operations ORDER BY rowid, updated_at_ms DESC").length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("P0V-88 / R6-11: a sweep observes a recovery failure once, and still observes a failure of its own", async () => {
  const { OperationRecovery } = await import("@oma/reconcile/operations");
  const row = { id: "op1", kind: "git.submit", state: "pending" } as never;
  // The review's counterexample: the observer's own verdict comes back to it.
  const seen: unknown[] = [];
  const blocking = new OperationRecovery({ snapshot: () => ["op1"], read: () => row,
    recover: async () => { throw new StoreError("STORE_CORRUPT", "injected corrupt during recover"); },
    failure: error => { seen.push(error); throw new StoreError("STORE_CORRUPT", "fence"); } });
  await assert.rejects(blocking.sweep(), /fence/);
  assert.equal(seen.length, 1, "the observer was handed its own verdict as a second failure");
  assert.match(String((seen[0] as Error).message), /injected corrupt/);
  // A failure the observer has not seen -- the row vanishing -- is still observed, once.
  const vanished: unknown[] = [];
  let reads = 0;
  const vanishing = new OperationRecovery({ snapshot: () => ["op1"], read: () => (reads++ === 0 ? row : null),
    recover: async () => {}, failure: error => { vanished.push(error); } });
  await assert.rejects(vanishing.sweep(), /disappeared/);
  assert.equal(vanished.length, 1);
});

test("P0V-90 / R6-13: a generation already present is reused only if it holds these files and nothing else", async () => {
  const { loadConfigurationSnapshot, validateConfig } = await import("@oma/config");
  const { commitManagedEdit } = await import("#oma-test/app/application/settings");
  const { MANAGED_DIRECTORY } = await import("@oma/config/generations");
  const { createCompleteConfigurationFixture } = await import("./fixtures/configuration.js");
  const { chmodSync } = await import("node:fs");
  type Snapshot = ReturnType<typeof loadConfigurationSnapshot>;
  const withModel = (snapshot: Snapshot, model: string) => validateConfig({ ...snapshot.config,
    agentProfiles: { ...snapshot.config.agentProfiles, principal: { ...snapshot.config.agentProfiles.principal!, modelProfile: model } } });
  for (const tamper of ["none", "extra file", "extra directory"] as const) {
    const f = createCompleteConfigurationFixture();
    try {
      const original = loadConfigurationSnapshot(f.path).config.agentProfiles.principal!.modelProfile;
      const review = commitManagedEdit(loadConfigurationSnapshot(f.path), withModel(loadConfigurationSnapshot(f.path), "review"));
      assert.ok(review.generation !== null);
      commitManagedEdit(loadConfigurationSnapshot(f.path), withModel(loadConfigurationSnapshot(f.path), original));
      const generation = join(f.output, MANAGED_DIRECTORY, "generations", review.generation!);
      if (tamper !== "none") {
        chmodSync(generation, 0o700);
        if (tamper === "extra file") writeFileSync(join(generation, "extra.json"), "{}\n");
        else mkdirSync(join(generation, "extra"));
        chmodSync(generation, 0o500);
      }
      const again = () => commitManagedEdit(loadConfigurationSnapshot(f.path), withModel(loadConfigurationSnapshot(f.path), "review"));
      if (tamper === "none") assert.equal(again().generation, review.generation, "an identical generation is reused");
      else assert.throws(again, (error: unknown) => error instanceof StoreError && error.code === "STORE_CORRUPT" && /holds other bytes/.test(error.message),
        `a generation with an ${tamper} was taken for the one its name says`);
    } finally { f.close(); }
  }
});

test("P0V-92 / R6-15: a runner or a retried key the ledger no longer knows is refused by name, not assumed away", async t => {
  const { InternalDispatcher } = await import("@oma/broker/internal-dispatcher");
  const peer = { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), alive: () => true, sameSender: () => false,
    retainForExecution: () => () => undefined, releaseConnection: () => undefined };
  const dispatcher = new InternalDispatcher({
    store: { getAgentIdentity: () => null, pendingDeliveryCount: () => 0, getBatchAgent: () => null, preparedBatchIds: () => [] },
    mail: { prepare: async () => null, complete: async () => {}, moveToCur: () => 0 } as never,
    peers: { requireRunnerPeer: () => {}, runnerActor: () => "alice",
      runnerAuth: () => { throw new Error("authenticated a runner the ledger does not know"); } },
    isDraining: () => false, assertAdmission: () => {},
    failureAnswer: (id, error) => ({ id, ok: false, code: (error as { code?: string }).code, message: (error as Error).message }),
    refreshViews: () => {}, openRun: () => { throw new Error("no run is opened here"); },
  });
  for (const [method, params] of [["runner.pending", {}], ["runner.observe", { reason: "test", observedAtMs: 1 }], ["batch.prepare", {}]] as const) {
    const answer = await dispatcher.dispatch({ v: 1, id: method, method, params }, peer as never, null, "runner") as { code?: string; message?: string };
    assert.equal(answer.code, "AUTH_FAILED", `${method}: ${answer.message}`);
    assert.match(answer.message ?? "", /runner identity missing/);
  }
  // A key answered as a retry whose operation is gone: corrupt, said so.
  const dir = mkdtempSync(join(tmpdir(), "oma-retried-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new Store(join(dir, "runtime.sqlite"));
  t.after(() => store.close());
  assert.throws(() => store.retriedOperation("alice", "no-such-key"),
    (error: unknown) => error instanceof StoreError && error.code === "STORE_CORRUPT" && /answered as a retry/.test(error.message));
});

test("P0V-93 / R6-16: a run is opened on the GOAL owner's answer, and an answer it cannot give is not \"no GOAL\"", async t => {
  const { MailModule } = await import("@oma/mail");
  const { Broker } = await import("@oma/broker");
  const { PolicyExecution } = await import("./fixtures/execution.js");
  const { ViewsModule } = await import("#oma-test/app/views");
  const { LifecycleModule } = await import("@oma/lifecycle");
  const { ALL_CAPS, makeValidAgent, makeValidResolvedSpec } = await import("./fixtures/spec.js");
  const root = mkdtempSync(join(tmpdir(), "oma-goal-owner-"));
  const store = new Store(join(root, "runtime.sqlite"), 5, { society: "demo" });
  t.after(() => { try { store.close(); } finally { rmSync(root, { recursive: true, force: true }); } });
  store.transaction(tx => { tx.insertAgent(makeValidAgent("alice", { desired: "enabled", incarnation: 1 })); });
  const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 64);
  const units = new PolicyExecution();
  const views = new ViewsModule(store, root, "demo", "p");
  const lifecycle = createLifecycleModule(store, units, { stateRoot: root, projectGit: join(root, "project.git"), society: "demo", hasGoal: () => false, activationAllowed: () => true },
    (_parent, input) => makeValidResolvedSpec(input.name, "p", ALL_CAPS, input.from, input.brief), mail);
  let answer: () => boolean = () => false;
  const broker = testBroker({ store: store, mail: mail, units: units, views: views, lifecycle: lifecycle, git: null, reviews: null, reconcile: null, paths: { stateRoot: root, runRoot: join(root, "run"), society: "demo", hasGoal: () => answer() } });
  const openRun = (Reflect.get(broker, "openRun") as (actor: string, invocation: string) => Promise<unknown>).bind(broker);
  await assert.rejects(() => openRun("alice", "inv"), (error: unknown) => error instanceof StoreError && error.code === "GOAL_REQUIRED");
  // The owner could not look (EACCES, EIO): that is its answer, not a missing GOAL.
  answer = () => { throw new StoreError("BROKER_UNAVAILABLE", "the context could not be observed"); };
  await assert.rejects(() => openRun("alice", "inv"), (error: unknown) => error instanceof StoreError && error.code === "BROKER_UNAVAILABLE");
});

test("P0V-94 / R6-17: a derived TSV field escapes every control character itself, reversibly", async () => {
  const { fieldEscape } = await import("#oma-test/app/views");
  assert.equal(fieldEscape("a\tb\nc\rd\\e"), "a\\tb\\nc\\rd\\\\e");
  assert.equal(fieldEscape("\u001b[2Jx\u0000\u007f\u0085"), "\\x1b[2Jx\\x00\\x7f\\x85", "a terminal instruction or a C1 control reached the reader");
  assert.equal(fieldEscape("동료 😀"), "동료 😀", "text is not touched");
  // Reversible: one escape per character, and a backslash is never ambiguous.
  const unescape = (text: string) => text.replace(/\\(\\|t|n|r|x[0-9a-f]{2})/g, (_all, code: string) =>
    code === "\\" ? "\\" : code === "t" ? "\t" : code === "n" ? "\n" : code === "r" ? "\r" : String.fromCharCode(parseInt(code.slice(1), 16)));
  for (const value of ["\\t", "a\\\tb", "\u0001\u001f\u009f", "x\\x1b"]) {
    const escaped = fieldEscape(value);
    assert.doesNotMatch(escaped, /[\u0000-\u001f\u007f-\u009f]/);
    assert.equal(unescape(escaped), value);
  }
});

// P0V-95/R6-20 and P0V-98 unit publication/ownership regressions retain
// their original IDs and bytes in the raw archive. Native opening publication,
// recovery and foreign-owner refusal use actual scope/journal tests instead.
