/** Permanent reproduction tests for the 2026-10-03 adversarial Priority-0
 * audit fixes. Each test fails on the code as audited and holds the fix:
 *
 * AV-20261003-18: a context staging lease is released when the step after its
 *   acquisition fails (the caller owns nothing until the tree is returned).
 * AV-20261003-19: an unaccepted `.prepare-*` context revision tree has an
 *   owner (its lease) and startup collection accounts for it.
 * AV-20261003-20: startup recovery isolates a recoverable non-mail failure
 *   per operation the way the periodic sweep does.
 * AV-20261003-25: a candidate path outside the path grammar is refused at
 *   candidate scope, never durable-store corruption.
 * NB-18: a bounded read refuses a file that changed while it was read, the
 *   way diagnostics' FILE_CHANGED_DURING_READ reports it. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { createHash } from "node:crypto";
import {
  closeSync, existsSync, ftruncateSync, mkdirSync, mkdtempSync, openSync,
  readdirSync, readlinkSync, rmSync, writeFileSync, writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareContextStream } from "../src/storage/context-stream.js";
import { contextStagingPathAt } from "../src/storage/paths.js";
import { TreeLease, leasePathOf, treeQuiescence } from "../src/storage/tree-lease.js";
import { generateOperationId } from "../src/ids.js";
import { collectUnacceptedArtifacts } from "../src/reconcile/preaccept.js";
import { ReconcileModule } from "../src/reconcile.js";
import { Store, StoreError } from "../src/store.js";
import { requestHash } from "../src/hash.js";
import { GitObserver, observed, parseNameStatusZ } from "../src/git/observe.js";
import { isValidWirePath } from "../src/domain/identifiers.js";
import { readBounded } from "../src/cli/effects.js";
import { makeValidAgent } from "./fixtures/spec.js";
import type { MailModule } from "../src/mail.js";
import type { UnitsModule } from "../src/units.js";
import type { LifecycleModule } from "../src/lifecycle.js";

test("AV-20261003-18: a failure after the staging lease is taken releases the lease", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-av18-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const id = generateOperationId();
  const body = Buffer.from("fixture goal\n");
  const sha256 = createHash("sha256").update(body).digest("hex");
  const entries = [{ path: "GOAL.md", bytes: body.length, sha256 }];
  const descriptor = { bytes: body.length, sha256, mediaType: "application/vnd.oma.context-v1" as const };
  const leasePath = leasePathOf(contextStagingPathAt(root, id));
  const original = fs.openSync;
  let injected = 0;
  const ownedDescriptors = () => readdirSync("/proc/self/fd").flatMap(name => {
    try { return readlinkSync("/proc/self/fd/" + name) === leasePath ? [Number(name)] : []; }
    catch { return []; }
  });
  try {
    // Any open inside acquireStagingRoot that is not the lease's own fails: the
    // parent directory open ran after lease acquisition on the audited code.
    (fs as { openSync: typeof fs.openSync }).openSync = (...args: Parameters<typeof fs.openSync>) => {
      const stack = new Error().stack ?? "";
      if (stack.includes("acquireStagingRoot") && !stack.includes("TreeLease.take")) {
        injected++;
        throw Object.assign(new Error("injected parent open failure after lease acquisition"), { code: "EMFILE" });
      }
      return original(...args);
    };
    syncBuiltinESMExports();
    await assert.rejects(prepareContextStream(root, id, entries, descriptor,
      (async function* () { yield body; })()), { code: "EMFILE" });
    (fs as { openSync: typeof fs.openSync }).openSync = original;
    syncBuiltinESMExports();
    assert.equal(injected, 1);
    assert.deepEqual({ leakedDescriptors: ownedDescriptors().length, quiescence: treeQuiescence(contextStagingPathAt(root, id)) },
      { leakedDescriptors: 0, quiescence: { kind: "quiescent" } },
      "a rejected preparation returns no lease owner to the caller");
  } finally {
    (fs as { openSync: typeof fs.openSync }).openSync = original;
    syncBuiltinESMExports();
    for (const fd of ownedDescriptors()) closeSync(fd);
  }
});

test("AV-20261003-19: startup collection owns unaccepted .prepare-* revision trees", t => {
  const stateRoot = mkdtempSync(join(tmpdir(), "oma-av19-"));
  t.after(() => rmSync(stateRoot, { recursive: true, force: true }));
  const revisions = join(stateRoot, "world", "context", "revisions");
  mkdirSync(revisions, { recursive: true });
  // A preparation that wrote its lease then died: quiescent, so collected.
  const quiescent = join(revisions, `.prepare-${"a".repeat(64)}-${generateOperationId()}`);
  const lease = TreeLease.take(quiescent);
  mkdirSync(quiescent, { recursive: true });
  writeFileSync(join(quiescent, "GOAL.md"), "goal\n");
  lease.release();
  // A preparation made before leases existed: kept, and said why.
  const unleased = join(revisions, `.prepare-${"b".repeat(64)}-${generateOperationId()}`);
  mkdirSync(unleased, { recursive: true });
  writeFileSync(join(unleased, "GOAL.md"), "goal\n");
  // A lease whose tree is already gone goes too.
  const orphan = join(revisions, `.prepare-${"c".repeat(64)}-${generateOperationId()}`);
  TreeLease.take(orphan).release();
  // The accepted revision and every name the grammar does not derive stay.
  const accepted = join(revisions, "d".repeat(64));
  mkdirSync(accepted, { recursive: true });
  writeFileSync(join(accepted, "GOAL.md"), "accepted\n");
  mkdirSync(join(revisions, ".prepare-not-an-oid"));
  writeFileSync(join(revisions, "unrelated"), "x");
  const collection = collectUnacceptedArtifacts(stateRoot, { getOperationById: () => null });
  assert.ok(collection.removed.includes(quiescent), "a quiescent leased preparation is reclaimed");
  assert.ok(collection.removed.includes(orphan), "a lease whose tree is gone goes too");
  assert.ok(collection.kept.some(entry => entry.path === unleased), "unleased residue is accounted for, not invisible");
  assert.equal(existsSync(quiescent), false);
  assert.equal(existsSync(leasePathOf(quiescent)), false);
  assert.equal(existsSync(unleased), true);
  assert.equal(existsSync(accepted), true, "an accepted revision is never collected");
  assert.equal(existsSync(join(revisions, ".prepare-not-an-oid")), true, "a name the grammar does not derive is untouched");
});

test("AV-20261003-20: startup contains a recoverable non-mail failure like the sweep does", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-av20-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new Store(join(root, "runtime.sqlite"));
  try {
    const payload = { agent: "a" };
    const plan = { kind: "agent.start", agent: "a", previousIncarnation: 0, desired: "enabled", remainingOperations: [] };
    const id = generateOperationId();
    store.transaction(() => {
      store.insertAgent(makeValidAgent("a", { desired: "stopped", incarnation: 0 }));
      store.insertOperation({
        id, actor: "a", requestKey: "k-startup-wedge", requestHash: requestHash("agent.start", payload),
        kind: "agent.start", payloadJson: JSON.stringify(payload), planJson: JSON.stringify(plan),
      });
    });
    const lifecycle = {
      reconcileAction: () => { throw new StoreError("REF_STATE_UNKNOWN", "fixture: persistent recovery unknown"); },
      reconcileSociety: () => { throw new StoreError("REF_STATE_UNKNOWN", "fixture"); },
      reconcileCreate: async () => { throw new StoreError("REF_STATE_UNKNOWN", "fixture"); },
    } as unknown as LifecycleModule;
    const units = { stop: () => undefined, confirmDead: () => true } as unknown as UnitsModule;
    const reconcile = new ReconcileModule(store, {} as MailModule, null, units, lifecycle, {
      projectGit: join(root, "repos", "project.git"), hasGoal: () => true, activationAllowed: () => true,
    });
    await assert.doesNotReject(reconcile.sweep(), "the periodic path already contained the failure");
    await assert.doesNotReject(reconcile.startup(), "startup must not die on a recoverable unknown for a non-mail operation kind");
    assert.ok(reconcile.operationOutcomes?.some(outcome => outcome.id === id && outcome.state === "pending"),
      "the failure is retained on the operation, not lost and not terminal");
  } finally { try { store.close(); } catch { /* fixture teardown */ } }
});

test("AV-20261003-25: a changed-path name outside the grammar is a candidate-scope refusal", () => {
  const evidence = (stdout: Uint8Array) => ({ status: 0, signal: null, stdout, stderr: Buffer.alloc(0) });
  // diff-tree --name-status -z output: a valid record, then a name with a
  // byte no UTF-8 string can represent. On the audited code this whole
  // observation classified "corrupt" and raised the society-wide fence.
  const dirty = Buffer.concat([Buffer.from("M\0GOOD.md\0A\0bad-"), Buffer.from([0xff]), Buffer.from(".md\0")]);
  const observer = new GitObserver(() => evidence(dirty));
  const observation = observer.changedPaths("/repo.git", "a".repeat(64), "b".repeat(64));
  assert.equal(observation.kind, "refused");
  assert.throws(() => observed(observation, "changed paths"),
    (error: unknown) => error instanceof StoreError && error.code === "INVALID_REQUEST");
  // The parser's other failure shapes keep their honest scope: candidate
  // content refuses, malformed output corrupts.
  assert.deepEqual(parseNameStatusZ(dirty), { ok: false, reason: "a changed-path name is not UTF-8", scope: "candidate" });
  assert.equal(parseNameStatusZ(Buffer.from("M\0../escape\0")).ok, false);
  assert.equal((parseNameStatusZ(Buffer.from("M\0../escape\0")) as { scope: string }).scope, "candidate");
  assert.equal((parseNameStatusZ(Buffer.from("M\0unterminated")) as { scope: string }).scope, "output");
  assert.equal((parseNameStatusZ(Buffer.from("X\0name\0")) as { scope: string }).scope, "output");
});

test("AV-20261003-25: the wire-path grammar refuses a lone surrogate, not a paired one", () => {
  assert.equal(isValidWirePath("bad-\uD800.md"), false, "a lone high surrogate is unrepresentable");
  assert.equal(isValidWirePath("bad-\uDC00.md"), false, "a lone low surrogate is unrepresentable");
  assert.equal(isValidWirePath("emoji-\uD800\uDC00.md"), true, "a paired astral character is a valid name");
});

test("NB-18: a whole bounded read refuses a file that shrank or was rewritten during it", t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-nb18-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const refusal = (captured: { code: string | null }) => (code: string): never => {
    captured.code = code; throw new StoreError("INVALID_REQUEST", code);
  };
  const file = join(dir, "input");
  const originalRead = fs.readSync;
  const restore = () => { (fs as { readSync: typeof fs.readSync }).readSync = originalRead; syncBuiltinESMExports(); };
  t.after(restore);
  /** `act` runs between readBounded's opening stat and its first read. */
  const mutateOnFirstRead = (fd: number, act: () => void): void => {
    let armed = true;
    (fs as { readSync: typeof fs.readSync }).readSync = ((...args: unknown[]) => {
      if (args[0] === fd && armed) { armed = false; act(); }
      return (originalRead as (...a: unknown[]) => number)(...args);
    }) as typeof fs.readSync;
    syncBuiltinESMExports();
  };
  // Truncate between the opening stat and the read: a whole read gets a short
  // read and refuses "changed" (the audited code returned the prefix silently).
  writeFileSync(file, Buffer.alloc(4096, 65));
  let fd = openSync(file, "r+");
  try {
    mutateOnFirstRead(fd, () => ftruncateSync(fd, 4));
    const captured = { code: null as string | null };
    assert.throws(() => readBounded(fd, 1 << 20, true, refusal(captured)), { code: "INVALID_REQUEST" });
    assert.equal(captured.code, "changed", "a short read where a full file was expected is a changed file");
  } finally { closeSync(fd); restore(); }
  // An in-place rewrite of the same size: the post-read descriptor check
  // reports it. Inode timestamps move at the kernel's coarse tick, so the
  // rewrite is held past a tick boundary to land observably after the stat.
  const spin = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  writeFileSync(file, Buffer.alloc(4096, 65));
  fd = openSync(file, "r+");
  try {
    mutateOnFirstRead(fd, () => { spin(); writeSync(fd, Buffer.alloc(4096, 66), 0, 4096, 0); });
    const captured = { code: null as string | null };
    assert.throws(() => readBounded(fd, 1 << 20, true, refusal(captured)), { code: "INVALID_REQUEST" });
    assert.equal(captured.code, "changed", "an in-place rewrite inside the read window is a changed file");
  } finally { closeSync(fd); restore(); }
  // Shrinkage under a head read is refused too; a stable file still reads whole.
  writeFileSync(file, Buffer.alloc(64, 67));
  fd = openSync(file, "r+");
  try {
    mutateOnFirstRead(fd, () => ftruncateSync(fd, 8));
    const captured = { code: null as string | null };
    assert.throws(() => readBounded(fd, 1 << 20, false, refusal(captured)), { code: "INVALID_REQUEST" });
    assert.equal(captured.code, "changed");
  } finally { closeSync(fd); restore(); }
  writeFileSync(file, Buffer.alloc(64, 67));
  fd = openSync(file, "r");
  try { assert.deepEqual(readBounded(fd, 1 << 20, true, refusal({ code: null })), Buffer.alloc(64, 67), "a stable file still reads whole"); }
  finally { closeSync(fd); }
});
