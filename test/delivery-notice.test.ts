import { renderBatchView } from "@oma/mail/batch-view";
import { REDELIVERY_NOTICE } from "@oma/mail/batches";
import { batchViewNoticeBudget, encodeBatchView, MIN_BATCH_VIEW_FRAME_BYTES } from "@oma/protocol/batch-view";
import { runnerViewPathAt } from "@oma/domain/paths";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
/** AV10 -- BATCH-002 as a reader meets it: the notice names each message by
 * its subject, and the index it points to can be read by the agent it is for.
 *
 * The functional run with a real provider delivered Korean subjects to the
 * Principal as RFC 2047 encoded words, and pointed it at `/inbox.md`, which on
 * the host -- where the Principal runs -- is no file: a batch of up to 24
 * messages named six, and the Principal could not learn the rest.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthContext, Capability } from "@oma/contracts";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { registerOmaTools } from "@oma/extension/mail-tools";
import { containWorkspaceTools } from "@oma/tool-runtime/contained-tools";
import { collaborationSurface } from "@oma/domain/collaboration-surface";
import { messageIdForOperation } from "@oma/domain/derived";
import { CollaborationMailViews } from "#oma-test/app/views/collaboration-mail";
import * as modelRegistration from "@oma/extension/mail-tools";
import { buildEml } from "@oma/mail/serialize";
import { readableMail, decodedMailBody } from "@oma/mail/display";
import { parseMessage, readBody } from "#oma-test/app/application/mail";
import { PrincipalChannel } from "@oma/extension/principal-channel";
import { makeValidAgent } from "./fixtures/spec.js";
import { TEST_VIEW_LIMITS } from "./fixtures/limits.js";

function auth(actor: string, caps: Capability[]): AuthContext {
  return { actor, incarnation: 1, role: "resident", channel: "actor", capabilities: new Set(caps),
    peer: { pid: 1, uid: 1000, gid: 1000 } };
}

// This exercises the ordinary contained read implementation, not a retired
// mail-specific resolver. Full Pi/hashline registration is covered separately.
function ordinaryReader(root: string, readableRoots: readonly string[]) {
  const workspace = join(root, "workspace"); mkdirSync(workspace, { recursive: true });
  type Tool = { execute(id: string, input: Record<string, unknown>): Promise<{ content: { text?: string }[] }> };
  const tools = new Map<string, Tool>();
  containWorkspaceTools({ registerTool: (tool: { name: string }) => { tools.set(tool.name, tool as unknown as Tool); } } as never,
    workspace, false, true, readableRoots);
  return async (path: string, offset?: number, limit?: number) => {
    const result = await tools.get("read")!.execute("read-record", { path, ...(offset === undefined ? {} : { offset }), ...(limit === undefined ? {} : { limit }) });
    return result.content.map(part => part.text ?? "").join("\n");
  };
}
test("001. A delivery notice shows a subject as its sender wrote it, not as encoded words", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-av10-notice-"));
  const store = new Store(join(root, "runtime.sqlite"));
  try {
    store.transaction(tx => { tx.insertAgent(makeValidAgent("a")); tx.insertAgent(makeValidAgent("b")); });
    const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 64, 24, TEST_VIEW_LIMITS);
    await mail.send(auth("b", ["mail.send"]), "korean", { to: ["a"], subject: "OMA 기능 점검 — 자체 메일", kind: "question", body: "본문" });
    const batch = await mail.prepare(auth("a", []));
    assert.ok(batch);
    assert.match(batch.notice, /subject=OMA 기능 점검 — 자체 메일 kind=question/);
    assert.doesNotMatch(batch.notice, /=\?UTF-8\?/i, "the notice carried the encoded header");
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("002. The complete index is readable at its published record path without a mail alias", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-av10-index-"));
  try {
    const records = join(root, "records"), path = join(records, "mail", "inbox.md");
    mkdirSync(join(records, "mail"), { recursive: true });
    const body = "1. m-00000000-0000-4000-8000-000000000001-0\n2. m-00000000-0000-4000-8000-000000000002-0\n";
    writeFileSync(path, body);
    const read = ordinaryReader(root, [records]);
    assert.equal(await read(path), body);
    await assert.rejects(() => read("/etc/passwd"), /outside the agent workspace/);
    await assert.rejects(() => read("/inbox.md"), /outside the agent workspace/);
    assert.equal(readFileSync(path, "utf8"), body);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("003. A large index is read in complete ordinary-file pages, not cut by a stored-mail bound", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-index-bound-"));
  const previous = process.env.OMA_MAIL_BYTES;
  try {
    const records = join(root, "records"), path = join(records, "inbox.md"); mkdirSync(records);
    const rows = Array.from({ length: 3000 }, (_, n) =>
      `${n + 1}. m-00000000-0000-4000-8000-000000000001-${n}\t/oma/mail/messages/m-00000000-0000-4000-8000-000000000001-${n}.md`);
    const body = rows.join("\n") + "\n", storedBound = 268 * 1024;
    assert.ok(Buffer.byteLength(body) > storedBound);
    writeFileSync(path, body); process.env.OMA_MAIL_BYTES = String(storedBound);
    const read = ordinaryReader(root, [records]), observed: string[] = [];
    for (let offset = 1; offset <= rows.length; offset += 100) {
      const page = await read(path, offset, 100);
      assert.doesNotMatch(page, /truncated/);
      // Discard only display metadata; compare every returned indexed row to
      // the independent full list so no missing/duplicate row can be hidden.
      observed.push(...page.split("\n").filter(line => /^\d+\. m-/.test(line)));
    }
    assert.deepEqual(observed, rows, "each indexed row is reachable once, including rows beyond the stored-mail bound");
    assert.equal(readFileSync(path, "utf8"), body);
  } finally {
    if (previous === undefined) delete process.env.OMA_MAIL_BYTES; else process.env.OMA_MAIL_BYTES = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("004. The send schema names the wire's own recipient bound, not a lower one", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-send-schema-"));
  try {
    const toolsFor = (): Map<string, { parameters: { properties: { to: { maxItems: number } } } }> => {
      const tools = new Map<string, never>();
      registerOmaTools({ registerTool: (tool: never) => { const t = tool as { name: string }; tools.set(t.name, tool); }, on() {} } as never,
        root, PrincipalChannel.detached());
      return tools as never;
    };
    const previous = { ...process.env };
    try {
      Object.assign(process.env, { OMA_AGENT_HOME: root, OMA_MAIL_ARCHIVE: join(root, "archive"), OMA_SOCKET: join(root, "control.sock"),
        OMA_RECORD_ROOT: join(root, "records"), OMA_ACTOR: "alice", OMA_TOOL_SURFACE: JSON.stringify(collaborationSurface("resident")), OMA_MAIL_ADDRESSES: "64" });
      assert.equal(toolsFor().get("oma_send")!.parameters.properties.to.maxItems, 64,
        "the schema must carry the effective host's 64-recipient bound");
      process.env.OMA_MAIL_ADDRESSES = "7";
      assert.equal(toolsFor().get("oma_send")!.parameters.properties.to.maxItems, 7,
        "the schema did not follow the configured bound");
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
      Object.assign(process.env, previous);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

/** AV23 -- arch §5.1, BATCH-002: the sixth functional run. A Resident's report
 * in Korean reached the Principal as a Base64 body, and a Principal has no
 * shell to decode it with; a Resident did so with `base64 -d`. The read tool is
 * bound to the runtime's own writer: what the pinned MIME adapter stores reads
 * back as the body that was sent, whichever transfer encoding it chose. */
test("005. A message reads back as the body its sender wrote, whatever encoding stored it", async () => {
  const bodies = [
    "short ascii",
    `a line longer than seventy-six characters ${"x".repeat(120)} so the writer must encode it`,
    "한국어 본문입니다.\n두 번째 줄 — 기호와 함께.",
    "equals = signs =3D and trailing space \nnext",
    "mixed 한글 and ascii\n\n\nwith blank lines and emoji 🙂",
    "가".repeat(3000),
  ];
  const encodings = new Set<string>();
  for (const body of bodies) {
    const eml = await buildEml({ from: "a@demo.oma.invalid", to: ["principal@demo.oma.invalid"], replyTo: [], subject: "s", kind: "message",
      contextRevision: null, inReplyTo: null, references: [], messageId: "m-00000000-0000-4000-8000-000000000001-0@demo.oma.invalid", body });
    encodings.add(/^Content-Transfer-Encoding: (.*)$/m.exec(eml.text)?.[1]?.trim() ?? "none");
    const shown = readableMail(eml.text);
    assert.equal(shown.slice(0, shown.indexOf("\r\n\r\n")), eml.text.slice(0, eml.text.indexOf("\r\n\r\n")), "the stored headers were changed");
    assert.equal(shown.slice(shown.indexOf("\r\n\r\n") + 4), body);
  }
  assert.deepEqual([...encodings], ["base64"], "fresh mail preserves exact body bytes");
  // #28: quoted-printable is no longer decoded -- a stored QP body is shown
  // exactly as stored, like any other encoding the reader does not own.
  const legacy = "H: v\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nold =ED=95=9C=EA=B8=80=20\r\nsoft=\r\nline";
  assert.equal(readableMail(legacy), legacy);
  // Nothing is guessed: a body that does not decode exactly is shown as stored.
  for (const stored of ["H: v\r\nContent-Transfer-Encoding: base64\r\n\r\n@@not base64@@", "H: v\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nbad =G1",
    "H: v\r\nContent-Transfer-Encoding: base64\r\n\r\n/w==", "H: v\r\n\r\nno declared encoding"])
    assert.equal(readableMail(stored), stored);
});

test("006. Model registration no longer resolves raw archive reply aliases and preserves both original archives", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-av10-retired-"));
  const previous = { ...process.env };
  try {
    const archive = join(root, "archive"), worker = join(root, "workers");
    mkdirSync(archive); mkdirSync(worker);
    const id = "m-00000000-0000-4000-8000-0000000000aa-0";
    const publicFile = join(archive, `${id}:2,`), workerFile = join(worker, `${id}:2,`);
    writeFileSync(publicFile, "archived copy"); writeFileSync(workerFile, "thread mail");
    Object.assign(process.env, { OMA_AGENT_HOME: root, OMA_MAIL_ARCHIVE: archive,
      OMA_WORKER_ARCHIVE: worker, OMA_SOCKET: join(root, "control.sock"),
      OMA_TOOL_SURFACE: JSON.stringify({ version: 2, defaultMode: "DISABLED", direct: ["oma_mail_reply"], optional: [], disabled: [] }) });
    const names: string[] = [];
    registerOmaTools({ registerTool: (tool: { name: string }) => { names.push(tool.name); } } as never, root);
    assert.deepEqual(names, [], "no legacy mail tool or alias is registered");
    assert.equal("replyPathFor" in modelRegistration, false);
    assert.equal("readableMail" in modelRegistration, false);
    assert.equal(readFileSync(publicFile, "utf8"), "archived copy");
    assert.equal(readFileSync(workerFile, "utf8"), "thread mail");
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    rmSync(root, { recursive: true, force: true });
  }
});

test("007. Ordinary read shows the decoded published body without changing the accepted archive or delivery", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-av23-")), store = new Store(join(root, "runtime.sqlite"));
  try {
    store.transaction(tx => { tx.insertAgent(makeValidAgent("alice")); tx.insertAgent(makeValidAgent("principal")); });
    const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 64, 24, TEST_VIEW_LIMITS);
    const body = "재시작 후에도 이전 작업을 기억합니다.";
    await mail.send(auth("alice", ["mail.send"]), "body", { to: ["principal"], subject: "보고", kind: "result", body });
    const operation = store.getOperation("alice", "body")!, id = messageIdForOperation(operation.id, 0);
    const delivery = store.getDelivery(id, "principal"), archive = join(root, "mail", "archive", "cur", `${id}:2,`);
    const source = readFileSync(archive);
    const views = new CollaborationMailViews(store, mail, root, "demo"); views.publishRecords("principal", [id]);
    const recordRoot = views.rootFor("principal"), path = join(recordRoot, "mail", "messages", `${id}.md`), read = ordinaryReader(root, [recordRoot]);
    assert.equal(await read(path), body);
    await assert.rejects(() => read(archive), /outside the agent workspace/);
    assert.deepEqual(readFileSync(archive), source);
    assert.deepEqual(store.getDelivery(id, "principal"), delivery);
    assert.deepEqual(store.getOperation("alice", "body"), operation);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

/** AV26 -- TUI-011, arch §5.1, INV04: the same run, on the Human's side. The
 * Mail screen found the end of the header block at "\n\n", which the writer's
 * CRLF mail never has: every message's body showed empty. Its own decoder kept
 * the fold's space between adjacent encoded words ("기 억"), and it showed a
 * body with its transfer encoding. The Mail screen now reads through the one
 * owner of how a reader meets a message, and the extension's copy is bound to
 * that owner. */
test("008. The Human's Mail screen shows the subject and body the sender wrote", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-av26-"));
  try {
    const subject = "재시작 후 OMA 결과 기억 확인";
    const body = "재시작 후에도 이전 작업을 기억합니다.\n커밋과 제출도 완료했습니다.";
    const eml = await buildEml({ from: "check-alpha@demo.oma.invalid", to: ["principal@demo.oma.invalid"], replyTo: [], subject, kind: "message",
      contextRevision: null, inReplyTo: null, references: [], messageId: "m-00000000-0000-4000-8000-000000000009-0@demo.oma.invalid", body });
    assert.match(eml.text, /\?=\r\n =\?UTF-8\?B\?/, "the case does not fold the subject into adjacent encoded words");
    const path = join(root, "m-00000000-0000-4000-8000-000000000009-0:2,");
    writeFileSync(path, eml.text);
    const parsed = parseMessage(eml.text);
    assert.equal(parsed.headers["subject"], subject);
    assert.equal(parsed.body.replace(/\r\n/g, "\n").replace(/\n+$/, ""), body);
    assert.equal(readBody(path, 1024 * 1024)?.text.replace(/\r\n/g, "\n").replace(/\n+$/, ""), body, "the Mail screen's body view");
    // Older LF mail still splits at its own blank line.
    assert.equal(parseMessage("Subject: plain\nX-Oma-Kind: message\n\nhello\n").body, "hello\n");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("009. The canonical display and record readers preserve original bytes without an extension mirror", async () => {
  for (const body of ["ascii", `long ${"y".repeat(200)}`, "한국어 본문\n둘째 줄", "a = b =3D c \nnext", "🙂 끝", "\ufeff시작"]) {
    const eml = await buildEml({ from: "a@demo.oma.invalid", to: ["b@demo.oma.invalid"], replyTo: [], subject: "제목", kind: "message",
      contextRevision: null, inReplyTo: null, references: [], messageId: "m-00000000-0000-4000-8000-00000000000a-0@demo.oma.invalid", body });
    assert.equal(decodedMailBody(eml.text), body);
    assert.equal(readableMail(eml.text).split("\r\n\r\n").slice(1).join("\r\n\r\n"), body);
  }
  for (const raw of ["H: v\r\nContent-Transfer-Encoding: base64\r\n\r\n@@", "H: v\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n=ZZ",
    "H: v\r\nContent-Transfer-Encoding: base64\r\n\r\n/w==", "no header block"]) {
    assert.equal(readableMail(raw), raw, "Human display retains unsupported bytes for diagnosis");
    assert.throws(() => decodedMailBody(raw), "a projection cannot label malformed transport as sender body text");
  }
  assert.equal(decodedMailBody("H: v\nContent-Transfer-Encoding: base64\n\n7ZWc6riAIExG"), "한글 LF");
  assert.equal(decodedMailBody("H: v\nContent-Transfer-Encoding: quoted-printable\n\n=ED=95=9C=\n=EA=B8=80"), "한글");
});

test("010. A reader keeps the body's leading U+FEFF and finds the header block's end by the one rule, LF mail included", async () => {
  const eml = await buildEml({ from: "a@demo.oma.invalid", to: ["b@demo.oma.invalid"], replyTo: [], subject: "bom", kind: "message",
    contextRevision: null, inReplyTo: null, references: [], messageId: "m-00000000-0000-4000-8000-00000000000b-0@demo.oma.invalid", body: "\ufeff시작" });
  for (const read of [readableMail]) {
    assert.equal(read(eml.text).split("\r\n\r\n").slice(1).join("\r\n\r\n"), "\ufeff시작", "the sender's U+FEFF was dropped");
    const lf = `Subject: legacy\nContent-Transfer-Encoding: base64\n\n${Buffer.from("한글 본문", "utf8").toString("base64")}`;
    assert.equal(read(lf), "Subject: legacy\nContent-Transfer-Encoding: base64\n\n한글 본문", "LF mail kept its transfer encoding");
  }
});

/** DR6 -- D01, BATCH-002: the twelfth functional run stopped two Residents in
 * a tool call and started them again; the batch was presented again and the
 * session resumed, but both models saw the same Message-ID and dropped the
 * unfinished work as already handled. DR5: the index told readers to `cat` a
 * body its writer stored with a transfer encoding. */
test("011. A batch presented again says so, a new one does not, and the index names the reader", async () => {
  const { REDELIVERY_NOTICE } = await import("@oma/mail/batches");
  const { readFileSync } = await import("node:fs");
  const { runnerViewPathAt } = await import("@oma/domain/paths");
  const root = mkdtempSync(join(tmpdir(), "oma-dr6-"));
  const store = new Store(join(root, "runtime.sqlite"));
  try {
    store.transaction(tx => { tx.insertAgent(makeValidAgent("a")); tx.insertAgent(makeValidAgent("b")); });
    const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 64, 24, TEST_VIEW_LIMITS);
    await mail.send(auth("b", ["mail.send"]), "work", { to: ["a"], subject: "작업", kind: "question", body: "sleep 90 뒤에 commit" });
    const first = await mail.prepare(auth("a", []));
    assert.ok(first);
    assert.equal(first.notice.includes(REDELIVERY_NOTICE), false, "a new batch called itself a redelivery");
    // Not completed: the next preparation is the same batch, presented again.
    const again = await mail.prepare(auth("a", []));
    assert.ok(again);
    assert.equal(again.id, first.id);
    assert.equal(again.notice.split("\n")[0], REDELIVERY_NOTICE);
    assert.match(again.notice, /subject=작업 kind=question/, "the items changed");
    const index = readFileSync(join(runnerViewPathAt(root, "a"), "inbox.md"), "utf8");
    assert.match(index, /oma_mail_read/);
    assert.doesNotMatch(index, /읽기: cat/);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

/** mail-v1 / spec §6: when one batch holds several revisions of a request's
 * review thread, /inbox.md lists the latest in place and names the earlier
 * ones on its row; every message id still appears, and folding touches the
 * derived view only. */
test("012. Mail-v1: the batch index folds thread revisions of one request, keeping every id", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-index-fold-"));
  try {
    const { publishBatchView } = await import("@oma/storage/batch-view");
    const { runnerViewPathAt } = await import("@oma/domain/paths");
    const op = "op-00000000-0000-4000-8000-000000000010";
    const rev0 = "m-00000000-0000-4000-8000-000000000020-0";
    const rev1 = "m-00000000-0000-4000-8000-000000000021-0";
    const rev2 = "m-00000000-0000-4000-8000-000000000022-0";
    const plain = "m-00000000-0000-4000-8000-000000000030-0";
    const meta = (id: string, revision: number) => ({ review: { role: "thread" as const, request: op, name: "merge-deadbeef-0000-4000-8000-000000000000", revision },
      displayPath: `/mail/workers/cur/${id}:2,` });
    const info: Record<string, { review?: unknown; displayPath: string }> = {
      [rev0]: meta(rev0, 0), [rev1]: meta(rev1, 1), [rev2]: meta(rev2, 2),
      [plain]: { displayPath: `/mail/archive/cur/${plain}:2,` },
    };
    const batch = { id: "b-00000000-0000-4000-8000-000000000099", agent: "a", incarnation: 1,
      messageIds: [rev0, rev1, rev2, plain], sessionPath: null, deliveryMode: "followUp" as const,
      notice: "mail", indexPath: "/inbox.md" as const };
    publishBatchView(root, batch as never, renderBatchView(batch as never, TEST_VIEW_LIMITS, (id) => (info[id] ?? null) as never));
    const index = readFileSync(join(runnerViewPathAt(root, "a"), "inbox.md"), "utf8");
    // The latest revision stands in the numbered list; the earlier ones are
    // named on its row instead of rows of their own.
    assert.match(index, /earlier revisions:/, "earlier revisions are named");
    const rows = index.split("\n").filter((line: string) => /^\d+\. /.test(line));
    assert.equal(rows.length, 2, "the thread folds to the latest revision's row, plus the unrelated mail");
    assert.match(rows[0]!, /m-00000000-0000-4000-8000-000000000022-0\t\/mail\/workers\/cur\/m-00000000-0000-4000-8000-000000000022-0:2,/,
      "a workers-audience row shows its real path, not the public archive's");
    assert.match(rows[0]!, /earlier revisions: \/mail\/workers\/cur\/m-00000000-0000-4000-8000-000000000020-0:2,, \/mail\/workers\/cur\/m-00000000-0000-4000-8000-000000000021-0:2,/);
    assert.match(rows[1]!, /m-00000000-0000-4000-8000-000000000030-0/);
    // Every message id still appears exactly once (BATCH-002).
    const represented = [...index.matchAll(/\/mail\/(?:archive|workers)\/cur\/(m-[0-9a-f-]+-\d+):2,/g)].map(match => match[1]);
    assert.equal(represented.length, 4, "the index has exactly one archive reference per message");
    for (const id of [rev0, rev1, rev2, plain]) assert.equal(represented.filter(value => value === id).length, 1, `${id} is represented exactly once`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

/** Contained read-root oracle only. The actual Mail audience/Principal projection
 * oracle is in collaboration-mail-records.test.ts, using original accepted facts. */
test("013. Ordinary Worker record reads do not give a Principal access to raw workers archives or another record root", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-workers-read-"));
  try {
    const workers = join(root, "workers"), workerRecords = join(root, "alice-records"), principalRecords = join(root, "principal-records");
    for (const path of [workers, workerRecords, principalRecords]) mkdirSync(path);
    const id = "m-00000000-0000-4000-8000-000000000042-0", body = "worker-only thread body";
    const eml = await buildEml({ from: "alice@demo.oma.invalid", to: ["residents@demo.oma.invalid"], replyTo: [],
      subject: "review", kind: "message", contextRevision: null, inReplyTo: null, references: [], messageId: `${id}@demo.oma.invalid`, body });
    const raw = join(workers, `${id}:2,`), record = join(workerRecords, `${id}.md`);
    writeFileSync(raw, eml.text); writeFileSync(record, body);
    const worker = ordinaryReader(root, [workerRecords]), principal = ordinaryReader(root, [principalRecords]);
    assert.equal(await worker(record), body);
    for (const path of [record, raw, `/mail/workers/cur/${id}:2,`])
      await assert.rejects(() => principal(path), /outside the agent workspace/);
    await assert.rejects(() => worker(raw), /outside the agent workspace/);
    assert.equal(readFileSync(raw, "utf8"), eml.text);
    assert.equal(readFileSync(record, "utf8"), body);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function frameFixture(name: string, limits: { frameBytes: number; batchMaxMessages: number }) {
  const root = mkdtempSync(join(tmpdir(), name));
  const store = new Store(join(root, "runtime.sqlite"));
  store.transaction(tx => { tx.insertAgent(makeValidAgent("alice")); tx.insertAgent(makeValidAgent("bob")); });
  const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 64, 24, limits);
  return { root, store, mail, close: () => { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

/** AUD-08: a validator-accepted `frameBytes` is a delivery bound, not a trap.
 * Six real mail with 512-byte subjects and `frameBytes = 768` used to make
 * every prepare throw (the notice did not fit the frame), leaving all six
 * permanently pending. The frame now bounds the notice -- item values elide
 * with an explicit marker and unnamed items are counted -- while the manifest
 * and /inbox.md stay complete. */
test("014. A 768-byte frame prepares real mail, re-presents it, and keeps every id readable", async () => {
  const f = frameFixture("oma-aud08-frame-", { frameBytes: 768, batchMaxMessages: 24 });
  const limits = { frameBytes: 768, batchMaxMessages: 24 };
  try {
    for (let index = 0; index < 6; index++)
      await f.mail.send(auth("alice", ["mail.send"]), `frame-${index}`,
        { to: ["bob"], kind: "message", subject: "x".repeat(512), body: "hello" });
    const batch = await f.mail.prepare(auth("bob", []));
    assert.ok(batch, "an accepted frame must prepare real mail instead of refusing it forever");
    assert.equal(batch.messageIds.length, 6, "the frame carries the whole six-message manifest");
    assert.ok(Buffer.byteLength(encodeBatchView(batch, limits)) <= limits.frameBytes, "the published view exceeds the frame");
    assert.match(batch.notice, /^1\. sender=/, "the notice still names the first item");
    assert.match(batch.notice, /subject=\S*…/, "an item value over the bound is elided with a marker");
    assert.match(batch.notice, /… \+\d+ more/, "items the frame cannot name are counted, never silently dropped");
    assert.match(batch.notice, /Full list: \/inbox\.md$/);
    const index = readFileSync(join(runnerViewPathAt(f.root, "bob"), "inbox.md"), "utf8");
    for (const id of batch.messageIds) assert.match(index, new RegExp(id), `${id} missing from the index`);
    assert.equal(f.store.pendingDeliveryCount("bob"), 0, "prepared mail is linked to the batch, not left pending");
    // The same prepared batch presented again must fit too -- DR6's fixed line.
    const again = await f.mail.prepare(auth("bob", []));
    assert.equal(again!.id, batch.id);
    assert.equal(again!.notice.split("\n")[0], REDELIVERY_NOTICE);
    assert.ok(Buffer.byteLength(encodeBatchView(again!, limits)) <= limits.frameBytes, "the redelivered view exceeds the frame");
  } finally { f.close(); }
});

/** AUD-08: when the frame cannot carry the whole selected manifest, prepare
 * pages it and the next prepare serves the rest after the first page
 * completes. No accepted message is dropped, and every page a host publishes
 * is a view the extension can decode. */
test("015. A frame smaller than the manifest pages, and the remaining mail still prepares", async () => {
  const f = frameFixture("oma-aud08-page-", { frameBytes: 768, batchMaxMessages: 24 });
  const limits = { frameBytes: 768, batchMaxMessages: 24 };
  try {
    for (let index = 0; index < 24; index++)
      await f.mail.send(auth("alice", ["mail.send"]), `page-${index}`,
        { to: ["bob"], kind: "message", subject: `page ${index}`, body: "hello" });
    const pages: string[][] = [];
    while (f.store.pendingDeliveryCount("bob") > 0) {
      assert.ok(pages.length < 24, "paging must terminate with bounded batches");
      const batch = await f.mail.prepare(auth("bob", []));
      assert.ok(batch, "a page must prepare");
      assert.ok(batch.messageIds.length > 0 && batch.messageIds.length <= 24);
      assert.ok(Buffer.byteLength(encodeBatchView(batch, limits)) <= limits.frameBytes, "a page that does not fit must page further");
      pages.push(batch.messageIds);
      // The same ledger transition the coordinator commits after a verified receipt.
      f.store.transaction(tx => tx.completeBatch(batch.id, batch.messageIds, "bob", 1, `/sessions/${batch.id}`));
    }
    const delivered = pages.flat();
    assert.ok(pages.length > 1, "a 768-byte frame cannot carry twenty-four ids, so this run must page");
    assert.equal(delivered.length, 24, "every accepted message is delivered by some page");
    assert.equal(new Set(delivered).size, 24, "no message is delivered twice");
  } finally { f.close(); }
});

/** AUD-08: the protocol floor is the codec's own constant, and the mail notice
 * remainder (redelivery line, elision marker, index pointer) must fit inside
 * the allowance it reserves -- at exactly the floor, a one-message batch both
 * prepares and re-presents. */
test("016. The codec frame floor carries one message and its redelivery line", async () => {
  const limits = { frameBytes: MIN_BATCH_VIEW_FRAME_BYTES, batchMaxMessages: 24 };
  const f = frameFixture("oma-aud08-floor-", limits);
  try {
    await f.mail.send(auth("alice", ["mail.send"]), "floor",
      { to: ["bob"], kind: "message", subject: "x".repeat(512), body: "hello" });
    const batch = await f.mail.prepare(auth("bob", []));
    assert.ok(batch, `a frame at the codec floor (${MIN_BATCH_VIEW_FRAME_BYTES} bytes) must prepare`);
    assert.ok(Buffer.byteLength(encodeBatchView(batch, limits)) <= MIN_BATCH_VIEW_FRAME_BYTES);
    const again = await f.mail.prepare(auth("bob", []));
    assert.equal(again!.notice.split("\n")[0], REDELIVERY_NOTICE, "the redelivery line fits the floor");
    assert.ok(Buffer.byteLength(encodeBatchView(again!, limits)) <= MIN_BATCH_VIEW_FRAME_BYTES);
  } finally { f.close(); }
});

test("017. The frame floor preserves direct and public-list fairness", async () => {
  const limits = { frameBytes: MIN_BATCH_VIEW_FRAME_BYTES, batchMaxMessages: 24 };
  const f = frameFixture("oma-aud08-fair-floor-", limits);
  try {
    await f.mail.send(auth("alice", ["mail.send"]), "minimum-direct",
      { to: ["bob"], kind: "message", subject: "x".repeat(512), body: "direct" });
    await f.mail.send(auth("alice", ["mail.send"]), "minimum-list",
      { to: ["residents"], kind: "message", subject: "y".repeat(512), body: "public list" });
    const direct = f.store.getOperation("alice", "minimum-direct");
    const list = f.store.getOperation("alice", "minimum-list");
    assert.ok(direct?.kind === "mail.send" && list?.kind === "mail.send");
    const expected = new Set([direct.plan.message.id, list.plan.message.id]);
    const batch = await f.mail.prepare(auth("bob", []));
    assert.ok(batch);
    assert.deepEqual(new Set(batch.messageIds), expected);
    assert.ok(Buffer.byteLength(encodeBatchView(batch, limits)) <= limits.frameBytes);
    const again = await f.mail.prepare(auth("bob", []));
    assert.ok(again);
    assert.deepEqual(again.messageIds, batch.messageIds);
    assert.ok(Buffer.byteLength(encodeBatchView(again, limits)) <= limits.frameBytes);
  } finally { f.close(); }
});

/** AUD-08/R28: the notice budget is exactly the frame's remainder for the
 * view's fixed fields -- the largest escaped notice JSON the codec still
 * encodes, and one byte less than what would overflow it. */
test("018. The notice budget is the frame's exact remainder", () => {
  const batch = { id: "b-00000000-0000-4000-8000-000000000001", agent: "bob", incarnation: 1,
    deliveryMode: "followUp" as const, messageIds: ["m-00000000-0000-4000-8000-000000000002-0"] };
  const limits = { frameBytes: 400, batchMaxMessages: 24 };
  const budget = batchViewNoticeBudget(batch, limits);
  assert.ok(budget !== null);
  const fits = { ...batch, notice: "x".repeat(budget! - 2) };
  assert.ok(Buffer.byteLength(JSON.stringify(fits)) <= limits.frameBytes, "the budget does not fill the frame's remainder");
  const overflows = { ...batch, notice: "x".repeat(budget! - 1) };
  assert.ok(Buffer.byteLength(JSON.stringify(overflows)) > limits.frameBytes, "the budget overstates the room the frame leaves");
});
