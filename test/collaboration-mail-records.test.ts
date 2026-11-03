import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, lstatSync, symlinkSync, renameSync } from "node:fs";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import type { AuthContext, MessagePlan } from "@oma/contracts";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { messageIdForOperation } from "@oma/domain/derived";
import { reviewRequestNameFor } from "@oma/domain/identifiers";
import { requestHash } from "@oma/domain/request-identity";
import { encodeOperationPlan } from "@oma/protocol/operation-codec";
import { generateOperationId } from "@oma/native/identity";
import { buildEml } from "@oma/mail/serialize";
import { CollaborationMailViews } from "#oma-test/app/views/collaboration-mail";
import { CollaborationMailHistory } from "#oma-test/app/views/collaboration-history";
import { createMailModule, mailLedger } from "#oma-test/app/broker/mail-composition";
import { mailEffects } from "#oma-test/app/broker/mail-effects";
import { ALL_CAPS, makeValidAgent } from "./fixtures/spec.js";
import { overwritePublished, removeTree } from "./fixtures/cleanup.js";
import { sendWithStop } from "./fixtures/mail-faults.js";

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "oma-collaboration-mail-"));
  const store = new Store(join(root, "runtime.sqlite"), 5, { society: "demo" });
  t.after(() => { try { store.close(); } finally { removeTree(root); } });
  store.transaction(tx => { for (const name of ["alice", "bob", "principal"]) tx.insertAgent(makeValidAgent(name, { incarnation: 1 })); });
  const paths = { stateRoot: root, society: "demo" };
  const mail = createMailModule(paths, store, 64, 24, { frameBytes: 256 * 1024, batchMaxMessages: 24 });
  const views = new CollaborationMailViews(store, mail, root, "demo");
  const auth = (actor = "alice"): AuthContext => ({ actor, incarnation: 1,
    role: actor === "principal" ? "principal" : "resident", channel: "actor", capabilities: new Set(ALL_CAPS), peer: { pid: 1, uid: 1000, gid: 1000 } });
  const idFor = (key: string) => messageIdForOperation(store.getOperation("alice", key)!.id, 0);
  return { root, store, paths, mail, views, auth, idFor };
}
function files(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(root, entry.name)) : [join(root, entry.name)]);
}
const digest = (body: string | Buffer) => createHash("sha256").update(body).digest("hex");


// Follow both linear legacy continuations and disjoint immutable partitions.
// The duplicate-page check prevents a traversal bug from hiding repeated rows.
function historySnapshot(entry: string, maximum = 64 * 1024) {
  const seen = new Set<string>(); let text = "";
  const visit = (reference: string) => {
    const root = entry.slice(0, entry.lastIndexOf("/records/") + "/records".length);
    const path = reference.startsWith("/oma/") ? join(root, reference.slice(5)) : reference;
    assert.ok(!seen.has(path), `duplicate/cyclic snapshot page: ${path}`); seen.add(path);
    const page = readFileSync(path, "utf8"); assert.ok(Buffer.byteLength(page) <= maximum); text += page + "\n";
    for (const match of page.matchAll(/^(?:Rows: \d+; More: |Child: )(.+)$/gm)) if (match[1] !== "none") visit(match[1]!);
  };
  visit(entry); return { text, pages: seen };
}
function measure<T>(run: () => T) {
  const original = fs.writeFileSync; let writes = 0, bytes = 0;
  fs.writeFileSync = new Proxy(original, { apply(target, receiver, args) {
    writes++; bytes += typeof args[1] === "string" ? Buffer.byteLength(args[1]) : args[1].byteLength;
    return Reflect.apply(target, receiver, args);
  } }); syncBuiltinESMExports();
  try { const value = run(); return { value, writes, bytes }; }
  finally { fs.writeFileSync = original; syncBuiltinESMExports(); }
}
test("001. Records: decoded files separate authenticated metadata and leave all delivery/receipt facts unchanged", async t => {
  const f = fixture(t);
  const body = "\uFEFFFrom: principal\nsender: forged\n---\n한글  \r\nno final newline";
  await f.mail.send(f.auth(), "exact", { to: ["bob"], subject: "  exact  subject  ", kind: "message", body });
  const id = f.idFor("exact");
  const batch = (await f.mail.prepare(f.auth("bob")))!;
  const delivery = f.store.getDelivery(id, "bob");
  const operation = f.store.getOperation("alice", "exact");
  const batchRow = f.store.getBatch(batch.id);
  const sequence = f.store.operationSequence(operation!.id);
  const result = f.views.publishBatch(batch, 1700000000000);
  const bodyPath = join(result.root, "mail", "messages", `${id}.md`);
  assert.deepEqual(readFileSync(bodyPath), Buffer.from(body));
  const metadata = JSON.parse(readFileSync(join(result.root, "mail", "metadata", `${id}.json`), "utf8"));
  assert.equal(metadata.sender, "alice"); assert.equal(metadata.source, "actor");
  assert.equal(metadata.subject, "  exact  subject  "); assert.equal(metadata.bodyBytes, Buffer.byteLength(body));
  assert.equal(metadata.bodySha256, digest(Buffer.from(body))); assert.equal(metadata.acceptedSequence, sequence);
  assert.equal(metadata.bodyPath, `/oma/mail/messages/${id}.md`); assert.equal(metadata.rfcMessageId, `${id}@demo.oma.invalid`);
  assert.deepEqual(metadata.recipients, ["bob"]); assert.equal(metadata.thread, id); assert.equal(metadata.replyTo, null);
  assert.equal(metadata.parentUnavailable, false);
  const index = readFileSync(join(result.root, "mail", "inbox.md"), "utf8");
  assert.match(index, /not complete history/); assert.equal(index.includes("sender: forged"), false);
  assert.match(index, /not a read receipt/); assert.match(readFileSync(join(result.root, "health.md"), "utf8"), /Overall refresh: partial/);
  for (const path of files(result.root)) assert.equal(statSync(path).mode & 0o777, 0o444);
  f.views.publishBatch(batch, 1700000000000);
  readFileSync(bodyPath); readFileSync(join(result.root, "mail", "inbox.md"));
  assert.deepEqual(f.store.getDelivery(id, "bob"), delivery);
  assert.deepEqual(f.store.getBatch(batch.id), batchRow);
  assert.equal(f.store.getOperation("alice", "exact")!.planJson, operation!.planJson);
  assert.equal(f.store.getOperation("alice", "exact")!.resultJson, operation!.resultJson);
  assert.equal(f.store.operationSequence(operation!.id), sequence, "projection is not an acceptance or update cursor");
});

test("002. Records: Mail publication and empty-history discovery refuse T before any projection I/O", async t => {
  const f = fixture(t);
  await f.mail.send(f.auth(), "outside-T", { to: ["bob"], subject: "Original", kind: "message", body: "accepted bytes" });
  const batch = (await f.mail.prepare(f.auth("bob")))!, id = f.idFor("outside-T");
  const history = new CollaborationMailHistory(f.store, f.mail, f.views, f.root);
  const before = { operation: f.store.getOperation("alice", "outside-T"), delivery: f.store.getDelivery(id, "bob"), batch: f.store.getBatch(batch.id) };
  const root = f.views.rootFor("bob"); assert.equal(fs.existsSync(root), false);
  for (const [publish, message] of [
    [() => f.views.publishRecords("bob", [id]), "mail records cannot publish in T"],
    [() => f.views.publishBatch(batch), "mail batch records cannot publish in T"],
    [() => history.refresh("bob"), "mail history cannot publish in T"],
    [() => history.refresh("principal"), "mail history cannot publish in T"],
  ] as const) assert.throws(() => f.store.transaction(() => { publish(); }), { code: "INTERNAL_ERROR", message });
  assert.equal(fs.existsSync(root), false); assert.equal(fs.existsSync(f.views.rootFor("principal")), false);
  assert.deepEqual({ operation: f.store.getOperation("alice", "outside-T"), delivery: f.store.getDelivery(id, "bob"), batch: f.store.getBatch(batch.id) }, before);
  f.views.publishBatch(batch); assert.equal(history.refresh("bob").messages, 1);
  assert.equal(f.store.getDelivery(id, "bob")!.acknowledged, 0, "a rejected T call or later successful publication cannot ACK Mail");
});

test("003. Records: thread roots follow verified replies, not matching subjects", async t => {
  const f = fixture(t);
  for (const key of ["root", "unrelated"]) await f.mail.send(f.auth(), key, { to: ["bob"], subject: "same", kind: "message", body: key });
  await f.mail.send(f.auth(), "reply", { to: ["bob"], subject: "different", kind: "message", body: "reply", replyToMessage: f.idFor("root") });
  await f.mail.send(f.auth(), "nested", { to: ["bob"], subject: "same", kind: "message", body: "nested", replyToMessage: f.idFor("reply") });
  const batch = (await f.mail.prepare(f.auth("bob")))!;
  const { root } = f.views.publishBatch(batch);
  const meta = (key: string) => JSON.parse(readFileSync(join(root, "mail", "metadata", `${f.idFor(key)}.json`), "utf8"));
  assert.equal(meta("nested").thread, f.idFor("root")); assert.equal(meta("nested").replyTo, f.idFor("reply"));
  assert.equal(meta("unrelated").thread, f.idFor("unrelated"));
});

test("004. Records: page byte bounds retain every row and generation-bound continuation", async t => {
  const f = fixture(t);
  for (let index = 0; index < 9; index++) await f.mail.send(f.auth(), `page-${index}`, {
    to: ["bob"], subject: "한글|`[subject]\u001b".repeat(15), kind: "message", body: `private-${index}` + "x".repeat(70000) });
  const batch = (await f.mail.prepare(f.auth("bob")))!;
  const views = new CollaborationMailViews(f.store, f.mail, f.root, "demo", 4096);
  const result = views.publishBatch(batch);
  assert.ok(result.pages > 1);
  const pages = files(join(result.root, "mail", "inbox", "pages"));
  const text = pages.map(path => { assert.ok(statSync(path).size <= 4096); return readFileSync(path, "utf8"); }).join("\n");
  for (const id of batch.messageIds) assert.equal(text.split(`${id}.md`).length - 1, 1, "each source body has one indexed row");
  assert.equal(text.includes("private-"), false); assert.equal(text.includes("\u001b"), false);
  assert.match(text, /\\u007c/); assert.match(text, /\\u0060/); assert.match(text, /More: none/);
  for (const page of pages) for (const match of readFileSync(page, "utf8").matchAll(/More: (.+)/g))
    if (match[1] !== "none") assert.ok(pages.includes(join(result.root, match[1]!.slice(5))));
});

test("005. Records: pending publication, unknown observation and projection reads never publish accepted mail", async t => {
  const f = fixture(t);
  await assert.rejects(sendWithStop(f.mail, f.store, f.auth(), "pending", { to: ["bob"], subject: "pending", kind: "message", body: "exact" }, "accepted"));
  const id = f.idFor("pending"); const operation = f.store.getOperation("alice", "pending")!;
  assert.deepEqual(f.mail.readRecord("bob", id), { state: "archive-absent", message: id, operation: operation.id });
  const effects = mailEffects(f.paths);
  const unavailable = new MailModule(f.paths, mailLedger(f.store), 64, { ...effects,
    observeArchive: () => ({ kind: "unavailable", error: new Error("I/O unavailable") }) });
  assert.throws(() => unavailable.readRecord("bob", id), { code: "BROKER_UNAVAILABLE" });
  assert.equal(f.store.getDelivery(id, "bob")!.materialized, 0);
  assert.equal(f.store.getOperation("alice", "pending")!.planJson, operation.planJson);
  await f.mail.materialize(operation.id);
  assert.equal(f.mail.readRecord("bob", id).state, "published");
  assert.throws(() => f.mail.readRecord("bob", `${id}@demo.oma.invalid`), { code: "INVALID_REQUEST" });
  assert.throws(() => f.mail.readRecord("bob", messageIdForOperation(operation.id, 99)), { code: "REQUEST_NOT_FOUND" });
});

async function workersMessage(f: ReturnType<typeof fixture>) {
  const operation = generateOperationId(); const name = reviewRequestNameFor("merge", operation);
  const frozen = await f.mail.freezeReviewMessage(operation, 0, "alice", { to: ["residents"], kind: "message", subject: "secret worker subject",
    body: "secret worker body", replyHeaders: { replyTo: ["residents"], inReplyTo: null, references: [] }, audience: "workers",
    review: { role: "thread", request: operation, name, revision: 0 } });
  const message = { ...frozen.message, recipients: ["alice", "bob"] };
  const base = "1".repeat(40), candidate = "2".repeat(40);
  const payload = { kind: "merge.open", tier: "MEDIUM", title: "Fix", reason: "needed", candidate, base };
  f.store.transaction(tx => {
    tx.acceptOperation({ id: operation, actor: "alice", requestKey: "workers", requestHash: requestHash("attest.record", payload),
      kind: "attest.record", payloadJson: JSON.stringify(payload), planJson: encodeOperationPlan({ kind: "attest.record",
        fact: { kind: "merge.open", version: 1, name, title: "Fix", reason: "needed", tier: "MEDIUM",
          identity: { repo: "project", targetRef: "refs/heads/main", expectedBase: base, candidate, policyRevision: "p1" }, submitters: ["alice"] }, messages: [message] }) });
    tx.insertDeliveries(message.recipients.map(recipient => ({ messageId: message.id, recipient, operationId: operation })));
  });
  mkdirSync(join(f.root, "mail", "workers", "cur"), { recursive: true });
  await f.mail.materialize(operation);
  return message;
}

test("006. Records: Principal has neither workers-only files nor Worker recipient metadata", async t => {
  const f = fixture(t);
  const worker = await workersMessage(f);
  assert.equal(f.mail.readRecord("bob", worker.id).state, "published");
  const workerRecord = f.mail.readRecord("bob", worker.id);
  if (workerRecord.state !== "published") assert.fail("worker archive must be published");
  assert.equal(workerRecord.record.source, "broker");
  assert.equal(workerRecord.record.review?.role, "thread");
  assert.throws(() => f.mail.readRecord("principal", worker.id), { code: "CAPABILITY_DENIED" });
  await f.mail.send(f.auth(), "principal", { to: ["principal", "bob"], subject: "public", kind: "message", body: "public body" });
  const principal = (await f.mail.prepare(f.auth("principal")))!;
  const result = f.views.publishBatch(principal);
  const tree = files(result.root).map(path => path + "\n" + readFileSync(path, "utf8")).join("\n");
  for (const secret of [worker.id, "secret worker subject", "secret worker body"]) assert.equal(tree.includes(secret), false);
  const metadata = JSON.parse(readFileSync(join(result.root, "mail", "metadata", `${f.idFor("principal")}.json`), "utf8"));
  assert.equal(Object.hasOwn(metadata, "recipients"), false);
  assert.throws(() => f.views.publishBatch({ ...principal, messageIds: [worker.id] }), { code: "BATCH_CONFLICT" });
});

test("007. Records: immutable body conflict leaves previous index and accepted facts intact", async t => {
  const f = fixture(t);
  await f.mail.send(f.auth(), "conflict", { to: ["bob"], subject: "original", kind: "message", body: "accepted body" });
  const batch = (await f.mail.prepare(f.auth("bob")))!;
  const { root } = f.views.publishBatch(batch, 1700000000000);
  const index = readFileSync(join(root, "mail", "inbox.md"));
  overwritePublished(join(root, "mail", "messages", `${f.idFor("conflict")}.md`), "projection damage");
  assert.throws(() => f.views.publishBatch(batch, 1700000000001), { code: "BROKER_UNAVAILABLE" });
  assert.deepEqual(readFileSync(join(root, "mail", "inbox.md")), index);
  assert.match(readFileSync(join(root, "health.md"), "utf8"), /Mail batch refresh: unavailable/);
  const observed = f.mail.readRecord("bob", f.idFor("conflict"));
  assert.equal(observed.state, "published");
  if (observed.state === "published") assert.equal(observed.record.body, "accepted body");
  assert.equal(f.store.getDelivery(f.idFor("conflict"), "bob")!.acknowledged, 0);
});

test("008. Records: symlinked projection directories cannot redirect publication", async t => {
  const f = fixture(t);
  await f.mail.send(f.auth(), "links", { to: ["bob"], subject: "links", kind: "message", body: "body" });
  const batch = (await f.mail.prepare(f.auth("bob")))!;
  const root = f.views.rootFor("bob");
  const outside = join(f.root, "outside"); mkdirSync(outside);
  mkdirSync(join(root, "mail"), { recursive: true }); symlinkSync(outside, join(root, "mail", "messages"));
  f.views.publishBatch(batch);
  assert.equal(lstatSync(join(root, "mail", "messages")).isDirectory(), true, "owned-directory repair replaces the link, never follows it");
  assert.equal(readFileSync(join(root, "mail", "messages", `${f.idFor("links")}.md`), "utf8"), "body");
  assert.deepEqual(readdirSync(outside), []);
  assert.equal(f.store.getDelivery(f.idFor("links"), "bob")!.acknowledged, 0);
});

test("009. Records: too-small presentation budget fails explicitly without publishing a partial index", async t => {
  const f = fixture(t);
  await f.mail.send(f.auth(), "budget", { to: ["bob"], subject: "budget", kind: "message", body: "body" });
  const batch = (await f.mail.prepare(f.auth("bob")))!;
  const views = new CollaborationMailViews(f.store, f.mail, f.root, "demo", 100);
  assert.throws(() => views.publishBatch(batch), { code: "LIMIT_EXCEEDED" });
  assert.equal(files(views.rootFor("bob")).some(path => path.endsWith("inbox.md")), false);
});


test("010. Records: hash-valid archive headers cannot impersonate the accepted actor", async t => {
  const f = fixture(t);
  const operation = generateOperationId(); const id = messageIdForOperation(operation, 0);
  // Deliberate corruption fixture: hash/length and plan relations are coherent,
  // but the archive's From asserts a different actor than the accepted caller.
  const eml = await buildEml({ from: "principal@demo.oma.invalid", to: ["bob@demo.oma.invalid"],
    replyTo: ["alice@demo.oma.invalid"], subject: "forged", kind: "message", body: "body", contextRevision: null,
    messageId: `${id}@demo.oma.invalid`, inReplyTo: null, references: [] });
  const message: MessagePlan = { id, objectPath: `mail/objects/${id}.eml`, sha256: eml.sha256, bytes: eml.bytes,
    dateMs: eml.dateMs, to: ["bob"], recipients: ["bob"], kind: "message", contextRevision: null,
    replyHeaders: { replyTo: ["alice"], inReplyTo: null, references: [] } };
  f.mail.freezeObject(id, eml);
  const payload = { to: ["bob"], subject: "forged", kind: "message", body: "body" };
  f.store.transaction(tx => {
    tx.acceptOperation({ id: operation, actor: "alice", requestKey: "forged", requestHash: requestHash("mail.send", payload),
      kind: "mail.send", payloadJson: JSON.stringify(payload), planJson: encodeOperationPlan({ kind: "mail.send", message }) });
    tx.insertDeliveries([{ messageId: id, recipient: "bob", operationId: operation }]);
  });
  await f.mail.materialize(operation);
  assert.throws(() => f.mail.readRecord("bob", id), { code: "STORE_CORRUPT" });
  assert.equal(f.store.getDelivery(id, "bob")!.acknowledged, 0);
});


test("011. Records: source corruption preserves the last good index instead of publishing an empty inbox", async t => {
  const f = fixture(t);
  await f.mail.send(f.auth(), "source", { to: ["bob"], subject: "source", kind: "message", body: "frozen" });
  const batch = (await f.mail.prepare(f.auth("bob")))!;
  const { root } = f.views.publishBatch(batch, 1700000000000);
  const previous = readFileSync(join(root, "mail", "inbox.md"));
  overwritePublished(f.mail.archivePath(f.idFor("source")), "corrupt archive");
  assert.throws(() => f.views.publishBatch(batch, 1700000000001), { code: "STORE_CORRUPT" });
  assert.deepEqual(readFileSync(join(root, "mail", "inbox.md")), previous);
  assert.match(readFileSync(join(root, "health.md"), "utf8"), /Mail batch refresh: unavailable/);
  assert.equal(f.store.getBatch(batch.id)!.state, "prepared");
});

test("012. Records: forged attempts and manifests fail before any projection or health write", async t => {
  const f = fixture(t);
  await f.mail.send(f.auth(), "scope", { to: ["bob"], subject: "scope", kind: "message", body: "body" });
  const batch = (await f.mail.prepare(f.auth("bob")))!;
  for (const forged of [ { ...batch, agent: "principal" }, { ...batch, incarnation: NaN },
    { ...batch, incarnation: batch.incarnation + 1 }, { ...batch, messageIds: [] },
    { ...batch, messageIds: [...batch.messageIds, ...batch.messageIds] } ]) {
    assert.throws(() => f.views.publishBatch(forged), { code: "BATCH_CONFLICT" });
  }
  for (const name of ["bob", "principal"]) assert.throws(() => statSync(f.views.rootFor(name)), { code: "ENOENT" });
  assert.equal(f.store.getDelivery(f.idFor("scope"), "bob")!.acknowledged, 0);
});


for (const [point, writeNumber] of [["page", 1], ["current-index", 2]] as const) {
  test(`013. Records: interrupted ${point} publication resumes original facts without a second delivery`, async t => {
    const f = fixture(t);
    await f.mail.send(f.auth(), "interrupted", { to: ["bob"], subject: "interrupted", kind: "message", body: "exact source" });
    const batch = (await f.mail.prepare(f.auth("bob")))!;
    const first = f.views.publishBatch(batch, 1700000000000);
    const before = readFileSync(join(first.root, "mail", "inbox.md"));
    const delivery = f.store.getDelivery(f.idFor("interrupted"), "bob");
    const receipt = f.store.getOperation("alice", "interrupted")!.resultJson;
    const original = fs.writeFileSync;
    let writes = 0;
    // Real file writes before the injected EIO remain. This is an in-process
    // fault, not SIGKILL/power-loss evidence or an alternate production writer.
    fs.writeFileSync = new Proxy(original, { apply(target, receiver, args) {
      if (typeof args[1] === "string" && args[1].startsWith("# Inbox\n") && ++writes === writeNumber)
        throw Object.assign(new Error("injected index publication failure"), { code: "EIO" });
      return Reflect.apply(target, receiver, args);
    } });
    syncBuiltinESMExports();
    try { assert.throws(() => f.views.publishBatch(batch, 1700000000001), { code: "EIO" }); }
    finally { fs.writeFileSync = original; syncBuiltinESMExports(); }
    assert.equal(writes, writeNumber, "the named physical publication boundary was reached");
    assert.deepEqual(readFileSync(join(first.root, "mail", "inbox.md")), before);
    assert.match(readFileSync(join(first.root, "health.md"), "utf8"), /Mail batch refresh: unavailable/);
    // A fresh projection owner has no in-memory progress to borrow. Existing
    // immutable dependencies must be verified and reused, not re-sent.
    const restarted = new CollaborationMailViews(f.store, f.mail, f.root, "demo");
    restarted.publishBatch(batch, 1700000000001);
    assert.notDeepEqual(readFileSync(join(first.root, "mail", "inbox.md")), before);
    assert.equal(readFileSync(join(first.root, "mail", "messages", `${f.idFor("interrupted")}.md`), "utf8"), "exact source");
    assert.deepEqual(f.store.getDelivery(f.idFor("interrupted"), "bob"), delivery);
    assert.equal(f.store.getOperation("alice", "interrupted")!.resultJson, receipt);
    assert.equal(f.store.getBatch(batch.id)!.state, "prepared");
  });
}

test("014. History: bounded accepted pages and late readers discover more than 100 messages without new deliveries", async t => {
  const f = fixture(t);
  for (let index = 0; index < 131; index++) await f.mail.send(f.auth(), `history-${index}`, {
    to: [index % 2 === 0 ? "commons" : "bob"], subject: `history subject ${index}`, kind: "message", body: `body ${index}` });
  const first = f.store.acceptedOperationPage(0, undefined, 3);
  assert.equal(first.items.length, 3); assert.ok(first.next !== null);
  await f.mail.send(f.auth(), "after-range", { to: ["bob"], subject: "outside fixed range", kind: "message", body: "later" });
  let cursor: number | null = first.next; let count = 3;
  while (cursor !== null) {
    const page = f.store.acceptedOperationPage(cursor, first.through, 3);
    assert.equal(page.through, first.through); count += page.items.length; cursor = page.next;
  }
  assert.equal(count, 131, "membership remains in the original acceptance range");
  for (const args of [[-1], [0, -1], [0, undefined, 129], [NaN]])
    assert.throws(() => f.store.acceptedOperationPage(...args as [number, number?, number?]), RangeError);
  f.store.transaction(tx => tx.insertAgent(makeValidAgent("charlie", { incarnation: 1 })));
  const history = new CollaborationMailHistory(f.store, f.mail, f.views, f.root, 4096);
  const result = history.refresh("charlie", [], 1700000000000);
  assert.equal(result.messages, 132); assert.equal(result.refresh, "complete");
  const root = result.root, snapshot = historySnapshot(join(root, "mail/index.md"), 4096), found = snapshot.text;
  assert.ok(snapshot.pages.size > 1);
  for (let index = 0; index < 131; index++) {
    assert.equal(found.split(`history subject ${index} |`).length - 1, 1);
    assert.equal(f.store.getDelivery(f.idFor(`history-${index}`), "charlie"), null);
  }
  const before = readFileSync(join(root, "mail", "index.md"));
  history.refresh("charlie", [], 1700000000001);
  assert.deepEqual(readFileSync(join(root, "mail", "index.md")), before, "unchanged history is not rescanned/republished at every boundary");
});

test("015. History: topic/thread/sent discovery preserves role scope and observes pending publication without accepting it", async t => {
  const f = fixture(t), secret = await workersMessage(f);
  f.store.transaction(tx => tx.follow("runtime", "bob"));
  await f.mail.send(f.auth(), "topic-root", { to: ["topic/runtime"], subject: "topic root", kind: "message", body: "root" });
  await f.mail.send(f.auth("bob"), "reply", { to: ["alice"], subject: "reply subject", kind: "message", body: "reply", replyToMessage: f.idFor("topic-root") });
  const history = new CollaborationMailHistory(f.store, f.mail, f.views, f.root);
  const worker = history.refresh("alice");
  assert.match(historySnapshot(join(worker.root, "mail/topics/runtime/index.md")).text, /topic root/);
  assert.match(historySnapshot(join(worker.root, "mail/threads", f.idFor("topic-root"), "index.md")).text, /reply subject/);
  assert.match(historySnapshot(join(worker.root, "mail/sent.md")).text, /topic root/);
  const principal = history.refresh("principal");
  const visible = files(principal.root).map(path => path + "\n" + readFileSync(path, "utf8")).join("\n");
  for (const privateValue of [secret.id, "secret worker subject", "secret worker body"]) assert.equal(visible.includes(privateValue), false);
  for (const path of files(principal.root).filter(path => path.includes("/metadata/")))
    assert.equal(Object.hasOwn(JSON.parse(readFileSync(path, "utf8")), "recipients"), false);
  await assert.rejects(sendWithStop(f.mail, f.store, f.auth(), "history-pending", {
    to: ["bob"], subject: "pending", kind: "message", body: "pending body" }, "accepted"));
  const operation = f.store.getOperation("alice", "history-pending")!;
  const pending = history.refresh("alice");
  assert.equal(pending.refresh, "partial"); assert.equal(pending.pending, 1);
  assert.equal(f.store.getDelivery(f.idFor("history-pending"), "bob")!.materialized, 0);
  await f.mail.materialize(operation.id);
  const resumed = history.refresh("alice");
  assert.equal(resumed.pending, 0); assert.equal(resumed.refresh, "complete");
  assert.equal(f.store.operationSequence(operation.id), pending.through, "materialization does not advance acceptance order");
  assert.equal(readFileSync(join(resumed.root, "mail", "messages", `${f.idFor("history-pending")}.md`), "utf8"), "pending body");
  assert.equal(f.store.getDelivery(f.idFor("history-pending"), "bob")!.acknowledged, 0);
});

for (const point of ["body", "metadata", "page", "index", "health"] as const) {
  test(`016. History: interrupted ${point} publication reconstructs original observations with a fresh owner`, async t => {
    const f = fixture(t);
    await f.mail.send(f.auth(), "before", { to: ["bob"], subject: "before", kind: "message", body: "before body" });
    const history = new CollaborationMailHistory(f.store, f.mail, f.views, f.root);
    const first = history.refresh("bob", [], 1700000000000);
    const index = readFileSync(join(first.root, "mail", "index.md"));
    await f.mail.send(f.auth(), "history-fault", { to: ["bob"], subject: "after", kind: "message", body: "history fault exact body" });
    const delivery = f.store.getDelivery(f.idFor("history-fault"), "bob");
    const receipt = f.store.getOperation("alice", "history-fault")!.resultJson;
    const original = fs.writeFileSync; let matching = 0, injected = false;
    fs.writeFileSync = new Proxy(original, { apply(target, receiver, args) {
      const text = args[1];
      if (typeof text === "string" && !injected) {
        const match = point === "body" ? text === "history fault exact body" : point === "metadata" ? text.startsWith('{\n  "version": "collaboration-v1"')
          : point === "health" ? text.startsWith("# Mail history health\n") : text.startsWith("# Permitted mail history\n");
        if (match && ++matching === (point === "index" ? 2 : 1)) {
          injected = true; throw Object.assign(new Error(`injected history ${point} failure`), { code: "EIO" });
        }
      }
      return Reflect.apply(target, receiver, args);
    } });
    syncBuiltinESMExports();
    try { assert.throws(() => history.refresh("bob", [], 1700000000001), { code: "EIO" }); }
    finally { fs.writeFileSync = original; syncBuiltinESMExports(); }
    assert.ok(injected, "the named actual write boundary must be reached");
    if (point !== "health") assert.deepEqual(readFileSync(join(first.root, "mail", "index.md")), index);
    assert.match(readFileSync(join(first.root, "mail", "health.md"), "utf8"), /Refresh: unavailable/);
    const fresh = new CollaborationMailHistory(f.store, f.mail, new CollaborationMailViews(f.store, f.mail, f.root, "demo"), f.root);
    const retried = fresh.refresh("bob", [], 1700000000001);
    assert.equal(retried.messages, 2);
    assert.match(readFileSync(join(first.root, "mail", "index.md"), "utf8"), /after/);
    assert.equal(readFileSync(join(first.root, "mail", "messages", `${f.idFor("history-fault")}.md`), "utf8"), "history fault exact body");
    assert.deepEqual(f.store.getDelivery(f.idFor("history-fault"), "bob"), delivery);
    assert.equal(f.store.getOperation("alice", "history-fault")!.resultJson, receipt);
  });
}

test("017. History cost: unchanged dirty mail writes only health; unrelated append preserves all old thread indexes and retains zero body bytes", async t => {
  const f = fixture(t), body = "BODY_MUST_NOT_REMAIN_IN_HISTORY_CACHE_" + "x".repeat(16384);
  let reads = 0;
  const reader = { readRecord(actor: string, id: string) { reads++; return f.mail.readRecord(actor, id); } };
  const views = new CollaborationMailViews(f.store, reader, f.root, "demo");
  const history = new CollaborationMailHistory(f.store, reader, views, f.root);
  for (let i = 0; i < 20; i++) await f.mail.send(f.auth(), `cost-${i}`, { to: ["bob"], subject: `Independent ${i}`, kind: "message", body });
  const first = history.refresh("bob", [], 1700000000000), pageRoot = join(first.root, "mail/pages");
  const protectedPaths = [...Array.from({ length: 20 }, (_, i) => join(first.root, "mail/threads", f.idFor(`cost-${i}`), "index.md")),
    join(first.root, "mail/topics/index.md"), join(first.root, "mail/sent.md"), join(first.root, "mail/commons.md")];
  const before = new Map(protectedPaths.map(path => [path, { inode: statSync(path).ino, bytes: readFileSync(path) }]));
  const initialPages = readdirSync(pageRoot).length;
  const idle = measure(() => history.refresh("bob", [], 1700000000001));
  reads = 0;
  const dirty = measure(() => history.refresh("bob", [f.store.getOperation("alice", "cost-0")!.id], 1700000000002));
  assert.equal(reads, 1); assert.equal(idle.writes, 1); assert.equal(dirty.writes, 1);
  assert.equal(readdirSync(pageRoot).length, initialPages, "unchanged dirty observations create no immutable pages");
  await f.mail.send(f.auth(), "cost-20", { to: ["bob"], subject: "Independent 20", kind: "message", body });
  reads = 0;
  const appended = measure(() => history.refresh("bob", [], 1700000000003)), appendedReads = reads;
  const newPages = readdirSync(pageRoot).length - initialPages;
  assert.equal(appendedReads, 1); assert.ok(appended.writes <= 12, `one append wrote ${appended.writes} files`);
  assert.ok(newPages <= 4, `one append made ${newPages} pages, not one per existing thread`);
  for (const [path, old] of before) { assert.equal(statSync(path).ino, old.inode, `unaffected index was replaced: ${path}`); assert.deepEqual(readFileSync(path), old.bytes); }
  history.refresh("principal", [], 1700000000004);
  const seen = new Set<object>(); let retainedBodies = 0;
  const inspect = (value: unknown): void => {
    if (typeof value === "string") { if (value.includes("BODY_MUST_NOT_REMAIN_IN_HISTORY_CACHE_")) retainedBodies += Buffer.byteLength(value); return; }
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    for (const child of value instanceof Map ? [...value.keys(), ...value.values()] : value instanceof Set ? value.values() : Object.values(value)) inspect(child);
  };
  // Inspect retained state, not process heap estimates or transient read buffers.
  inspect((history as unknown as { state: unknown }).state); inspect((views as unknown as { threads: unknown }).threads);
  assert.equal(retainedBodies, 0);
  const records = (history as unknown as { state: Map<string, { records: Map<string, { mail: { record: object } }> }> }).state;
  for (const state of records.values()) for (const item of state.records.values()) assert.equal(Object.hasOwn(item.mail.record, "body"), false);
  assert.equal(readFileSync(join(first.root, "mail/messages", `${f.idFor("cost-20")}.md`), "utf8"), body);
  console.log("MCS cost measurements", JSON.stringify({ idleWrites: idle.writes, unchangedDirtyWrites: dirty.writes, appendedWrites: appended.writes, newPages, appendedReads, retainedBodies }));
});

test("018. History cost: append below twelve verified ancestors reads only the new message, with actor-scoped thread caching", async t => {
  const f = fixture(t); let reads = 0;
  const reader = { readRecord(actor: string, id: string) { reads++; return f.mail.readRecord(actor, id); } };
  const views = new CollaborationMailViews(f.store, reader, f.root, "demo"), history = new CollaborationMailHistory(f.store, reader, views, f.root);
  let parent: string | undefined;
  for (let i = 0; i < 12; i++) {
    await f.mail.send(f.auth(), `chain-${i}`, { to: ["bob"], subject: `Chain ${i}`, kind: "message", body: "thread body", ...(parent ? { replyToMessage: parent } : {}) });
    parent = f.idFor(`chain-${i}`);
  }
  const first = history.refresh("bob"); reads = 0;
  await f.mail.send(f.auth(), "chain-12", { to: ["bob"], subject: "Chain 12", kind: "message", body: "thread body", replyToMessage: parent! });
  reads = 0; history.refresh("bob"); assert.equal(reads, 1);
  const metadata = JSON.parse(readFileSync(join(first.root, "mail/metadata", `${f.idFor("chain-12")}.json`), "utf8"));
  assert.equal(metadata.thread, f.idFor("chain-0")); assert.equal(metadata.replyTo, parent);
  const secret = await workersMessage(f);
  views.publishRecords("bob", [secret.id]);
  assert.throws(() => views.publishRecords("principal", [secret.id]), { code: "CAPABILITY_DENIED" });
  reads = 0;
  views.publishRecords("principal", [f.idFor("chain-12")]);
  assert.equal(reads, 13, "a new actor must verify its own permitted ancestry, not borrow a Worker's cached relation");
  const principalRoot = views.rootFor("principal");
  const own = JSON.parse(readFileSync(join(principalRoot, "mail/metadata", `${f.idFor("chain-12")}.json`), "utf8"));
  assert.equal(own.thread, f.idFor("chain-0")); assert.equal(Object.hasOwn(own, "recipients"), false);
  assert.throws(() => statSync(join(principalRoot, "mail/messages", `${secret.id}.md`)), { code: "ENOENT" });
  assert.equal(f.store.getDelivery(f.idFor("chain-12"), "bob")!.acknowledged, 0);
});

test("019. History cost: large paged appends reuse immutable partitions; cumulative writes do not track the whole history", async t => {
  const f = fixture(t), history = new CollaborationMailHistory(f.store, f.mail, f.views, f.root, 4096);
  for (let i = 0; i < 64; i++) await f.mail.send(f.auth(), `growth-${i}`, { to: ["bob"], subject: `growth ${i}`, kind: "message", body: "body" });
  const first = history.refresh("bob"), entry = join(first.root, "mail/index.md"), original = historySnapshot(entry, 4096);
  const originalGeneration = /^Generation: (.+)$/m.exec(readFileSync(entry, "utf8"))![1]!;
  const counts: number[] = [], bytes: number[] = [];
  for (let i = 64; i < 192; i++) {
    await f.mail.send(f.auth(), `growth-${i}`, { to: ["bob"], subject: `growth ${i}`, kind: "message", body: "body" });
    const sample = measure(() => history.refresh("bob")); counts.push(sample.writes); bytes.push(sample.bytes);
  }
  const current = historySnapshot(entry, 4096), oldSnapshot = historySnapshot(join(first.root, "mail/pages", `${originalGeneration}.md`), 4096);
  for (let i = 0; i < 192; i++) assert.equal(current.text.split(`growth ${i} |`).length - 1, 1, `missing or repeated message ${i}`);
  assert.equal(oldSnapshot.text.includes("growth 64 |"), false, "a saved snapshot cannot acquire later rows");
  const oldPages = [...original.pages].filter(path => path !== entry);
  assert.ok(oldPages.filter(path => current.pages.has(path)).length >= oldPages.length / 2, "unchanged old partitions remain referenced, not merely left as garbage");
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  assert.ok(Math.max(...counts) <= 32, `per-append write ceiling exceeded: ${Math.max(...counts)}`);
  assert.ok(sum(counts.slice(-32)) <= sum(counts.slice(0, 32)) * 1.8, "append writes must not grow in proportion to historical thread count");
  assert.ok(sum(bytes.slice(-32)) <= sum(bytes.slice(0, 32)) * 1.8, "serialized output bytes must not grow in proportion to the entire history");
  console.log("MCS growth measurements", JSON.stringify({ first32Writes: sum(counts.slice(0, 32)), last32Writes: sum(counts.slice(-32)), maxWrites: Math.max(...counts), first32Bytes: sum(bytes.slice(0, 32)), last32Bytes: sum(bytes.slice(-32)) }));
});

test("020. History: an absent parent is not negatively cached; restoration moves the child into its verified thread without new facts", async t => {
  const f = fixture(t);
  await f.mail.send(f.auth(), "parent", { to: ["bob"], subject: "parent", kind: "message", body: "parent body" });
  await f.mail.send(f.auth(), "child", { to: ["bob"], subject: "child", kind: "message", body: "child body", replyToMessage: f.idFor("parent") });
  const archive = f.mail.archivePath(f.idFor("parent")), saved = archive + ".fixture-saved";
  renameSync(archive, saved);
  const history = new CollaborationMailHistory(f.store, f.mail, f.views, f.root), first = history.refresh("bob");
  assert.equal(first.pending, 1);
  const meta = join(first.root, "mail/metadata", `${f.idFor("child")}.json`);
  assert.equal(JSON.parse(readFileSync(meta, "utf8")).parentUnavailable, true);
  const receipt = f.store.getOperation("alice", "child")!.resultJson, delivery = f.store.getDelivery(f.idFor("child"), "bob");
  renameSync(saved, archive);
  const resumed = history.refresh("bob"); assert.equal(resumed.pending, 0);
  assert.equal(JSON.parse(readFileSync(meta, "utf8")).thread, f.idFor("parent"));
  assert.equal(JSON.parse(readFileSync(meta, "utf8")).parentUnavailable, false);
  assert.match(historySnapshot(join(first.root, "mail/threads", f.idFor("parent"), "index.md")).text, /child/);
  assert.equal(historySnapshot(join(first.root, "mail/threads/index.md")).text.includes(`- ${f.idFor("child")}:`), false);
  assert.equal(f.store.getOperation("alice", "child")!.resultJson, receipt); assert.deepEqual(f.store.getDelivery(f.idFor("child"), "bob"), delivery);
});

for (const point of ["branch", "entry", "health"] as const) {
  test(`021. History cost: interrupted partition ${point} publication retries with the same owner without advancing its observation cache`, async t => {
    const f = fixture(t), history = new CollaborationMailHistory(f.store, f.mail, f.views, f.root, 4096);
    for (let i = 0; i < 40; i++) await f.mail.send(f.auth(), `partition-${i}`, { to: ["bob"], subject: `partition ${i}`, kind: "message", body: "body" });
    const first = history.refresh("bob"), entry = join(first.root, "mail/index.md"), before = readFileSync(entry);
    await f.mail.send(f.auth(), "partition-next", { to: ["bob"], subject: "partition next", kind: "message", body: "exact after interruption" });
    const operation = f.store.getOperation("alice", "partition-next")!, delivery = f.store.getDelivery(f.idFor("partition-next"), "bob");
    const original = fs.writeFileSync; let injected = false;
    fs.writeFileSync = new Proxy(original, { apply(target, receiver, args) {
      const text = args[1];
      const match = typeof text === "string" && (point === "health" ? text.startsWith("# Mail history health\n") :
        text.startsWith("# Permitted mail history\n") && text.includes("Child: ") && (point === "entry" ? text.includes("Index content changed at:") : !text.includes("Index content changed at:")));
      if (!injected && match) { injected = true; throw Object.assign(new Error(`injected partition ${point}`), { code: "EIO" }); }
      return Reflect.apply(target, receiver, args);
    } }); syncBuiltinESMExports();
    try { assert.throws(() => history.refresh("bob"), { code: "EIO" }); }
    finally { fs.writeFileSync = original; syncBuiltinESMExports(); }
    assert.ok(injected); if (point !== "health") assert.deepEqual(readFileSync(entry), before);
    const retried = history.refresh("bob"); assert.equal(retried.messages, 41);
    const snapshot = historySnapshot(entry, 4096);
    for (let i = 0; i < 40; i++) assert.equal(snapshot.text.split(`partition ${i} |`).length - 1, 1);
    assert.equal(snapshot.text.split("partition next |").length - 1, 1);
    assert.equal(f.store.getOperation("alice", "partition-next")!.resultJson, operation.resultJson);
    assert.deepEqual(f.store.getDelivery(f.idFor("partition-next"), "bob"), delivery);
  });
}
