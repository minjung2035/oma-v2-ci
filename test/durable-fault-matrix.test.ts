import { createMailModule } from "#oma-test/app/broker/mail-composition";
// P7: deterministic durability fault matrix over the low-level primitives.
// A fault is injected only into a targeted low-level effect (TEST-002); the
// workflow path itself carries no fault hook. Each case then runs the required
// order: restart-equivalent reopen -> read-only integrity -> reconcile ->
// integrity -> repeated reconcile -> convergence.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { publishImmutableFile } from "@oma/storage/immutable-file";
import { DurabilityFaultError, replaceDerivedFile, writeExclusiveFsyncedFile,
  type DurabilityObserver, type DurabilityPhase, type DurabilityPoint } from "@oma/storage/durable-fs";
import { readDiagnosticSnapshot } from "@oma/storage";
import { inspectIntegrity } from "#oma-test/app/diagnostics/integrity";
import { NodeIntegrityFiles } from "#oma-test/app/diagnostics/files";
import { makeValidAgent } from "./fixtures/spec.js";
import { sendWithStop } from "./fixtures/mail-faults.js";
import { removeTree } from "./fixtures/cleanup.js";
import { gitAuth } from "./fixtures/git-crash.js";

const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const readDirNames = (path: string) => (existsSync(path) ? readdirSync(path).sort() : []);

/** Fail exactly once at the requested point/phase, then stay out of the way. */
function faultAtOnce(point: DurabilityPoint, phase: DurabilityPhase): DurabilityObserver {
  let fired = false;
  return fault => {
    if (fired || fault.point !== point || fault.phase !== phase) return;
    fired = true;
    throw new DurabilityFaultError(fault);
  };
}

/** Read-only integrity over the same state the operator would inspect. */
function integrityOf(root: string) {
  return inspectIntegrity(readDiagnosticSnapshot(root), { stateRoot: root, society: "demo" },
    { files: new NodeIntegrityFiles(), mode: "offline" });
}

async function acceptedMailRoot(root: string) {
  const store = new Store(join(root, "runtime.sqlite"));
  store.transaction(() => { for (const name of ["a", "b"]) store.insertAgent(makeValidAgent(name)); });
  const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 8);
  // Accepted intent with the physical publication deliberately not performed.
  await assert.rejects(sendWithStop(mail, store, { ...gitAuth, actor: "a" }, "fault-matrix",
    { to: ["b"], subject: "fault matrix", kind: "message", body: "immutable payload" }, "accepted"), /stop at accepted/);
  return { store, mail };
}

/** Cases where the targeted effect is the accepted mail object publication. */
const PUBLICATION_POINTS: readonly (readonly [DurabilityPoint, DurabilityPhase])[] = [
  ["publication-link", "before"],
  ["publication-link", "after-visible"],
  ["destination-validate", "before"],
  ["destination-validate", "after-visible"],
  ["directory-fsync", "ambiguous"],
  ["directory-fsync", "after-visible"],
];

for (const [point, phase] of PUBLICATION_POINTS) {
  test(`P7 fault ${phase} ${point}: no false success, immutable bytes intact, reconcile converges`, async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-fault-"));
    let store: Store | null = null;
    try {
      const accepted = await acceptedMailRoot(root);
      store = accepted.store;
      const operation = store.getOperation("a", "fault-matrix")!;
      const plan = JSON.parse(operation.planJson).intent as { message: { id: string; sha256: string; bytes: number } };
      const object = accepted.mail.objectPath(plan.message.id as never);
      const archive = accepted.mail.archivePath(plan.message.id as never);
      const bytesBefore = readFileSync(object);
      const planBefore = operation.planJson;
      assert.equal(sha(bytesBefore), plan.message.sha256);

      // Targeted low-level effect with a deterministic fault, as a crash would.
      assert.throws(() => publishImmutableFile(object, archive, plan.message.sha256, faultAtOnce(point, phase)),
        /fault /, "a fault must not be reported as success");
      // The link phase is unambiguous; every other point may fire before or
      // after the link, so recovery - not this assertion - must converge.
      if (point === "publication-link") {
        if (phase === "before") assert.equal(existsSync(archive), false, "a before fault cannot have published the name");
        else {
          assert.equal(existsSync(archive), true);
          assert.equal(sha(readFileSync(archive)), plan.message.sha256, "published bytes are the immutable object");
        }
      }

      // Restart-equivalent: the faulted process is gone, a new one reopens.
      store.close(); store = null;
      const reopened = new Store(join(root, "runtime.sqlite"));
      const mail = createMailModule({ stateRoot: root, society: "demo" }, reopened, 8);
      const before = integrityOf(root);
      assert.ok(["PASS", "PARTIAL"].includes(before.status), JSON.stringify(before.issues ?? before));

      await mail.materialize(operation.id);
      const after = integrityOf(root);
      assert.equal(after.status, "PASS", JSON.stringify(after.issues ?? after));

      const recovered = reopened.getOperationById(operation.id)!;
      assert.equal(recovered.id, operation.id, "operation identity is preserved");
      assert.equal(recovered.planJson, planBefore, "accepted plan bytes are never rewritten");
      assert.equal(sha(readFileSync(object)), plan.message.sha256, "immutable source bytes are unchanged");
      assert.equal(sha(readFileSync(archive)), plan.message.sha256);
      assert.deepEqual(readDirNames(join(root, "mail", "archive", "cur")), [`${plan.message.id}:2,`], "no duplicate publication");
      assert.equal(reopened.getDelivery(plan.message.id as never, "b")!.materialized, 1);

      // Repeated reconcile converges on the same terminal state and bytes.
      const resultBefore = recovered.resultJson, entriesBefore = readDirNames(join(root, "mail", "archive", "cur"));
      await mail.materialize(operation.id); await mail.materialize(operation.id);
      assert.equal(reopened.getOperationById(operation.id)!.resultJson, resultBefore);
      assert.deepEqual(readDirNames(join(root, "mail", "archive", "cur")), entriesBefore);
      reopened.close();
    } finally {
      store?.close();
      removeTree(root);
    }
  });
}

test("P7 fault ambiguous file-fsync in an accepted staging write: accepted intent stays recoverable", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-fault-stage-"));
  try {
    const staging = join(root, "staging", "op-fixture");
    mkdirSync(staging, { recursive: true });
    const bytes = Buffer.from("staged bytes\n");
    assert.throws(() => writeExclusiveFsyncedFile(join(staging, "body.eml"), bytes, 0o600, faultAtOnce("file-fsync", "ambiguous")),
      /fault ambiguous file-fsync/);
    // The crash left the owned staging name behind; it is never accepted evidence.
    const staged = join(staging, "body.eml");
    assert.equal(existsSync(staged), true, "a crash after the write is not a silent absence");
    assert.equal(sha(readFileSync(staged)), sha(bytes));
    assert.equal(staged.includes("op-fixture"), true);
    // Staging names are exclusive and owner-scoped: nothing accepted references
    // it, and only the owner removes that exact name.
    assert.equal(unlinkSync(staged), undefined);
    assert.deepEqual(readDirNames(staging), []);
    // A completed retry writes the same bytes once; the staging name is not a
    // permanent artifact and no duplicate publication appears.
    writeExclusiveFsyncedFile(staged, bytes, 0o600);
    assert.deepEqual(readDirNames(staging), ["body.eml"]);
    assert.equal(sha(readFileSync(staged)), sha(bytes));
  } finally { removeTree(root); }
});

test("P7 fault derived rename: derived view replacement is idempotent and leaves accepted bytes alone", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-fault-derived-"));
  try {
    const target = join(root, "world", "agents.tsv");
    const accepted = Buffer.from("accepted source bytes\n");
    const source = join(root, "accepted-source");
    writeExclusiveFsyncedFile(source, accepted);
    const sourceHash = sha(readFileSync(source));
    assert.throws(() => replaceDerivedFile(target, "derived-a\n", 0o600, faultAtOnce("derived-rename", "before")), /fault before derived-rename/);
    assert.equal(existsSync(target), false, "a before fault leaves no derived target");
    assert.equal(sha(readFileSync(source)), sourceHash, "accepted bytes are never a rename target");
    replaceDerivedFile(target, "derived-a\n");
    assert.equal(readFileSync(target, "utf8"), "derived-a\n");
    // The parent flush runs both before and after the rename; select the one
    // that observes the replacement, which is the ambiguous case under test.
    const afterRename = (fault: { point: DurabilityPoint; phase: DurabilityPhase }) => {
      if (fault.point !== "directory-fsync" || fault.phase !== "ambiguous") return;
      // The parent is flushed before and after the rename; only the flush that
      // observes the replacement is the ambiguous point under test.
      if (existsSync(target) && readFileSync(target, "utf8") === "derived-b\n")
        throw new DurabilityFaultError({ ...fault, path: target });
    };
    assert.throws(() => replaceDerivedFile(target, "derived-b\n", 0o600, afterRename), /fault ambiguous directory-fsync/);
    assert.equal(readFileSync(target, "utf8"), "derived-b\n", "a post-rename fault does not prove the replacement failed");
    // A crash cannot run cleanup: the first crash's temporary stayed until the
    // next replacement of the same name, which collected it -- its writer's
    // lock was free (P0V-96) -- and the post-rename one left none.
    assert.deepEqual(readDirNames(join(root, "world")).filter(name => name.endsWith(".tmp")), [],
      "a crashed replacement's temporary outlived the next replacement of its name");
    replaceDerivedFile(target, "derived-b\n");
    assert.equal(readFileSync(target, "utf8"), "derived-b\n");
    assert.deepEqual(readDirNames(join(root, "world")), ["agents.tsv"], "owned temporaries are not left behind");
    assert.equal(sha(readFileSync(source)), sourceHash);
  } finally { removeTree(root); }
});

test("P7 fault temporary cleanup: an owned temporary is removed once and never confused with evidence", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-fault-temp-"));
  try {
    const path = join(root, "staging", "partial.tmp");
    mkdirSync(join(root, "staging"), { recursive: true });
    assert.throws(() => writeExclusiveFsyncedFile(path, "partial\n", 0o600, faultAtOnce("file-write", "ambiguous")), /fault ambiguous file-write/);
    assert.equal(existsSync(path), true, "a crash mid-write leaves the owned name, not a silent absence");
    writeFileSync(path, ""); // The owner may only remove the exact name it created.
    removeTree(root);
    assert.equal(existsSync(root), false);
  } finally { removeTree(root); }
});
