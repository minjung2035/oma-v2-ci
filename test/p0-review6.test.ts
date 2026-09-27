/** The sixth review's regressions (implementation/priority-0-audit.md,
 * "6차 점검", P0V-74 on): each is the review's counterexample, run against
 * the code that fixed it. */
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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
