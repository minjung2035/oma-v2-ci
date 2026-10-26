import { createReconcileModule } from "#oma-test/app/broker/reconcile-composition";
import { serializePlanIntent } from "./fixtures/plan.js";
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
import { prepareContextStream } from "@oma/storage/context-stream";
import { publishContextRevision } from "@oma/storage/context-snapshot";
import { contextStagingPathAt } from "@oma/domain/paths";
import { TreeLease, leasePathOf, treeQuiescence } from "@oma/storage/tree-lease";
import { generateOperationId } from "@oma/native/identity";
import { collectUnacceptedArtifacts } from "@oma/storage/preaccept-collection";
import { ReconcileModule } from "@oma/reconcile";
import { Store } from "@oma/storage";
import { StoreError } from "@oma/domain/errors";
import { requestHash } from "@oma/domain/request-identity";
import { GitObserver, parseNameStatusZ } from "@oma/git/observe";
import { observed } from "@oma/domain/git-facts";
import { isValidWirePath } from "@oma/domain/identifiers";
import { readBounded } from "#oma-test/app/cli/effects";
import { makeValidAgent } from "./fixtures/spec.js";
import type { MailModule } from "@oma/mail";
import type { FeatureExecution } from "./fixtures/execution.js";
import type { LifecycleModule } from "@oma/lifecycle";

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

test("AV-20261003-18: a failed context revision preparation releases its staging lease", t => {
  // The same leak shape as the staging-root case above: TreeLease.take() ran,
  // then the audited code reached the tree's own directory creation OUTSIDE
  // the guarded try. This injection fails the first mkdir whose leaf is the
  // publication's ".prepare-*" temporary -- the very first step after the
  // lease is taken -- so on the broken code the lease descriptor would stay
  // open and the ".lease" would read active until process exit.
  const worldDir = mkdtempSync(join(tmpdir(), "oma-av18-snap-"));
  t.after(() => rmSync(worldDir, { recursive: true, force: true }));
  const source = join(worldDir, "source");
  mkdirSync(source, { recursive: true });
  const body = Buffer.from("fixture goal\n");
  writeFileSync(join(source, "GOAL.md"), body);
  const candidate = "e".repeat(64);
  const entries = [{ path: "GOAL.md", bytes: body.length, sha256: createHash("sha256").update(body).digest("hex") }];
  const revisions = join(worldDir, "context", "revisions");
  const leasedDescriptors = () => readdirSync("/proc/self/fd").flatMap(name => {
    try { return (readlinkSync("/proc/self/fd/" + name)).includes(".prepare-") ? [Number(name)] : []; }
    catch { return []; }
  });
  const original = fs.fsyncSync;
  let injected = 0;
  try {
    // The owned directory now uses mkdirat. Fail its first actual flush
    // after the staging lease was acquired, while the same owner guard is live.
    fs.fsyncSync = fd => {
      const path = readlinkSync(`/proc/self/fd/${fd}`);
      if (path.split("/").pop()!.startsWith(".prepare-") && !path.endsWith(".lease") && injected === 0) {
        injected++;
        throw Object.assign(new Error("injected temporary flush failure after lease acquisition"), { code: "EMFILE" });
      }
      original(fd);
    };
    syncBuiltinESMExports();
    assert.throws(() => publishContextRevision(worldDir, candidate, entries, source), { code: "EMFILE" });
    fs.fsyncSync = original;
    syncBuiltinESMExports();
    assert.equal(injected, 1, "the injected failure ran once, after the lease was taken");
    assert.deepEqual(leasedDescriptors(), [], "the lease descriptor was released, not stranded open");
    assert.equal(readdirSync(revisions).filter(name => name.startsWith(".prepare-") || name.endsWith(".lease")).length, 0,
      "the failed preparation's tree and lease are cleaned, not left active");
  } finally {
    fs.fsyncSync = original;
    syncBuiltinESMExports();
    for (const fd of leasedDescriptors()) closeSync(fd);
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
  // A preparation made before leases existed: collected, and said so. Its
  // writer is this broker (never a native child), so the startup broker lock
  // proves it dead even without a lease (AV-19 in priority-0). It is still
  // accounted for — in `removed`, not `kept` — so the audit's "not invisible"
  // requirement holds.
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
  assert.ok(collection.removed.includes(unleased), "unleased residue is accounted for, not invisible");
  assert.equal(existsSync(quiescent), false);
  assert.equal(existsSync(leasePathOf(quiescent)), false);
  assert.equal(existsSync(unleased), false);
  assert.equal(existsSync(accepted), true, "an accepted revision is never collected");
  assert.equal(existsSync(join(revisions, ".prepare-not-an-oid")), true, "a name the grammar does not derive is untouched");
});

test("AV-20261003-19: an orphaned lease the grammar does not derive is reported and kept", t => {
  // The recovery contract for every other name in these directories is
  // "unprovable = reported and kept" -- but the audited loops decided *.lease
  // entries by whether they could be derived and simply fell through on the
  // ones they could not, deleting the evidence silently. Every shape below
  // fails on that code: none of them appears in `kept`.
  const stateRoot = mkdtempSync(join(tmpdir(), "oma-av19-lease-"));
  t.after(() => rmSync(stateRoot, { recursive: true, force: true }));
  const staging = join(stateRoot, "staging");
  const revisions = join(stateRoot, "world", "context", "revisions");
  mkdirSync(staging, { recursive: true });
  mkdirSync(revisions, { recursive: true });
  // A lease in staging whose tree name derives from nothing the broker makes.
  writeFileSync(join(staging, "mystery.lease"), "");
  // A lease naming an operation that IS accepted: its tree is gone, so this
  // cannot be reclaimed as a dead preparation, and it must not be invisible.
  const acceptedContext = generateOperationId();
  writeFileSync(join(staging, `context-${acceptedContext}.lease`), "");
  // An orphaned lease of no derivable shape inside the revisions directory.
  writeFileSync(join(revisions, "stray.lease"), "");
  // A derivable orphan lease still collects: only the unprovable ones change.
  const derivable = generateOperationId();
  TreeLease.take(join(revisions, `.prepare-${"f".repeat(64)}-${derivable}`)).release();
  const acceptedId = acceptedContext;
  const collection = collectUnacceptedArtifacts(stateRoot, {
    getOperationById: (id: string) => (id === acceptedId ? { id } as never : null),
  });
  const keptPaths = collection.kept.map(entry => entry.path);
  const stagingMystery = join(staging, "mystery.lease");
  const stagingAccepted = join(staging, `context-${acceptedContext}.lease`);
  const revisionStray = join(revisions, "stray.lease");
  assert.ok(keptPaths.includes(stagingMystery), `underivable staging lease reported: ${JSON.stringify(collection.kept)}`);
  assert.ok(keptPaths.includes(stagingAccepted), `accepted-operation staging lease reported: ${JSON.stringify(collection.kept)}`);
  assert.ok(keptPaths.includes(revisionStray), `underivable revisions lease reported: ${JSON.stringify(collection.kept)}`);
  assert.equal(collection.kept.find(entry => entry.path === stagingAccepted)?.reason, "its operation is accepted");
  assert.ok(collection.removed.includes(join(revisions, `.prepare-${"f".repeat(64)}-${derivable}`)),
    "a derivable orphan lease still collects");
  assert.equal(existsSync(stagingMystery), true, "reported residue is kept, not removed");
  assert.equal(existsSync(stagingAccepted), true);
  assert.equal(existsSync(revisionStray), true);
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
        kind: "agent.start", payloadJson: JSON.stringify(payload), planJson: serializePlanIntent(plan),
      });
    });
    const lifecycle = {
      reconcileAction: () => { throw new StoreError("REF_STATE_UNKNOWN", "fixture: persistent recovery unknown"); },
      reconcileSociety: () => { throw new StoreError("REF_STATE_UNKNOWN", "fixture"); },
      reconcileCreate: async () => { throw new StoreError("REF_STATE_UNKNOWN", "fixture"); },
    } as unknown as LifecycleModule;
    const units = { stop: () => undefined, confirmDead: () => true } as unknown as FeatureExecution;
    const reconcile = createReconcileModule(store, {} as MailModule, null, null, units, lifecycle, {
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

test("FJ-7: a cleanup failure while a context revision publish is already failing retains both errors", t => {
  // The audited `finally` ran removeOwnedTree + removeOwnedFile inside a bare
  // try: a failure of the owned cleanup replaced the publish error that was
  // already propagating. The lease must still be released exactly once, and
  // the convention is withCleanup's: both failures survive in an
  // AggregateError, primary first.
  const worldDir = mkdtempSync(join(tmpdir(), "oma-fj7-snap-"));
  t.after(() => rmSync(worldDir, { recursive: true, force: true }));
  const source = join(worldDir, "source");
  mkdirSync(source, { recursive: true });
  const body = Buffer.from("fixture goal\n");
  writeFileSync(join(source, "GOAL.md"), body);
  const candidate = "f".repeat(64);
  const entries = [{ path: "GOAL.md", bytes: body.length, sha256: createHash("sha256").update(body).digest("hex") }];
  const leasedDescriptors = () => readdirSync("/proc/self/fd").flatMap(name => {
    try { return (readlinkSync("/proc/self/fd/" + name)).includes(".prepare-") ? [Number(name)] : []; }
    catch { return []; }
  });
  const originalFlush = fs.fsyncSync;
  const originalOpen = fs.openSync;
  let injected = false;
  try {
    fs.fsyncSync = fd => {
      const path = readlinkSync(`/proc/self/fd/${fd}`);
      if (!injected && path.split("/").pop()!.startsWith(".prepare-") && !path.endsWith(".lease")) {
        injected = true;
        throw Object.assign(new Error("injected temporary flush failure"), { code: "EMFILE" });
      }
      originalFlush(fd);
    };
    fs.openSync = ((...args: Parameters<typeof fs.openSync>) => {
      // Refuse opening the held parent for removal of the lease. Its name
      // remains for recovery, while the lease's existing FD must still close.
      if (String(args[0]) === "/" && (new Error().stack ?? "").includes("removeOwnedFile"))
        throw Object.assign(new Error("injected lease cleanup failure"), { code: "EIO" });
      return originalOpen(...args);
    }) as typeof fs.openSync;
    syncBuiltinESMExports();
    let failure: unknown = null;
    try { publishContextRevision(worldDir, candidate, entries, source); }
    catch (error) { failure = error; }
    assert.ok(failure instanceof AggregateError, `both failures survived, got ${failure}`);
    const codes = (failure.errors as unknown[]).map(error => (error as NodeJS.ErrnoException).code);
    assert.deepEqual(codes, ["EMFILE", "EIO"], "the publish failure is first, the cleanup failure retained beside it");
    assert.deepEqual(leasedDescriptors(), [], "the lease descriptor was released exactly once");
    // The lease file the failed cleanup could not unlink reads quiescent to
    // the next collector, not active: the release ran even while both errors
    // propagated.
    const stranded = readdirSync(join(worldDir, "context", "revisions"))
      .filter(name => name.startsWith(`.prepare-${candidate}-`) && name.endsWith(".lease"));
    assert.equal(stranded.length, 1, "the failed unlink left exactly the preparation's lease");
    assert.equal(treeQuiescence(join(worldDir, "context", "revisions", stranded[0]!.slice(0, -".lease".length))).kind,
      "quiescent", "the stranded lease proves its writer is gone");
  } finally {
    fs.fsyncSync = originalFlush;
    fs.openSync = originalOpen;
    syncBuiltinESMExports();
    for (const fd of leasedDescriptors()) closeSync(fd);
  }
});
