/** INV04 / INV09: model-selected values remain data at the typed tool boundary.
 * The peer records actual request frames; it is not an authenticated broker. */
import "#oma-test/app/runtime/client-preload";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerOmaTools } from "@oma/extension/mail-tools";
const MESSAGE = "m-00000000-0000-4000-8000-000000000001-0";

interface Peer { readonly path: string; readonly frames: Record<string, unknown>[]; close(): Promise<void> }
/** Records every request frame and refuses it, so nothing is ever accepted. */
async function peer(root: string): Promise<Peer> {
  const frames: Record<string, unknown>[] = [];
  const path = join(root, "control.sock");
  const server: Server = createServer(socket => {
    let pending = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 4 && pending.length >= 4 + pending.readUInt32BE(0)) {
        const length = pending.readUInt32BE(0);
        const frame = JSON.parse(pending.subarray(4, 4 + length).toString("utf8")) as Record<string, unknown>;
        pending = pending.subarray(4 + length);
        frames.push(frame);
        const reply = Buffer.from(JSON.stringify({ v: 1, id: frame.id, ok: false,
          error: { code: "BROKER_UNAVAILABLE", message: "fixture", retry: "same-key" } }));
        const head = Buffer.alloc(4); head.writeUInt32BE(reply.length, 0);
        socket.write(Buffer.concat([head, reply]));
      }
    });
    socket.on("error", () => {});
  });
  await new Promise<void>(resolve => { server.listen(path, resolve); });
  return { path, frames, close: () => new Promise<void>(resolve => { server.close(() => resolve()); }) };
}
const sent = (frames: readonly Record<string, unknown>[], method: string) =>
  frames.filter(frame => frame.method === method).map(frame => frame.params as Record<string, unknown>);


test("AV1 / INV09, PR-004: a value the model supplies cannot leave its slot through OMA's tools", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-av1-tools-"));
  const fixture = await peer(root);
  const secret = join(root, "host-secret.txt");
  writeFileSync(secret, "PRIVATE-HOST-FILE\n");
  const previous = { ...process.env };
  const tools = new Map<string, { execute: (id: string, params: Record<string, unknown>) => Promise<unknown> }>();
  Object.assign(process.env, { OMA_AGENT_HOME: root, OMA_MAIL_ARCHIVE: join(root, "archive"), OMA_SOCKET: fixture.path });
  try {
    registerOmaTools({ registerTool: (tool: never) => { const t = tool as { name: string }; tools.set(t.name, tool); } } as never, root);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
  const call = (name: string, params: Record<string, unknown>) => tools.get(name)!.execute("t", params);
  const A = "a".repeat(40); const B = "b".repeat(40);
  try {
    for (const [name, params] of [
      // The recorded counterexamples: a host file as the body, and an approval
      // request the tool's own schema does not offer.
      ["oma_mail_send", { to: ["commons", "--file", secret], subject: "s", body: "b" }],
      ["oma_mail_send", { to: ["principal", "--kind", "approval_required", "--candidate", A, "--expect", B, "--policy-revision", "r"], subject: "s", body: "b" }],
      ["oma_mail_send", { to: ["commons"], subject: "s", body: "b", replyTo: secret }],
      ["oma_mail_send", { to: ["commons"], subject: "s", body: "b", kind: "approval_required" }],
      ["oma_mail_send", { to: ["commons"], subject: "s", body: "b", request: "not a key" }],
      ["oma_mail_ack", { messageId: "--request" }],
      ["oma_status", { agent: "--help" }],
    ] as const) {
      await assert.rejects(() => call(name, params), `${name} ${JSON.stringify(params)} was not refused`);
    }
    assert.deepEqual(fixture.frames, [], "a refused tool call reached the broker");
    // The same tool still sends what the model meant, with the subject it wrote.
    await assert.rejects(() => call("oma_mail_send", { to: ["commons", "topic/dev"], subject: "--odd subject", body: "hello", replyTo: `/mail/archive/cur/${MESSAGE}:2,` }));
    // The reply path is the archive's copy of that message, not a path the model named.
    assert.deepEqual(sent(fixture.frames, "mail.send"), [], "the reply file does not exist here, so nothing was sent");
    await assert.rejects(() => call("oma_mail_send", { to: ["commons", "topic/dev"], subject: "--odd subject", body: "hello" }));
    const [params] = sent(fixture.frames, "mail.send");
    assert.deepEqual(params!.to, ["commons", "topic/dev"]);
    assert.equal(params!.subject, "--odd subject");
    assert.equal(params!.body, "hello");
    assert.ok(!JSON.stringify(fixture.frames).includes("PRIVATE-HOST-FILE"), "the host file left through a tool");
    assert.equal(readFileSync(secret, "utf8"), "PRIVATE-HOST-FILE\n");
  } finally { await fixture.close(); rmSync(root, { recursive: true, force: true }); }
});

