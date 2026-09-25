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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthContext, Capability } from "../implementation/contracts.js";
import { Store } from "../src/store.js";
import { MailModule } from "../src/mail.js";
import { readableMail, registerOmaTools } from "../src/extension/mail-tools.js";
import { buildEml } from "../src/mail/serialize.js";
import { PrincipalChannel } from "../src/extension/principal-channel.js";
import { makeValidAgent } from "./fixtures/spec.js";
import { TEST_VIEW_LIMITS } from "./fixtures/limits.js";

function auth(actor: string, caps: Capability[]): AuthContext {
  return { actor, incarnation: 1, role: "resident", channel: "actor", capabilities: new Set(caps),
    peer: { pid: 1, uid: 1000, gid: 1000, cgroup: null } };
}

test("AV10 / BATCH-002: a delivery notice shows a subject as its sender wrote it, not as encoded words", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-av10-notice-"));
  const store = new Store(join(root, "runtime.sqlite"));
  try {
    store.transaction(tx => { tx.insertAgent(makeValidAgent("a")); tx.insertAgent(makeValidAgent("b")); });
    const mail = new MailModule({ stateRoot: root, society: "demo" }, store, 64, 24, TEST_VIEW_LIMITS);
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
    assert.equal(shown.slice(shown.indexOf("\r\n\r\n") + 4).replace(/\r\n/g, "\n").replace(/\n+$/, ""), body.replace(/\n+$/, ""));
  }
  assert.ok(encodings.has("base64") && encodings.has("quoted-printable"), `the cases did not reach both encodings: ${[...encodings].join(",")}`);
  // Nothing is guessed: a body that does not decode exactly is shown as stored.
  for (const stored of ["H: v\r\nContent-Transfer-Encoding: base64\r\n\r\n@@not base64@@", "H: v\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nbad =G1",
    "H: v\r\nContent-Transfer-Encoding: base64\r\n\r\n/w==", "H: v\r\n\r\nno declared encoding"])
    assert.equal(readableMail(stored), stored);
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
