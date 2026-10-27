import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import { serializePlanIntent } from "./fixtures/plan.js";
/** Pre-accept artifact ownership across every coordinator that freezes an
 * immutable mail object before its acceptance transaction: mail.send,
 * git.submit, agent.create and context.publish. A transaction loser, a
 * rejected request, and a plan that names no message must each leave
 * `mail/objects` holding exactly the objects the journal names.
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { createTransport } from "nodemailer";
import type { AuthContext } from "@oma/contracts";
import { Store, readDiagnosticSnapshot } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { StoreError } from "@oma/domain/errors";
import { inspectIntegrity } from "#oma-test/app/diagnostics/integrity";
import { NodeIntegrityFiles } from "#oma-test/app/diagnostics/files";
import { PreacceptArtifact, publishedArtifact } from "@oma/storage/preaccept-artifact";
import { generateOperationId } from "@oma/native/identity";
import { requestHash } from "@oma/domain/request-identity";
import { sha256Hex } from "@oma/domain/canonical-json";
import { PreparationExecutor } from "@oma/process/preparation";
import { resolvedSpecDigest } from "@oma/domain/spec-identity";
import { workspacePathAt } from "@oma/domain/paths";
import { residentUnitsFor } from "@oma/domain/derived";
import { LifecycleModule } from "@oma/lifecycle";
import { PolicyExecution } from "./fixtures/execution.js";
import { ALL_CAPS, makeValidResolvedSpec } from "./fixtures/spec.js";
import { removeTree } from "./fixtures/cleanup.js";
import { makeValidAgent } from "./fixtures/spec.js";
import { gitAuth, gitCommand, gitFixture, seedGit, submitFixture, contextFixture } from "./fixtures/git-crash.js";

function objectsOf(root: string): string[] {
  return fs.existsSync(join(root, "mail/objects")) ? fs.readdirSync(join(root, "mail/objects")).sort() : [];
}
/** Exactly the objects the accepted ledger names — nothing more, nothing less. */
function expectedObjects(root: string): string[] {
  const rows = readDiagnosticSnapshot(root).tables.operations as readonly { plan_json: string; kind: string }[];
  const named = new Set<string>();
  for (const operation of rows) {
    const plan = JSON.parse(operation.plan_json).intent as { message?: { id: string } | null; initialMessage?: { id: string } | null };
    const message = operation.kind === "agent.create" ? plan.initialMessage : plan.message;
    if (message) named.add(`${message.id}.eml`);
  }
  return [...named].sort();
}
function mailFixture() {
  const root = fs.mkdtempSync(join(tmpdir(), "oma-preaccept-"));
  const store = new Store(join(root, "runtime.sqlite"));
  store.transaction((tx) => { tx.insertAgent(makeValidAgent("alice")); tx.insertAgent(makeValidAgent("bob")); });
  const mail = createMailModule({ stateRoot: root, society: "fixture" }, store, 64, 24, { frameBytes: 262144, batchMaxMessages: 24 });
  const auth: AuthContext = { actor: "alice", incarnation: 1, role: "resident", channel: "actor",
    capabilities: new Set(["mail.send"]),
    peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } };
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
    const units = new PolicyExecution();
    const resolve = (name: string, from: string, brief: string) => makeValidResolvedSpec(name, "p", ALL_CAPS, from, brief);
    const lifecycle = createLifecycleModule(store, units,
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
          planJson: serializePlanIntent({ kind: "agent.create", spec, specHash, parent: "b",
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
    assert.throws(() => artifact.discardUnaccepted(), { code: "REF_STATE_UNKNOWN" });
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

test("DR39: preaccept pins end on acceptance, discard and a replacement refusal", () => {
  const root = fs.mkdtempSync(join(tmpdir(), "oma-preaccept-pin-"));
  const path = join(root, "artifact.eml");
  const pins = (): number => fs.readdirSync("/proc/self/fd").filter(name => {
    try { const target = fs.readlinkSync(`/proc/self/fd/${name}`); return target === path || target === `${path} (deleted)`; }
    catch { return false; }
  }).length;
  try {
    fs.writeFileSync(path, "accepted");
    const accepted = publishedArtifact(path);
    assert.equal(pins(), 1);
    accepted.retainForOperation();
    assert.equal(pins(), 0);
    accepted.discardUnaccepted();
    assert.equal(fs.readFileSync(path, "utf8"), "accepted");
    const discarded = publishedArtifact(path);
    discarded.discardUnaccepted();
    assert.equal(pins(), 0);
    assert.equal(fs.existsSync(path), false);
    fs.writeFileSync(path, "original");
    const replaced = publishedArtifact(path);
    fs.unlinkSync(path);
    fs.writeFileSync(path, "replacement");
    assert.equal(pins(), 1, "the old inode is still held and cannot be reused");
    assert.throws(() => replaced.discardUnaccepted(), { code: "REF_STATE_UNKNOWN" });
    assert.equal(pins(), 0, "a refused cleanup releases its kernel resource");
    assert.throws(() => replaced.discardUnaccepted(), { code: "REF_STATE_UNKNOWN" });
    assert.equal(fs.readFileSync(path, "utf8"), "replacement");
  } finally { removeTree(root); }
});

test("PRE-7: retained evidence cannot be discarded and unconfirmed cleanup is retryable", () => {
  const retained = new PreacceptArtifact("/nonexistent/retained.eml", null);
  retained.retainForOperation();
  retained.discardUnaccepted();
  retained.retainForOperation();
  const unavailable = new PreacceptArtifact("/nonexistent/unavailable.eml", null);
  assert.throws(() => unavailable.discardUnaccepted(), { code: "REF_STATE_UNKNOWN" });
  unavailable.retainForOperation();
  const root = fs.mkdtempSync(join(tmpdir(), "oma-preaccept-release-"));
  try {
    const path = join(root, "released.eml");
    fs.writeFileSync(path, "released");
    const released = publishedArtifact(path);
    released.discardUnaccepted();
    assert.throws(() => released.retainForOperation(), { code: "INTERNAL_ERROR" });
  } finally { removeTree(root); }
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

/** V18A: context.publish owns a staged tree and a frozen mail object before its
 * acceptance transaction. Every fallible point settles both by one decision:
 * certainly unaccepted, quiescent resources are removed; accepted or
 * undecidable ones are retained for recovery.
 */
const contextGoal = Buffer.from("# GOAL\nverify context preaccept ownership\n");
type Original = (...args: unknown[]) => unknown;
/** Wrap a member the production path calls by name, including private ones. */
function around(t: TestContext, owner: object, name: string, wrap: (original: Original, ...args: unknown[]) => unknown): void {
  const member: unknown = Reflect.get(owner, name);
  assert.equal(typeof member, "function", `${name} is not a production member`);
  const original = member as Original;
  t.mock.method(owner as Record<string, Original>, name, function (this: unknown, ...args: unknown[]) {
    return wrap((...inner: unknown[]) => original.apply(this, inner), ...args);
  });
}
function contextOnlyFixture() {
  const root = fs.mkdtempSync(join(tmpdir(), "oma-context-preaccept-"));
  const store = new Store(join(root, "runtime.sqlite"));
  store.transaction((tx) => { tx.insertAgent(makeValidAgent("a")); tx.insertAgent(makeValidAgent("b")); });
  fs.mkdirSync(join(root, "repos"));
  gitCommand(root, ["init", "--bare", "-q", "--object-format=sha1", join(root, "repos/context.git")]);
  const { git, mail, paths } = gitFixture(root, store);
  const publish = (key: string, expected: string | null = null, entrySha256 = sha256Hex(contextGoal),
    chunks: AsyncIterable<Uint8Array> = (async function* () { yield contextGoal; })()) =>
    git.publishContext(gitAuth, key, { expected, entries: [{ path: "GOAL.md", bytes: contextGoal.length, sha256: entrySha256 }],
      content: { bytes: contextGoal.length, sha256: sha256Hex(contextGoal), mediaType: "application/vnd.oma.context-v1" } }, chunks);
  return {
    root, store, git, mail, paths, publish,
    repository: (): object => Reflect.get(Reflect.get(git, "repository"), "contextRepository") as object,
    moveMain: (oid: string) => { gitCommand(root, ["--git-dir", paths.contextGit, "update-ref", "refs/heads/main", oid]); },
    close() { store.close(); removeTree(root); },
  };
}
type ContextOnlyFixture = ReturnType<typeof contextOnlyFixture>;
function contextStaging(root: string): string[] {
  const staging = join(root, "staging");
  return fs.existsSync(staging) ? fs.readdirSync(staging).filter((name) => name.startsWith("context-") && !name.endsWith(".lease")).sort() : [];
}
/** R6-04: the leases beside the staged trees. */
function contextLeases(root: string): string[] {
  const staging = join(root, "staging");
  return fs.existsSync(staging) ? fs.readdirSync(staging).filter((name) => name.startsWith("context-") && name.endsWith(".lease")).sort() : [];
}
function contextOperations(root: string): string[] {
  const rows = readDiagnosticSnapshot(root).tables.operations as readonly { id: string; kind: string }[];
  return rows.filter((row) => row.kind === "context.publish").map((row) => row.id);
}
const racingMail = { to: ["b"], kind: "message" as const, subject: "racing", body: "racing body" };

test("V18A: preaccept order is stream, staged tree, candidate, mail object, acceptance, then canonical effect", async (t) => {
  const f = contextOnlyFixture();
  try {
    const key = "context-order";
    const events: string[] = [];
    let streamed = false;
    const accepted = () => f.store.getOperation("a", key);
    around(t, f.repository(), "prepareCandidate", async (original, ...args) => {
      assert.equal(streamed, true, "the whole stream is validated before candidate preparation");
      assert.deepEqual(fs.readFileSync(join(String(args[0]), "GOAL.md")), contextGoal);
      assert.equal(accepted(), null);
      assert.deepEqual(objectsOf(f.root), []);
      const candidate = await original(...args);
      events.push("candidate");
      return candidate;
    });
    around(t, f.mail, "freezeObject", (original, ...args) => {
      assert.equal(accepted(), null);
      const artifact = original(...args);
      events.push("mail-object");
      return artifact;
    });
    around(t, f.store, "transaction", (original, ...args) => {
      const before = accepted();
      const result = original(...args);
      if (before === null && accepted() !== null) events.push("acceptance");
      return result;
    });
    around(t, Reflect.get(f.git, "repository"), "casRef", (original, ...args) => {
      assert.equal(accepted()?.state, "pending");
      assert.deepEqual(objectsOf(f.root), expectedObjects(f.root));
      events.push("canonical");
      return original(...args);
    });
    around(t, f.mail, "publishGated", (original, ...args) => { events.push("notification"); return original(...args); });
    const receipt = await f.publish(key, null, sha256Hex(contextGoal), (async function* () { yield contextGoal; streamed = true; })());
    assert.equal(receipt.state, "succeeded");
    assert.deepEqual(events, ["candidate", "mail-object", "acceptance", "canonical", "notification"]);
  } finally { f.close(); }
});

const unacceptedPoints: ReadonlyArray<{
  readonly point: string; readonly code: string; readonly expected?: string; readonly entrySha256?: string;
  readonly arrange?: (t: TestContext, f: ContextOnlyFixture, key: string) => void;
}> = [
  // Input errors keep precedence over a stale base: the stream is judged first.
  { point: "a stream digest failure after staged files exist", code: "STREAM_INVALID", expected: "0".repeat(40), entrySha256: "0".repeat(64) },
  { point: "a base conflict before candidate preparation", code: "CONTEXT_CONFLICT", expected: "0".repeat(40) },
  { point: "a candidate failure after its native preparation exited", code: "STORE_CORRUPT",
    arrange: (t, f) => around(t, f.repository(), "prepareCandidate", async (original, ...args) => {
      await original(...args);
      throw new StoreError("STORE_CORRUPT", "injected candidate observation failure");
    }) },
  { point: "a base conflict after candidate preparation", code: "CONTEXT_CONFLICT",
    arrange: (t, f) => around(t, f.repository(), "prepareCandidate", async (original, ...args) => {
      const candidate = String(await original(...args));
      f.moveMain(candidate);
      return candidate;
    }) },
  { point: "an EML construction failure", code: "INTERNAL_ERROR",
    // Controlled MIME adapter fault inside the production buildEml call.
    arrange: (t) => { t.mock.method(Object.getPrototypeOf(createTransport({ jsonTransport: true })), "sendMail", async () => {
      throw new StoreError("INTERNAL_ERROR", "injected MIME adapter failure");
    }); } },
  { point: "a mail object freeze failure", code: "STORAGE_FULL",
    arrange: (t, f) => { t.mock.method(f.mail, "freezeObject", () => {
      throw new StoreError("STORAGE_FULL", "injected mail object freeze failure");
    }); } },
  { point: "a canonical observation failure after the mail object was frozen", code: "REF_STATE_UNKNOWN",
    arrange: (t, f) => {
      let frozen = false;
      around(t, f.mail, "freezeObject", (original, ...args) => { const artifact = original(...args); frozen = true; return artifact; });
      around(t, f.repository(), "current", (original, ...args) => {
        if (frozen) throw new StoreError("REF_STATE_UNKNOWN", "injected canonical observation failure");
        return original(...args);
      });
    } },
  { point: "a base conflict after the mail object was frozen", code: "CONTEXT_CONFLICT",
    arrange: (t, f) => {
      let candidate = "";
      around(t, f.repository(), "prepareCandidate", async (original, ...args) => (candidate = String(await original(...args))));
      around(t, f.mail, "freezeObject", (original, ...args) => { const artifact = original(...args); f.moveMain(candidate); return artifact; });
    } },
  { point: "an acceptance transaction refusal", code: "REQUEST_KEY_REUSED",
    arrange: (t, f, key) => around(t, f.repository(), "prepareCandidate", async (original, ...args) => {
      const candidate = await original(...args);
      // Another method accepts this actor/key while the context request is unaccepted.
      await f.mail.send(gitAuth, key, racingMail);
      return candidate;
    }) },
];
for (const item of unacceptedPoints) {
  test(`V18A: ${item.point} removes the unaccepted staged tree and mail object`, async (t) => {
    const f = contextOnlyFixture();
    try {
      const key = "context-preaccept";
      item.arrange?.(t, f, key);
      await assert.rejects(f.publish(key, item.expected ?? null, item.entrySha256), { code: item.code });
      t.mock.restoreAll();
      assert.deepEqual(contextOperations(f.root), []);
      assert.deepEqual(contextStaging(f.root), []);
      assert.deepEqual(objectsOf(f.root), expectedObjects(f.root));
    } finally { f.close(); }
  });
}

test("V18A: a lost acceptance acknowledgement retains the accepted tree and object, and recovery uses them", async (t) => {
  const f = contextOnlyFixture();
  try {
    let frozen = false;
    around(t, f.mail, "freezeObject", (original, ...args) => { const artifact = original(...args); frozen = true; return artifact; });
    around(t, f.store, "transaction", (original, ...args) => {
      const result = original(...args);
      if (frozen) { frozen = false; throw new StoreError("INTERNAL_ERROR", "injected loss of the acceptance acknowledgement"); }
      return result;
    });
    await assert.rejects(f.publish("context-lost-ack"), { code: "INTERNAL_ERROR" });
    t.mock.restoreAll();
    const accepted = f.store.getOperation("a", "context-lost-ack");
    assert.ok(accepted?.kind === "context.publish");
    assert.equal(accepted.state, "pending");
    assert.deepEqual(contextStaging(f.root), [basename(accepted.plan.stagingPath)]);
    assert.deepEqual(fs.readFileSync(join(accepted.plan.stagingPath, "tree/GOAL.md")), contextGoal);
    assert.deepEqual(objectsOf(f.root), expectedObjects(f.root));
    await f.git.reconcile(accepted.id);
    const settled = f.store.getOperationById(accepted.id);
    assert.ok(settled?.kind === "context.publish");
    assert.equal(settled.state, "succeeded");
    assert.equal(settled.planJson, accepted.planJson);
    assert.deepEqual(fs.readFileSync(join(f.paths.worldDir, "context/revisions", accepted.plan.candidate, "GOAL.md")), contextGoal);
    const object = fs.readFileSync(f.mail.objectPath(accepted.plan.message.id));
    assert.equal(sha256Hex(object), accepted.plan.message.sha256);
    assert.deepEqual(fs.readFileSync(f.mail.archivePath(accepted.plan.message.id)), object);
  } finally { f.close(); }
});

test("V18A: an unavailable acceptance observation after refusal retains the tree and object", async (t) => {
  const f = contextOnlyFixture();
  try {
    const key = "context-unobserved";
    let refused = false;
    around(t, f.repository(), "prepareCandidate", async (original, ...args) => {
      const candidate = await original(...args);
      await f.mail.send(gitAuth, key, racingMail);
      return candidate;
    });
    around(t, f.store, "transaction", (original, ...args) => {
      try { return original(...args); } catch (error) { refused = true; throw error; }
    });
    around(t, f.store, "getOperationById", (original, ...args) => {
      if (refused) throw new StoreError("STORE_CORRUPT", "injected journal observation failure");
      return original(...args);
    });
    await assert.rejects(f.publish(key), { code: "REQUEST_KEY_REUSED" });
    t.mock.restoreAll();
    assert.deepEqual(contextOperations(f.root), []);
    assert.equal(contextStaging(f.root).length, 1, "an undecidable staged tree is retained");
    assert.deepEqual(contextLeases(f.root), contextStaging(f.root).map(name => `${name}.lease`), "with its lease, by which the next start decides (R6-04)");
    const named = expectedObjects(f.root);
    assert.equal(objectsOf(f.root).filter((name) => !named.includes(name)).length, 1, "an undecidable mail object is retained");
  } finally { f.close(); }
});

test("V18A: native preparation uncertainty retains only the tree that preparation may still use", async (t) => {
  const f = contextOnlyFixture();
  try {
    const executor: unknown = Reflect.get(f.repository(), "preparation");
    assert.ok(executor instanceof PreparationExecutor);
    const run = PreparationExecutor.prototype.run;
    t.mock.method(executor, "run", function (this: PreparationExecutor, ...[spec, signal, fds]: Parameters<PreparationExecutor["run"]>) {
      // The commit child is one whose exit the executor never observes.
      // The substitute keeps a silence window under its own ceiling: the
      // caller's 120 s window against a 100 ms timeout is a contradiction
      // the command validator refuses, not the uncertainty this proves.
      const unobserved = spec.argv.includes("commit") ? { ...spec, executable: "/usr/bin/sleep" as const, argv: ["30"], timeoutMs: 100, silenceMs: 50 } : spec;
      return run.call(this, unobserved, signal, fds);
    });
    await assert.rejects(f.publish("context-uncertain"), { code: "REF_STATE_UNKNOWN" });
    assert.equal(executor.quiescence, "unknown");
    const retained = contextStaging(f.root);
    assert.equal(retained.length, 1, "a tree a non-quiescent preparation may use is retained");
    assert.deepEqual(contextLeases(f.root), retained.map(name => `${name}.lease`), "with its lease, by which the next start decides (R6-04)");
    // The stale unknown is not a permanent poison: the blocked executor
    // verifies the leased tree is quiescent, and only that fresh observation
    // lets the next request reach its own tree -- never the attempt itself.
    t.mock.restoreAll();
    await f.publish("context-after-uncertain");
    const operations = contextOperations(f.root);
    assert.equal(operations.length, 1, "the retried request is the operation that landed");
    // Its own tree is the one the accepted plan names; the uncertain run's
    // tree stays retained beside it.
    assert.deepEqual(contextStaging(f.root), [...retained, `context-${operations[0]}`].sort());
    assert.deepEqual(contextLeases(f.root), [...retained, `context-${operations[0]}`].map(name => `${name}.lease`).sort());
  } finally { f.close(); }
});

/** V19A/V19B: create and bootstrap freeze an initial brief before acceptance.
 * Whatever fails between freezing and the acceptance transaction settles every
 * brief already frozen, and no preparation keeps running after the failure. */
type Freeze = MailModule["freezeCreateInitial"];
function lifecycleOnly(options: { seeded?: boolean } = {}) {
  const root = fs.mkdtempSync(join(tmpdir(), "oma-create-preaccept-"));
  const store = new Store(join(root, "runtime.sqlite"));
  seedGit(root);
  const info = JSON.parse(fs.readFileSync(join(root, "git-fixture.json"), "utf8")) as { base: string };
  if (options.seeded !== false) store.transaction((tx) => {
    tx.insertAgent(makeValidAgent("principal", { from: info.base }));
    for (const name of ["a", "b"]) tx.insertAgent(makeValidAgent(name, { from: info.base, createdBy: "principal" }));
  });
  const { mail, paths } = gitFixture(root, store);
  const units = new PolicyExecution();
  let failRefresh = false;
  const resolver = Object.assign((_parent: unknown, input: { name: string; from: string; brief: string }) =>
    makeValidResolvedSpec(input.name, "p", ALL_CAPS, input.from, input.brief), {
    refresh: () => { if (failRefresh) throw new StoreError("UNSUPPORTED_PROFILE", "injected host policy read failure"); },
    revision: () => "policy-1",
  });
  const lifecycle = createLifecycleModule(store, units,
    { stateRoot: root, projectGit: paths.projectGit, society: paths.society, hasGoal: () => false, activationAllowed: () => true },
    resolver, mail);
  const seed = (names: readonly string[], profile = (name: string) => name === "broken" ? "missing" : "p"): Parameters<LifecycleModule["bootstrap"]>[0] => ({
    principalProfile: "p",
    initialResidents: names.map(name => ({ name, profile: profile(name), brief: `brief for ${name}` })),
    modelProfiles: { md: { provider: "none", model: "none", inferenceTimeoutSeconds: 1 } },
    agentProfiles: { p: { modelProfile: "md", capabilities: [...ALL_CAPS], delegable: [...ALL_CAPS], childProfile: "p" } },
  });
  return { root, store, mail, units, lifecycle, info, seed, failRefresh: () => { failRefresh = true; },
    close() { store.close(); removeTree(root); } };
}
/** Counts freezes still running, so a test observes only after every started
 * preparation has ended, including one a failed caller stopped waiting for. */
function trackFreezes(t: TestContext, mail: MailModule, behaviour: (recipient: string, original: () => ReturnType<Freeze>) => ReturnType<Freeze>) {
  const original = mail.freezeCreateInitial.bind(mail);
  const started: string[] = []; let running = 0;
  t.mock.method(mail, "freezeCreateInitial", (async (auth, id, recipient, brief) => {
    started.push(recipient); running++;
    try { return await behaviour(recipient, () => original(auth, id, recipient, brief)); } finally { running--; }
  }) as Freeze);
  return {
    started,
    async drained(): Promise<void> {
      for (let waited = 0; running > 0; waited += 10) {
        assert.ok(waited < 5000, "a preparation kept running");
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    },
  };
}
const slow = (original: () => ReturnType<Freeze>) => new Promise(resolve => setTimeout(resolve, 150)).then(original);
function stagedMailObjects(root: string): string[] {
  const staging = join(root, "staging/mail-objects");
  return fs.existsSync(staging) ? fs.readdirSync(staging) : [];
}

const bootstrapFailures: ReadonlyArray<{ readonly point: string; readonly names: readonly string[]; readonly code: string;
  readonly behaviour: (recipient: string, original: () => ReturnType<Freeze>) => ReturnType<Freeze> }> = [
  { point: "one seed's brief cannot be frozen while another is still freezing", names: ["first", "second", "third"], code: "STORAGE_FULL",
    behaviour: (recipient, original) => recipient === "second" ? Promise.reject(new StoreError("STORAGE_FULL", "injected freeze failure"))
      : recipient === "third" ? slow(original) : original() },
  { point: "a seed's profile is unsupported after an earlier seed started freezing", names: ["first", "broken", "third"], code: "UNSUPPORTED_PROFILE",
    behaviour: (_recipient, original) => slow(original) },
];
for (const item of bootstrapFailures) {
  test(`V19A: when ${item.point}, bootstrap accepts nothing and leaves no brief behind`, async (t) => {
    const f = lifecycleOnly({ seeded: false });
    try {
      const freezes = trackFreezes(t, f.mail, item.behaviour);
      await assert.rejects(f.lifecycle.bootstrap(f.seed(item.names)), { code: item.code });
      await freezes.drained();
      assert.deepEqual(f.store.listAgents(), []);
      assert.deepEqual(readDiagnosticSnapshot(f.root).tables.operations, []);
      assert.deepEqual(objectsOf(f.root), []);
      assert.deepEqual(stagedMailObjects(f.root), []);
    } finally { f.close(); }
  });
}

test("V19A: a registry that changes during preparation refuses the whole seed set and settles every brief", async (t) => {
  const f = lifecycleOnly({ seeded: false });
  try {
    trackFreezes(t, f.mail, (recipient, original) => {
      if (recipient === "third") f.store.transaction((tx) => tx.insertAgent(makeValidAgent("intruder", { from: f.info.base })));
      return original();
    });
    await assert.rejects(f.lifecycle.bootstrap(f.seed(["first", "second", "third"])), { code: "AGENT_CONFLICT" });
    assert.deepEqual(f.store.listAgents().map(agent => agent.name), ["intruder"]);
    assert.deepEqual(readDiagnosticSnapshot(f.root).tables.operations, []);
    assert.deepEqual(objectsOf(f.root), []);
  } finally { f.close(); }
});

test("V19A: an accepted seed set retains exactly the briefs its plans name", async (t) => {
  const f = lifecycleOnly({ seeded: false });
  try {
    const freezes = trackFreezes(t, f.mail, (_recipient, original) => original());
    await f.lifecycle.bootstrap(f.seed(["first", "second", "third"]));
    assert.deepEqual(freezes.started, ["first", "second", "third"]);
    assert.deepEqual(f.store.listAgents().map(agent => agent.name).sort(), ["first", "principal", "second", "third"]);
    assert.equal(objectsOf(f.root).length, 3);
    assert.deepEqual(objectsOf(f.root), expectedObjects(f.root));
  } finally { f.close(); }
});

test("V19B: a policy refresh that fails after the brief was frozen removes that brief", async (t) => {
  const f = lifecycleOnly();
  try {
    trackFreezes(t, f.mail, async (_recipient, original) => { const frozen = await original(); f.failRefresh(); return frozen; });
    await assert.rejects(f.lifecycle.create(gitAuth, { name: "child", from: f.info.base, brief: "brief" }, "refresh-fails"),
      { code: "UNSUPPORTED_PROFILE" });
    assert.equal(f.store.getOperation("a", "refresh-fails"), null);
    assert.equal(f.store.getAgent("child"), null);
    assert.deepEqual(objectsOf(f.root), []);
  } finally { f.close(); }
});

test("V19B: a same-name, same-spec race has one physical winner and the linked loser owns no brief", async (t) => {
  const f = lifecycleOnly();
  try {
    t.mock.method(f.units, "ensureResident", () => undefined);
    const input = { name: "shared", from: f.info.base, brief: "one brief" };
    const bob: AuthContext = { ...gitAuth, actor: "b" };
    const settled = await Promise.allSettled([f.lifecycle.create(gitAuth, input, "race-a"), f.lifecycle.create(bob, input, "race-b")]);
    assert.ok(settled.every(result => result.status === "fulfilled"), JSON.stringify(settled));
    const operations = [f.store.getOperation("a", "race-a"), f.store.getOperation("b", "race-b")];
    assert.ok(operations.every(operation => operation?.kind === "agent.create"));
    const plans = operations.map(operation => operation!.kind === "agent.create" ? operation!.plan : null);
    const physical = plans.filter(plan => plan?.existingCreation === null);
    const linked = plans.filter(plan => plan?.existingCreation !== null);
    assert.equal(physical.length, 1);
    assert.equal(linked.length, 1);
    assert.equal(linked[0]!.initialMessage, null);
    assert.equal(f.store.listAgents().filter(agent => agent.name === "shared").length, 1);
    assert.deepEqual(objectsOf(f.root), expectedObjects(f.root));
    assert.equal(objectsOf(f.root).length, 1);
    assert.equal(readDiagnosticSnapshot(f.root).tables.deliveries.filter((row) => (row as { recipient: string }).recipient === "shared").length, 1);
  } finally { f.close(); }
});
