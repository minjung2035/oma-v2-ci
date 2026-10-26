import { createMailModule } from "#oma-test/app/broker/mail-composition";
/** V20A/V20B: mail and submit own what they freeze before acceptance, and
 * accepted mail keeps its authoritative object while only derived views are
 * rebuilt. Real Store, MailModule, GitModule and filesystem throughout.
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AuthContext, MailInput } from "@oma/contracts";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { StoreError } from "@oma/domain/errors";
import { sha256Hex } from "@oma/domain/canonical-json";
import { makeValidAgent } from "./fixtures/spec.js";
import { removeTree } from "./fixtures/cleanup.js";
import { gitAuth, gitFixture, seedGit, submitFixture } from "./fixtures/git-crash.js";

const fs = createRequire(import.meta.url)("node:fs") as typeof import("node:fs");
const native = { fsync: fs.fsyncSync, unlink: fs.unlinkSync, open: fs.openSync };
const eio = () => Object.assign(new Error("injected filesystem failure"), { code: "EIO" });
/** Patch a live builtin export for the production module and restore it. */
async function patched<T>(t: TestContext, patch: () => void, action: () => Promise<T>): Promise<T> {
  patch(); syncBuiltinESMExports();
  try { return await action(); } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
}
function mailFixture() {
  const root = fs.mkdtempSync(join(tmpdir(), "oma-mail-scope-"));
  const store = new Store(join(root, "runtime.sqlite"));
  store.transaction((tx) => { for (const name of ["alice", "bob", "carol"]) tx.insertAgent(makeValidAgent(name)); });
  const mail = createMailModule({ stateRoot: root, society: "fixture" }, store, 64);
  const auth: AuthContext = { actor: "alice", incarnation: 1, role: "resident", channel: "actor",
    capabilities: new Set(["mail.send"]), peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } };
  const input: MailInput = { to: ["topic/work"], kind: "message", subject: "frozen", body: "frozen body" };
  return {
    root, store, mail, auth, input,
    objects: () => fs.existsSync(join(root, "mail/objects")) ? fs.readdirSync(join(root, "mail/objects")).sort() : [],
    staged: () => fs.existsSync(join(root, "staging/mail-objects")) ? fs.readdirSync(join(root, "staging/mail-objects")) : [],
    close() { store.close(); removeTree(root); },
  };
}
type MailFixture = ReturnType<typeof mailFixture>;
/** An accepted send whose first materialization was lost: pending, with the
 * authoritative object and no derived archive or inbox link yet. */
async function pendingSend(t: TestContext, f: MailFixture, key = "pending") {
  const lost = t.mock.method(f.mail, "materialize", async () => { throw new StoreError("BROKER_UNAVAILABLE", "injected loss before materialization"); });
  const receipt = await f.mail.send(f.auth, key, f.input);
  lost.mock.restore();
  assert.equal(receipt.state, "pending");
  const operation = f.store.getOperation("alice", key);
  assert.ok(operation?.kind === "mail.send");
  return operation;
}

test("V20A: a mail object whose publication fails after its link is removed before any acceptance", async (t) => {
  const f = mailFixture();
  try {
    f.store.transaction((tx) => tx.follow("work", "bob"));
    await patched(t, () => {
      t.mock.method(fs, "fsyncSync", (fd: number) => {
        if (fs.readlinkSync(`/proc/self/fd/${fd}`).includes("/mail/objects/")) throw eio();
        native.fsync(fd);
      });
    }, () => assert.rejects(f.mail.send(f.auth, "flush-fails", f.input), (error: unknown) => (error as { code?: string }).code === "EIO"));
    assert.equal(f.store.getOperation("alice", "flush-fails"), null);
    assert.deepEqual(f.objects(), []);
    assert.deepEqual(f.staged(), []);
  } finally { f.close(); }
});

test("V20A: a refused mail acceptance whose cleanup also fails reports the refusal first and keeps the object", async (t) => {
  const f = mailFixture();
  try {
    f.store.transaction((tx) => tx.follow("work", "bob"));
    const real = f.store.transaction.bind(f.store);
    let refused = false;
    let cleanupFaults = 0;
    const failure = await patched(t, () => {
      t.mock.method(f.store, "transaction", ((work: Parameters<Store["transaction"]>[0]) => {
        if (refused) return real(work);
        refused = true;
        throw new StoreError("BROKER_UNAVAILABLE", "injected acceptance refusal");
      }) as Store["transaction"]);
      t.mock.method(fs, "openSync", ((...args: Parameters<typeof native.open>) => {
        const path = String(args[0]);
        // Refuse the exact-inode reopen in owned cleanup, before unlinkat.
        // Publication and the acceptance refusal still run their real paths.
        if (/^\/proc\/self\/fd\/\d+$/.test(path) &&
            (new Error().stack ?? "").includes("removeOwnedInode") && fs.readlinkSync(path).endsWith(".eml")) {
          cleanupFaults++; throw eio();
        }
        return native.open(...args);
      }) as typeof fs.openSync);
    }, () => f.mail.send(f.auth, "refused", f.input).then(() => null, (error: unknown) => error));
    assert.ok(failure instanceof AggregateError, String(failure));
    assert.ok(cleanupFaults > 0, "the actual cleanup reopen must be faulted");
    assert.equal((failure.errors[0] as { code?: string }).code, "BROKER_UNAVAILABLE", "the refusal stays the first error");
    assert.ok(failure.errors.some((error: unknown) => (error as { code?: string }).code === "EIO"));
    assert.equal(f.store.getOperation("alice", "refused"), null);
    assert.equal(f.objects().length, 1, "a cleanup that failed leaves the object for repair, never reports it removed");
  } finally { f.close(); }
});

test("V20A: a same-key retry after acceptance returns the frozen message; recovery delivers the frozen recipients", async (t) => {
  const f = mailFixture();
  try {
    f.store.transaction((tx) => tx.follow("work", "bob"));
    const operation = await pendingSend(t, f);
    const object = fs.readFileSync(f.mail.objectPath(operation.plan.message.id));
    // Membership changes after acceptance: the accepted snapshot does not.
    f.store.transaction((tx) => tx.follow("work", "carol"));
    const retried = await f.mail.send(f.auth, "pending", f.input);
    assert.equal(retried.operation, operation.id);
    assert.deepEqual(f.objects(), [`${operation.plan.message.id}.eml`]);
    assert.deepEqual(await f.mail.reconcilePending(), { examined: 1, repaired: 1, remaining: 0 });
    const settled = f.store.getOperationById(operation.id);
    assert.equal(settled?.state, "succeeded");
    assert.equal(settled?.planJson, operation.planJson);
    assert.deepEqual(operation.plan.message.recipients, ["bob"]);
    assert.deepEqual(f.store.deliveriesForOperation(operation.id).map(delivery => delivery.recipient), ["bob"]);
    assert.equal(fs.existsSync(f.mail.inboxNewPath("carol", operation.plan.message.id)), false);
    assert.deepEqual(fs.readFileSync(f.mail.objectPath(operation.plan.message.id)), object);
    assert.equal(sha256Hex(object), operation.plan.message.sha256);
  } finally { f.close(); }
});

test("V20A: a submit same-key retry after acceptance reads no new bundle, and publication happens once", async (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), "oma-submit-scope-"));
  const store = new Store(join(root, "runtime.sqlite"));
  try {
    store.transaction((tx) => { tx.insertAgent(makeValidAgent("a")); tx.insertAgent(makeValidAgent("b")); });
    seedGit(root);
    const { git, mail } = gitFixture(root, store);
    const importBundle = Reflect.get(Reflect.get(git, "repository"), "quarantineImport") as (...args: unknown[]) => Promise<void>;
    let imports = 0;
    t.mock.method(Reflect.get(git, "repository") as Record<string, (...args: unknown[]) => Promise<void>>, "quarantineImport", async function (this: unknown, ...args: unknown[]) {
      if (imports++ === 0) throw new StoreError("REF_STATE_UNKNOWN", "injected loss after acceptance");
      return importBundle.apply(this, args);
    });
    const publishRef = Reflect.get(Reflect.get(git, "repository"), "publishRef") as (...args: unknown[]) => void;
    let publications = 0;
    t.mock.method(Reflect.get(git, "repository") as Record<string, (...args: unknown[]) => void>, "publishRef", function (this: unknown, ...args: unknown[]) {
      publications++; return publishRef.apply(this, args);
    });
    await assert.rejects(submitFixture(root, git, "submit-retry"), { code: "REF_STATE_UNKNOWN" });
    const accepted = store.getOperation("a", "submit-retry");
    assert.ok(accepted?.kind === "git.submit" && accepted.plan.bundle !== null);
    const bundle = fs.readFileSync(accepted.plan.bundle.path);
    assert.equal(sha256Hex(bundle), accepted.plan.bundle.sha256);
    const stagedBefore = fs.readdirSync(join(root, "staging")).filter(name => name.startsWith("submit-"));
    // The caller resends the same key; the accepted operation answers without reading a byte.
    const info = JSON.parse(fs.readFileSync(join(root, "git-fixture.json"), "utf8")) as { base: string; candidate: string; exportRef: string };
    let reads = 0;
    const retried = await git.submit(gitAuth, "submit-retry", { candidate: info.candidate, exportRef: info.exportRef, prerequisites: [info.base],
      to: ["b"], subject: "candidate", body: "fixed candidate", paths: ["change.txt"],
      bundle: { bytes: bundle.length, sha256: sha256Hex(bundle), mediaType: "application/x-git-bundle" } },
      (async function* () { reads++; yield bundle; })());
    assert.equal(retried.operation, accepted.id);
    assert.equal(reads, 0);
    assert.deepEqual(fs.readdirSync(join(root, "staging")).filter(name => name.startsWith("submit-")), stagedBefore);
    // Recovery publishes the ref, then loses the notification.
    const publishGated = mail.publishGated.bind(mail);
    let notified = 0;
    t.mock.method(mail, "publishGated", async (...args: Parameters<typeof mail.publishGated>) => {
      if (notified++ === 0) throw new StoreError("BROKER_UNAVAILABLE", "injected loss after publication");
      return publishGated(...args);
    });
    await assert.rejects(git.reconcile(accepted.id));
    assert.equal(publications, 1);
    assert.notEqual(store.getOperationById(accepted.id)?.state, "succeeded");
    // The next recovery re-observes the published ref and settles without publishing again.
    await git.reconcile(accepted.id);
    assert.equal(store.getOperationById(accepted.id)?.state, "succeeded");
    assert.equal(publications, 1, "a published ref is observed, never published twice");
    await git.reconcile(accepted.id);
    assert.equal(publications, 1);
    assert.equal(store.getOperationById(accepted.id)?.planJson, accepted.planJson);
    assert.deepEqual(fs.readFileSync(accepted.plan.bundle.path), bundle);
  } finally { store.close(); removeTree(root); }
});

test("V20B: recovery rebuilds only the missing derived links from the unchanged authoritative object", async (t) => {
  const f = mailFixture();
  try {
    f.store.transaction((tx) => tx.follow("work", "bob"));
    const operation = await pendingSend(t, f);
    const id = operation.plan.message.id;
    const object = fs.statSync(f.mail.objectPath(id));
    const bytes = fs.readFileSync(f.mail.objectPath(id));
    assert.equal(fs.existsSync(f.mail.archivePath(id)), false);
    assert.deepEqual(await f.mail.reconcilePending(), { examined: 1, repaired: 1, remaining: 0 });
    for (const view of [f.mail.archivePath(id), f.mail.inboxNewPath("bob", id)]) {
      const stat = fs.statSync(view);
      assert.deepEqual([stat.dev, stat.ino], [object.dev, object.ino], `${view} is a link to the accepted object`);
    }
    assert.deepEqual(fs.readFileSync(f.mail.objectPath(id)), bytes);
    assert.equal(fs.statSync(f.mail.objectPath(id)).mode & 0o777, 0o444);
  } finally { f.close(); }
});

test("V20B: a derived name holding other bytes is conflicting evidence, never overwritten or success", async (t) => {
  const f = mailFixture();
  try {
    f.store.transaction((tx) => tx.follow("work", "bob"));
    const operation = await pendingSend(t, f);
    const archive = f.mail.archivePath(operation.plan.message.id);
    fs.mkdirSync(join(archive, ".."), { recursive: true });
    fs.writeFileSync(archive, "someone else's bytes");
    await assert.rejects(f.mail.reconcilePending(), { code: "STORE_CORRUPT" });
    assert.equal(fs.readFileSync(archive, "utf8"), "someone else's bytes");
    assert.equal(f.store.getOperationById(operation.id)?.state, "pending");
    assert.equal(sha256Hex(fs.readFileSync(f.mail.objectPath(operation.plan.message.id))), operation.plan.message.sha256);
  } finally { f.close(); }
});

test("V20B: an existing archive without every delivery materialized never records success", async (t) => {
  const f = mailFixture();
  try {
    f.store.transaction((tx) => tx.follow("work", "bob"));
    const operation = await pendingSend(t, f);
    const id = operation.plan.message.id;
    fs.mkdirSync(join(f.mail.archivePath(id), ".."), { recursive: true });
    fs.linkSync(f.mail.objectPath(id), f.mail.archivePath(id));
    const inbox = join(f.root, "mail/inboxes/bob");
    fs.mkdirSync(inbox, { recursive: true });
    await patched(t, () => {
      t.mock.method(console, "error", () => undefined);
      t.mock.method(fs, "fsyncSync", (fd: number) => {
        if (fs.readlinkSync(`/proc/self/fd/${fd}`) === inbox) throw eio();
        native.fsync(fd);
      });
    }, async () => {
      assert.deepEqual(await f.mail.reconcilePending(), { examined: 1, repaired: 0, remaining: 1 });
      assert.equal(f.store.getOperationById(operation.id)?.state, "pending");
    });
    assert.deepEqual(await f.mail.reconcilePending(), { examined: 1, repaired: 1, remaining: 0 });
    assert.equal(f.store.getOperationById(operation.id)?.state, "succeeded");
  } finally { f.close(); }
});

test("DR46 Mail: recovery repairs owned mailbox modes before observing deliveries", async (t) => {
  const f = mailFixture();
  try {
    f.store.transaction(tx => tx.follow("work", "bob"));
    const operation = await pendingSend(t, f);
    const inbox = join(f.root, "mail/inboxes/bob");
    fs.mkdirSync(inbox, { recursive: true }); fs.chmodSync(inbox, 0o500);
    assert.deepEqual(await f.mail.reconcilePending(), { examined: 1, repaired: 1, remaining: 0 });
    assert.equal(fs.statSync(inbox).mode & 0o700, 0o700);
    assert.equal(f.store.getOperationById(operation.id)?.state, "succeeded");
  } finally { f.close(); }
});
