import {renderBatchView} from "@oma/mail/batch-view";
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
import { readableMail, registerOmaTools, replyPathFor } from "@oma/extension/mail-tools";
import { buildEml } from "@oma/mail/serialize";
import { readableMail as runtimeReadableMail } from "@oma/mail/display";
import { parseMessage, readBody } from "#oma-test/app/application/mail";
import { PrincipalChannel } from "@oma/extension/principal-channel";
import { makeValidAgent } from "./fixtures/spec.js";
import { TEST_VIEW_LIMITS } from "./fixtures/limits.js";

function auth(actor: string, caps: Capability[]): AuthContext {
  return { actor, incarnation: 1, role: "resident", channel: "actor", capabilities: new Set(caps),
    peer: { pid: 1, uid: 1000, gid: 1000 } };
}

test("AV10 / BATCH-002: a delivery notice shows a subject as its sender wrote it, not as encoded words", async () => {
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

test("AV10 / BATCH-002: the index a notice points to, /inbox.md, is read through the mail tool where it is no file", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-av10-index-"));
  try {
    const view = join(root, "view");
    mkdirSync(view);
    writeFileSync(join(view, "inbox.md"), "1. m-00000000-0000-4000-8000-000000000001-0\n2. m-00000000-0000-4000-8000-000000000002-0\n");
    const tools = new Map<string, { execute: (id: string, params: Record<string, unknown>) => Promise<{ content: { text: string }[] }> }>();
    const previous = { ...process.env };
    Object.assign(process.env, { OMA_CLI_PATH: "/nonexistent/cli.js", OMA_AGENT_HOME: root, OMA_MAIL_ARCHIVE: join(root, "archive"),
      OMA_SOCKET: join(root, "control.sock"), OMA_BATCH_VIEW: view });
    try {
      registerOmaTools({ registerTool: (tool: never) => { const t = tool as { name: string }; tools.set(t.name, tool); } } as never, root, PrincipalChannel.detached());
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
      Object.assign(process.env, previous);
    }
    const index = await tools.get("oma_mail_read")!.execute("t", { messageId: "/inbox.md" });
    assert.match(index.content[0]!.text, /000000000002-0/, "the full index was not readable");
    // Only that one name: any other path is still an archive message or nothing.
    await assert.rejects(() => tools.get("oma_mail_read")!.execute("t", { messageId: "/etc/passwd" }), /message id or canonical archive path/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("P0 / BATCH-002: the index is not a stored message -- an index past the mail bound still reads whole", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-index-bound-"));
  try {
    const view = join(root, "view");
    mkdirSync(view);
    // A batch that lists three thousand messages: the index is derived from
    // the batch parameters, not from the bound on a stored mail file. A stored
    // bound sized for a small body must not refuse it.
    const rows = Array.from({ length: 3000 }, (_, n) =>
      `${n + 1}. m-00000000-0000-4000-8000-000000000001-${n}\t/mail/archive/cur/m-00000000-0000-4000-8000-000000000001-${n}:2,`);
    const body = `# inbox — a\n\n${rows.join("\n")}\n`;
    writeFileSync(join(view, "inbox.md"), body);
    const storedBound = 256 * 1024 + 3 * 4096 + 3 * Math.ceil((3 * 4096) / 73) + 2; // ~268 KiB for a 4 KiB body
    assert.ok(Buffer.byteLength(body) > storedBound, "the fixture index must exceed a stored-message bound");
    const tools = new Map<string, { execute: (id: string, params: Record<string, unknown>) => Promise<{ content: { text: string }[] }> }>();
    const previous = { ...process.env };
    Object.assign(process.env, { OMA_CLI_PATH: "/nonexistent/cli.js", OMA_AGENT_HOME: root, OMA_MAIL_ARCHIVE: join(root, "archive"),
      OMA_SOCKET: join(root, "control.sock"), OMA_BATCH_VIEW: view,
      OMA_MAIL_BYTES: String(storedBound), OMA_BATCH_MAX_MESSAGES: "3000" });
    try {
      registerOmaTools({ registerTool: (tool: never) => { const t = tool as { name: string }; tools.set(t.name, tool); } } as never, root, PrincipalChannel.detached());
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
      Object.assign(process.env, previous);
    }
    const index = await tools.get("oma_mail_read")!.execute("t", { messageId: "/inbox.md" });
    assert.equal(index.content[0]!.text, body, "the index was refused or cut by the stored-message bound");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("P0 / INV09: the send schema names the wire's own recipient bound, not a lower one", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-send-schema-"));
  try {
    const toolsFor = (): Map<string, { parameters: { properties: { to: { maxItems: number } } } }> => {
      const tools = new Map<string, never>();
      registerOmaTools({ registerTool: (tool: never) => { const t = tool as { name: string }; tools.set(t.name, tool); } } as never,
        root, PrincipalChannel.detached());
      return tools as never;
    };
    const previous = { ...process.env };
    try {
      Object.assign(process.env, { OMA_AGENT_HOME: root, OMA_MAIL_ARCHIVE: join(root, "archive"), OMA_SOCKET: join(root, "control.sock") });
      delete process.env.OMA_MAIL_ADDRESSES;
      assert.equal(toolsFor().get("oma_mail_send")!.parameters.properties.to.maxItems, 64,
        "the schema defaulted below the wire's 64-recipient bound");
      process.env.OMA_MAIL_ADDRESSES = "7";
      assert.equal(toolsFor().get("oma_mail_send")!.parameters.properties.to.maxItems, 7,
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
test("AV23 / arch §5.1, BATCH-002: a message reads back as the body its sender wrote, whatever encoding stored it", async () => {
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

test("AV-10: a reply to mail that lives only in the worker archive resolves that mount", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-av10-"));
  const previous = process.env.OMA_WORKER_ARCHIVE;
  try {
    const archive = join(root, "archive"); const worker = join(root, "workers");
    mkdirSync(archive, { recursive: true }); mkdirSync(worker, { recursive: true });
    const id = "m-00000000-0000-4000-8000-0000000000aa-0";
    // Present only in the worker-only archive: the reply path must find it there.
    writeFileSync(join(worker, `${id}:2,`), "thread mail");
    process.env.OMA_WORKER_ARCHIVE = worker;
    assert.equal(replyPathFor(archive, id), join(worker, `${id}:2,`));
    // The normal archive still wins when the message is in both.
    writeFileSync(join(archive, `${id}:2,`), "archived copy");
    assert.equal(replyPathFor(archive, id), join(archive, `${id}:2,`));
    // And in neither mount the primary path is kept for the CLI to report.
    const missing = "m-00000000-0000-4000-8000-0000000000bb-0";
    assert.equal(replyPathFor(archive, missing), join(archive, `${missing}:2,`));
    // Without the worker mount (a Principal's engine) only the archive resolves.
    delete process.env.OMA_WORKER_ARCHIVE;
    assert.equal(replyPathFor(archive, id), join(archive, `${id}:2,`));
    assert.equal(replyPathFor(archive, missing), join(archive, `${missing}:2,`));
  } finally {
    if (previous === undefined) delete process.env.OMA_WORKER_ARCHIVE; else process.env.OMA_WORKER_ARCHIVE = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("AV23 / BATCH-002: the read tool shows the decoded body of an archived message", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-av23-"));
  try {
    const archive = join(root, "archive");
    mkdirSync(archive);
    const id = "m-00000000-0000-4000-8000-000000000007-0";
    const eml = await buildEml({ from: "a@demo.oma.invalid", to: ["principal@demo.oma.invalid"], replyTo: [], subject: "보고", kind: "result",
      contextRevision: null, inReplyTo: null, references: [], messageId: `${id}@demo.oma.invalid`, body: "재시작 후에도 이전 작업을 기억합니다." });
    writeFileSync(join(archive, `${id}:2,`), eml.text);
    const tools = new Map<string, { execute: (id: string, params: Record<string, unknown>) => Promise<{ content: { text: string }[] }> }>();
    const previous = { ...process.env };
    Object.assign(process.env, { OMA_CLI_PATH: "/nonexistent/cli.js", OMA_AGENT_HOME: root, OMA_MAIL_ARCHIVE: archive, OMA_SOCKET: join(root, "control.sock") });
    try {
      registerOmaTools({ registerTool: (tool: never) => { const t = tool as { name: string }; tools.set(t.name, tool); } } as never, root, PrincipalChannel.detached());
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
      Object.assign(process.env, previous);
    }
    const read = await tools.get("oma_mail_read")!.execute("t", { messageId: id });
    assert.match(read.content[0]!.text, /재시작 후에도 이전 작업을 기억합니다\./);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

/** AV26 -- TUI-011, arch §5.1, INV04: the same run, on the Human's side. The
 * Mail screen found the end of the header block at "\n\n", which the writer's
 * CRLF mail never has: every message's body showed empty. Its own decoder kept
 * the fold's space between adjacent encoded words ("기 억"), and it showed a
 * body with its transfer encoding. The Mail screen now reads through the one
 * owner of how a reader meets a message, and the extension's copy is bound to
 * that owner. */
test("AV26 / TUI-011, arch §5.1: the Human's Mail screen shows the subject and body the sender wrote", async () => {
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

test("AV26 / INV04, PI-001: the extension's reader is the runtime's, on what the writer stores and on what it cannot undo", async () => {
  const cases: string[] = [];
  for (const body of ["ascii", `long ${"y".repeat(200)}`, "한국어 본문\n둘째 줄", "a = b =3D c \nnext", "🙂 끝"])
    cases.push((await buildEml({ from: "a@demo.oma.invalid", to: ["b@demo.oma.invalid"], replyTo: [], subject: "제목", kind: "message",
      contextRevision: null, inReplyTo: null, references: [], messageId: "m-00000000-0000-4000-8000-00000000000a-0@demo.oma.invalid", body })).text);
  cases.push("H: v\r\nContent-Transfer-Encoding: base64\r\n\r\n@@", "H: v\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n=ZZ",
    "H: v\r\nContent-Transfer-Encoding: base64\r\n\r\n/w==", "H: v\r\n\r\nplain", "no header block",
    // P0V-45: a body that begins with U+FEFF, and older LF mail with a transfer encoding.
    `H: v\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from("\ufeff시작", "utf8").toString("base64")}`,
    `H: v\nContent-Transfer-Encoding: base64\n\n${Buffer.from("한글 LF", "utf8").toString("base64")}`,
    "H: v\nX-Fold: a\n\tb\nContent-Transfer-Encoding: quoted-printable\n\n=ED=95=9C=\n=EA=B8=80");
  for (const text of cases) assert.equal(readableMail(text), runtimeReadableMail(text));
});

test("P0V-45 / N22, P0-2: a reader keeps the body's leading U+FEFF and finds the header block's end by the one rule, LF mail included", async () => {
  const eml = await buildEml({ from: "a@demo.oma.invalid", to: ["b@demo.oma.invalid"], replyTo: [], subject: "bom", kind: "message",
    contextRevision: null, inReplyTo: null, references: [], messageId: "m-00000000-0000-4000-8000-00000000000b-0@demo.oma.invalid", body: "\ufeff시작" });
  for (const read of [readableMail, runtimeReadableMail]) {
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
test("DR6 / D01, BATCH-002: a batch presented again says so, a new one does not, and the index names the reader", async () => {
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
test("mail-v1: the batch index folds thread revisions of one request, keeping every id", async () => {
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
    for (const id of [rev0, rev1, rev2, plain]) assert.equal(index.split(id).length - 1 >= 1, true, `${id} is named`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

/** mail-v1: worker-only review mail lives in the workers archive. A Resident
 * engine (OMA_WORKER_ARCHIVE set) reaches it by id, by the sandbox's canonical
 * /mail/workers/cur path and by the path its own environment shows; a
 * Principal engine has no such root and the workers path is no name at all. */
test("mail-v1: a Resident reads worker-audience mail by id and by its workers path; a Principal refuses the name", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-workers-read-"));
  try {
    const archive = join(root, "archive"), workers = join(root, "workers");
    mkdirSync(archive, { recursive: true }); mkdirSync(workers, { recursive: true });
    const id = "m-00000000-0000-4000-8000-000000000042-0";
    const eml = await buildEml({ from: "alice@demo.oma.invalid", to: ["residents@demo.oma.invalid"], replyTo: [],
      subject: "review", kind: "message", contextRevision: null, inReplyTo: null, references: [],
      messageId: `${id}@demo.oma.invalid`, body: "worker-only thread body" });
    writeFileSync(join(workers, `${id}:2,`), eml.text);
    const tools = new Map<string, { execute: (id: string, params: Record<string, unknown>) => Promise<{ content: { text: string }[] }> }>();
    const previous = { ...process.env };
    Object.assign(process.env, { OMA_CLI_PATH: "/nonexistent/cli.js", OMA_AGENT_HOME: root, OMA_MAIL_ARCHIVE: archive,
      OMA_WORKER_ARCHIVE: workers, OMA_SOCKET: join(root, "control.sock") });
    try {
      registerOmaTools({ registerTool: (tool: never) => { const t = tool as { name: string }; tools.set(t.name, tool); } } as never, root, PrincipalChannel.detached());
      const read = tools.get("oma_mail_read")!;
      for (const name of [id, `/mail/workers/cur/${id}:2,`, `${workers}/${id}:2,`]) {
        const found = await read.execute("t", { messageId: name });
        assert.match(found.content[0]!.text, /worker-only thread body/, `not readable as ${name}`);
      }
      // The public archive stays the first read: a same-named file wins there.
      await assert.rejects(() => read.execute("t", { messageId: `/mail/workers/${id}:2,` }), /message id or canonical archive path/);
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
      Object.assign(process.env, previous);
    }
    // A Principal engine has no worker archive: the workers path is unknown.
    const principalTools = new Map<string, { execute: (id: string, params: Record<string, unknown>) => Promise<{ content: { text: string }[] }> }>();
    const before = { ...process.env };
    Object.assign(process.env, { OMA_CLI_PATH: "/nonexistent/cli.js", OMA_AGENT_HOME: root, OMA_MAIL_ARCHIVE: archive,
      OMA_SOCKET: join(root, "control.sock") });
    try {
      registerOmaTools({ registerTool: (tool: never) => { const t = tool as { name: string }; principalTools.set(t.name, tool); } } as never, root, PrincipalChannel.detached());
      await assert.rejects(() => principalTools.get("oma_mail_read")!.execute("t", { messageId: `/mail/workers/cur/${id}:2,` }),
        /message id or canonical archive path/);
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
      Object.assign(process.env, before);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
