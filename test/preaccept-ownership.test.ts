/** Pre-accept artifact ownership across every coordinator that freezes an
 * immutable mail object before its acceptance transaction: mail.send,
 * git.submit, agent.create and context.publish. A transaction loser, a
 * rejected request, and a plan that names no message must each leave
 * `mail/objects` holding exactly the objects the journal names.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AuthContext } from "../implementation/contracts.js";
import { Store, readDiagnosticSnapshot } from "../src/store.js";
import { MailModule } from "../src/mail.js";
import { StoreError } from "../src/domain/errors.js";
import { inspectIntegrity } from "../src/diagnostics/integrity.js";
import { NodeIntegrityFiles } from "../src/diagnostics/files.js";
import { PreacceptArtifact, publishedArtifact, settleByAcceptance } from "../src/storage/preaccept-artifact.js";
import { generateOperationId } from "../src/ids.js";
import { requestHash } from "../src/hash.js";
import { resolvedSpecDigest } from "../src/domain/spec-identity.js";
import { workspacePathAt } from "../src/storage/paths.js";
import { residentUnitsFor } from "../src/domain/derived.js";
import { LifecycleModule } from "../src/lifecycle.js";
import { UnitsModule } from "../src/units.js";
import { ALL_CAPS, makeValidResolvedSpec } from "./fixtures/spec.js";
import { removeTree } from "./fixtures/cleanup.js";
import { makeValidAgent } from "./fixtures/spec.js";
import { gitAuth, gitFixture, seedGit, submitFixture, contextFixture } from "./fixtures/git-crash.js";

function objectsOf(root: string): string[] {
  return fs.existsSync(join(root, "mail/objects")) ? fs.readdirSync(join(root, "mail/objects")).sort() : [];
}
/** Exactly the objects the accepted ledger names — nothing more, nothing less. */
function expectedObjects(root: string): string[] {
  const rows = readDiagnosticSnapshot(root).tables.operations as readonly { plan_json: string; kind: string }[];
  const named = new Set<string>();
  for (const operation of rows) {
    const plan = JSON.parse(operation.plan_json) as { message?: { id: string } | null; initialMessage?: { id: string } | null };
    const message = operation.kind === "agent.create" ? plan.initialMessage : plan.message;
    if (message) named.add(`${message.id}.eml`);
  }
  return [...named].sort();
}
function mailFixture() {
  const root = fs.mkdtempSync(join(tmpdir(), "oma-preaccept-"));
  const store = new Store(join(root, "runtime.sqlite"));
  store.transaction((tx) => { tx.insertAgent(makeValidAgent("alice")); tx.insertAgent(makeValidAgent("bob")); });
  const mail = new MailModule({ stateRoot: root, society: "fixture" }, store, 64, 24, { frameBytes: 262144, batchMaxMessages: 24 });
  const auth: AuthContext = { actor: "alice", incarnation: 1, role: "resident", channel: "actor",
    capabilities: new Set(["mail.send"]),
    peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), cgroup: null } };
  const input = { to: ["bob"], kind: "message" as const, subject: "fixture", body: "ordinary test message" };
  return { root, store, mail, auth, input, close() { store.close(); removeTree(root); } };
}
function inspect(root: string) {
  return inspectIntegrity(readDiagnosticSnapshot(root), { stateRoot: root, society: "fixture" }, { files: new NodeIntegrityFiles() });
}

test("PRE-1: concurrent same-key sends leave mail/objects holding exactly the accepted object", async () => {
  const f = mailFixture();
  try {
    const settled = await Promise.allSettled([
      f.mail.send(f.auth, "same", f.input),
      f.mail.send(f.auth, "same", f.input),
    ]);
    assert.ok(settled.every((result) => result.status === "fulfilled"), JSON.stringify(settled));
    // One operation wins the key; the loser returns the winner's receipt.
    const accepted = expectedObjects(f.root);
    assert.equal(accepted.length, 1);
    assert.deepEqual(objectsOf(f.root), accepted);
    assert.deepEqual(fs.readdirSync(join(f.root, "staging/mail-objects")), []);
  } finally { f.close(); }
});

test("PRE-2: a different method racing the same actor/key owns no object after its rejection", async () => {
  const f = mailFixture();
  try {
    // Both callers pass the pre-transaction key check while no row exists, so
    // both freeze an object; the loser is refused inside T by a payload hash it
    // could not have seen. Its object was never named by anything.
    const settled = await Promise.allSettled([
      f.mail.send(f.auth, "shared", f.input),
      f.mail.send(f.auth, "shared", f.input, { kind: "agent.continue", params: { note: "different payload" } }),
    ]);
    const rejected = settled.filter((result) => result.status === "rejected");
    assert.equal(rejected.length, 1, JSON.stringify(settled));
    assert.equal((rejected[0] as PromiseRejectedResult).reason.code, "REQUEST_KEY_REUSED");
    const accepted = expectedObjects(f.root);
    assert.equal(accepted.length, 1);
    assert.deepEqual(objectsOf(f.root), accepted);
    assert.equal(inspect(f.root).status, "PASS");
  } finally { f.close(); }
});

test("PRE-3: a transaction failure injected immediately after freeze removes exactly the frozen object", async (t) => {
  const f = mailFixture();
  try {
    await f.mail.send(f.auth, "kept", f.input);
    const kept = objectsOf(f.root);
    assert.equal(kept.length, 1);
    const real = f.store.transaction.bind(f.store);
    let armed = true;
    const mock = t.mock.method(f.store, "transaction", ((work: Parameters<Store["transaction"]>[0]) => {
      if (!armed) return real(work);
      armed = false;
      throw new StoreError("BROKER_UNAVAILABLE", "injected acceptance failure");
    }) as Store["transaction"]);
    await assert.rejects(f.mail.send(f.auth, "injected", f.input), { code: "BROKER_UNAVAILABLE" });
    mock.mock.restore();
    assert.deepEqual(objectsOf(f.root), kept);
    assert.equal(f.store.getOperation("alice", "injected"), null);
    assert.deepEqual(objectsOf(f.root), expectedObjects(f.root));
  } finally { f.close(); }
});

test("PRE-4: after those failures the integrity inspection reports no UNKNOWN", async (t) => {
  const f = mailFixture();
  try {
    await f.mail.send(f.auth, "ok", f.input);
    await Promise.allSettled([f.mail.send(f.auth, "race", f.input), f.mail.send(f.auth, "race", f.input)]);
    await assert.rejects(
      f.mail.send(f.auth, "ok", f.input, { kind: "agent.continue", params: { note: "different payload" } }),
      { code: "REQUEST_KEY_REUSED" },
    );
    const real = f.store.transaction.bind(f.store);
    let armed = true;
    const mock = t.mock.method(f.store, "transaction", ((work: Parameters<Store["transaction"]>[0]) => {
      if (!armed) return real(work);
      armed = false;
      throw new StoreError("BROKER_UNAVAILABLE", "injected acceptance failure");
    }) as Store["transaction"]);
    await assert.rejects(f.mail.send(f.auth, "injected", f.input), { code: "BROKER_UNAVAILABLE" });
    mock.mock.restore();
    const report = inspect(f.root);
    assert.deepEqual(
      report.issues.filter((issue) => issue.code === "OBJECT_DIRECTORY_UNOWNED"),
      [],
      JSON.stringify(report.issues),
    );
    assert.equal(report.status, "PASS", JSON.stringify(report.issues));
    assert.deepEqual(objectsOf(f.root), expectedObjects(f.root));
  } finally { f.close(); }
});

test("PRE-5: an accepted linked create names no initial brief, so it owns none on disk", async () => {
  const root = fs.mkdtempSync(join(tmpdir(), "oma-preaccept-create-"));
  const store = new Store(join(root, "runtime.sqlite"));
  try {
    seedGit(root);
    const info = JSON.parse(fs.readFileSync(join(root, "git-fixture.json"), "utf8")) as { base: string };
    store.transaction((tx) => {
      tx.insertAgent(makeValidAgent("principal", { from: info.base }));
      for (const name of ["a", "b"]) tx.insertAgent(makeValidAgent(name, { from: info.base, createdBy: "principal" }));
    });
    const { mail, paths } = gitFixture(root, store);
    const units = new UnitsModule(paths.society, { node: process.execPath, libdir: process.cwd(), state: root, society: paths.society, agent: "" });
    const resolve = (name: string, from: string, brief: string) => makeValidResolvedSpec(name, "p", ALL_CAPS, from, brief);
    const lifecycle = new LifecycleModule(store, units,
      { stateRoot: root, projectGit: paths.projectGit, society: paths.society, hasGoal: () => false, activationAllowed: () => true },
      (_parent, input) => resolve(input.name, input.from, input.brief), mail);
    const auth = { ...gitAuth, capabilities: new Set(ALL_CAPS) };
    const spec = resolve("child", info.base, "brief");
    const specHash = resolvedSpecDigest(spec);
    // The winner of the name is only visible after our brief has been frozen,
    // so acceptance turns this create into a linked plan that names no message.
    const originalId = generateOperationId();
    const original = await mail.freezeCreateInitial(auth, originalId, "child", "brief");
    original.artifact.retainForOperation();
    const freeze = mail.freezeCreateInitial.bind(mail);
    mail.freezeCreateInitial = async (a, id, recipient, brief) => {
      const frozen = await freeze(a, id, recipient, brief);
      mail.freezeCreateInitial = freeze;
      store.transaction((tx) => {
        tx.insertAgent({ name: "child", specHash, role: "resident", desired: "provisioning", incarnation: 0,
          profile: spec.profile, createdBy: "b", specJson: JSON.stringify(spec) });
        tx.acceptOperation({ id: originalId, actor: "b", requestKey: "original-create", requestHash: requestHash("agent.create", { name: "child", from: info.base, brief: "brief" }),
          kind: "agent.create", payloadJson: JSON.stringify({ name: "child", from: info.base, brief: "brief" }),
          planJson: JSON.stringify({ kind: "agent.create", spec, specHash, parent: "b",
            workspacePath: workspacePathAt(root, "child"), unitNames: residentUnitsFor(paths.society, "child"), initialMessage: original.message, existingCreation: null }) });
        tx.insertDeliveries([{ messageId: original.message.id, recipient: "child", operationId: originalId }]);
      });
      return frozen;
    };
    const before = objectsOf(root);
    assert.deepEqual(before, [`${original.message.id}.eml`]);
    const receipt = await lifecycle.create(auth, { name: "child", from: info.base, brief: "brief" }, "linked-create");
    assert.ok(receipt);
    const linked = store.getOperation("a", "linked-create")!;
    assert.equal(linked.kind, "agent.create");
    assert.equal(linked.plan.initialMessage, null);
    assert.equal(linked.plan.existingCreation, originalId);
    // The brief this call froze is named by nothing; exactly it was removed.
    assert.deepEqual(objectsOf(root), before);
    assert.deepEqual(objectsOf(root), expectedObjects(root));
  } finally { store.close(); removeTree(root); }
});

test("PRE-6: discard removes only the inode it published, and never a replacement", async () => {
  const root = fs.mkdtempSync(join(tmpdir(), "oma-preaccept-inode-"));
  try {
    const directory = join(root, "objects");
    fs.mkdirSync(directory);
    const path = join(directory, "artifact.eml");
    fs.writeFileSync(path, "first");
    const artifact = publishedArtifact(path);
    // Someone replaced the name with a different inode: it is not ours to remove.
    fs.unlinkSync(path);
    fs.writeFileSync(path, "second");
    artifact.discardUnaccepted();
    assert.equal(fs.readFileSync(path, "utf8"), "second");
    // Our own inode is removed exactly once, and a second settle is inert.
    const mine = publishedArtifact(path);
    mine.discardUnaccepted();
    assert.equal(fs.existsSync(path), false);
    fs.writeFileSync(path, "third");
    mine.discardUnaccepted();
    assert.equal(fs.readFileSync(path, "utf8"), "third");
    // An artifact that was never published owns nothing.
    const absent = publishedArtifact(join(directory, "never.eml"));
    absent.discardUnaccepted();
    assert.equal(fs.readdirSync(directory).sort().join(","), "artifact.eml");
  } finally { removeTree(root); }
});

test("PRE-7: retained evidence can never be discarded, and released evidence can never be retained", () => {
  const retained = new PreacceptArtifact("/nonexistent/retained.eml", null);
  retained.retainForOperation();
  retained.discardUnaccepted();
  retained.retainForOperation();
  const released = new PreacceptArtifact("/nonexistent/released.eml", null);
  released.discardUnaccepted();
  assert.throws(() => released.retainForOperation(), { code: "INTERNAL_ERROR" });
});

test("PRE-8: a losing git.submit and a conflicting context.publish leave the object directory exact", async (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), "oma-preaccept-git-"));
  const store = new Store(join(root, "runtime.sqlite"));
  try {
    store.transaction((tx) => { tx.insertAgent(makeValidAgent("a")); tx.insertAgent(makeValidAgent("b")); });
    seedGit(root);
    const { git, mail } = gitFixture(root, store);
    await submitFixture(root, git, "submit-one");
    const afterSubmit = objectsOf(root);
    assert.equal(afterSubmit.length, 1);
    // The same actor/key with a different payload freezes, then is refused in T.
    await assert.rejects(submitFixture(root, git, "submit-one".replace("one", "one")).then(() =>
      git.submit(gitAuth, "submit-one", { candidate: "0".repeat(40), exportRef: "refs/oma/export/crash",
        prerequisites: [], to: ["b"], subject: "other", body: "other", paths: [] }, (async function* () {})())));
    assert.deepEqual(objectsOf(root), afterSubmit);
    await contextFixture(git);
    const afterContext = objectsOf(root);
    assert.equal(afterContext.length, 2);
    // A base that moved under the publisher rejects after the object was frozen.
    await assert.rejects(
      git.publishContext(gitAuth, "context-conflict", { expected: "0".repeat(40),
        entries: [{ path: "GOAL.md", bytes: 4, sha256: "b5bb9d8014a0f9b1d61e21e796d78dccdf1352f23cd32812f4850b878ae4944c" }],
        content: { bytes: 4, sha256: "b5bb9d8014a0f9b1d61e21e796d78dccdf1352f23cd32812f4850b878ae4944c", mediaType: "application/vnd.oma.context-v1" } },
        (async function* () { yield Buffer.from("test"); })()),
    );
    assert.deepEqual(objectsOf(root), afterContext);
    // A genuine cross-method race: git.submit and mail.send reach the same
    // actor/key with different payload hashes, so exactly one is refused in T.
    const raced = await Promise.allSettled([
      submitFixture(root, git, "cross-method"),
      mail.send(gitAuth, "cross-method", { to: ["b"], kind: "message", subject: "racing", body: "racing body" }),
    ]);
    assert.equal(raced.filter((result) => result.status === "rejected").length, 1, JSON.stringify(raced));
    assert.deepEqual(objectsOf(root), expectedObjects(root));
    void t;
  } finally { store.close(); removeTree(root); }
});
