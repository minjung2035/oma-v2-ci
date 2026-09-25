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
import { registerOmaTools } from "../src/extension/mail-tools.js";
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
