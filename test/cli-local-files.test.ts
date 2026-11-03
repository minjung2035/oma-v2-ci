import { createServer, type Server } from "node:net";
/** FS-005 / INV10: typed client input effects reject unsafe local files
 * before sending, and large answers remain available in full. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { refusingPeer as peer } from "./fixtures/refusing-peer.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clientCall, clientProcessArgs } from "./fixtures/client-process.js";
import { buildEml } from "@oma/mail/serialize";



/** Asynchronous, because the socket peer answers from this same event loop. */
function invoke(root: string, socket: string, expression: string): Promise<{ status: number | null; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, clientProcessArgs(expression), { cwd: root, stdio: ["ignore", "ignore", "pipe"],
      env: { PATH: "/usr/bin:/bin", HOME: root, OMA_SOCKET: socket } });
    let stderr = "";
    child.stderr.setEncoding("utf8"); child.stderr.on("data", chunk => { stderr += chunk; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    child.on("close", status => { clearTimeout(timer); resolve({ status, stderr }); });
  });
}

test("001. Reply files must be regular, no-follow, and header-bounded", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-av8-"));
  const fixture = await peer(root);
  try {
    const secret = join(root, "secret.txt");
    writeFileSync(secret, "a host file the link points at\n");
    const link = join(root, "body.txt");
    symlinkSync(secret, link);
    const linked = await invoke(root, fixture.path, clientCall("replyMail", { replyFile: link, subject: "s", body: "" }, "linked"));
    assert.equal(linked.status, 2);
    assert.match(linked.stderr, /a link is not followed/);

    const device = await invoke(root, fixture.path, clientCall("replyMail", { replyFile: "/dev/zero", subject: "s", body: "" }, "device"));
    assert.equal(device.status, 2);
    assert.match(device.stderr, /not a regular file/);

    const large = join(root, "large.txt");
    writeFileSync(large, "x".repeat(256 * 1024 + 1));
    const oversized = await invoke(root, fixture.path, clientCall("replyMail", { replyFile: large, subject: "s", body: "" }, "oversized"));
    assert.equal(oversized.status, 2);
    assert.equal(fixture.frames.length, 0, "a refused file still reached the broker");

    // Inline body text is data; it does not name a local input file.
    await invoke(root, fixture.path, clientCall("sendMail", { to: ["commons"], subject: "s", body: "the body\n", kind: "message" }, "plain"));
    assert.deepEqual(fixture.frames.map(frame => frame.method), ["mail.send", "operation.get"]);
    assert.equal((fixture.frames[0]!.params as { body?: string }).body, "the body\n");
    assert.equal((fixture.frames[1]!.params as { key?: string }).key, fixture.frames[0]!.request);
  } finally {
    await fixture.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("002. A reply to a stored message larger than a request reads its headers and is sent", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-reply-large-"));
  const fixture = await peer(root);
  try {
    // A body within the default 256 KiB body limit whose stored (encoded) form
    // is larger than a request frame: accepted, delivered, stored.
    const id = "m-00000000-0000-4000-8000-000000000063-0";
    const eml = await buildEml({ from: "a@demo.oma.invalid", to: ["principal@demo.oma.invalid"], replyTo: [], subject: "large",
      kind: "message", contextRevision: null, inReplyTo: null, references: [], messageId: `${id}@demo.oma.invalid`, body: "한".repeat(70_000) });
    assert.ok(eml.bytes > 256 * 1024, "the fixture is not larger than a request");
    const original = join(root, `${id}:2,`);
    writeFileSync(original, eml.text);
    const sent = await invoke(root, fixture.path, clientCall("replyMail", { replyFile: original, subject: "re", body: "short answer\n", to: ["commons"] }, "reply-large"));
    assert.doesNotMatch(sent.stderr, /larger than a request can carry/);
    const frame = fixture.frames.find(entry => entry.method === "mail.send");
    assert.ok(frame, `nothing was sent: ${sent.stderr}`);
    assert.equal((frame.params as { replyToMessage?: string }).replyToMessage, id);
  } finally { await fixture.close(); rmSync(root, { recursive: true, force: true }); }
});

test("003. A large answer has a marked preview and a complete durable output", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-cli-output-"));
  const agents = Array.from({ length: 6000 }, (_, index) => ({ agent: `worker-${String(index).padStart(5, "0")}`, desired: "enabled",
    activeState: "active", subState: "running", unitResult: "success", execMainStatus: 0, pending: 0, preparedBatches: 0,
    reason: null, runnerObservedAtMs: null }));
  const answer = { observedAtMs: 1, agents,
    creation: { capability: false, childProfile: null, childHasMailSend: false, observedAtMs: 1, maxWorkers: 6000, workerCount: 6000 } };
  const expected = JSON.stringify(answer);
  const socket = join(root, "status.sock");
  const server: Server = createServer(connection => {
    let pending = Buffer.alloc(0);
    connection.on("data", (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      if (pending.length < 4 || pending.length < 4 + pending.readUInt32BE(0)) return;
      const frame = JSON.parse(pending.subarray(4, 4 + pending.readUInt32BE(0)).toString("utf8")) as { id: string };
      const reply = Buffer.from(JSON.stringify({ v: 1, id: frame.id, ok: true, result: answer }));
      const head = Buffer.alloc(4); head.writeUInt32BE(reply.length, 0);
      connection.write(Buffer.concat([head, reply]));
    });
    connection.on("error", () => {});
  });
  await new Promise<void>(resolve => { server.listen(socket, resolve); });
  try {
    assert.ok(expected.length > 1024 * 1024, "the answer is not long enough to fill the pipe");
    const result = await new Promise<{ status: number | null; stdout: string }>(resolve => {
      const child = spawn(process.execPath, clientProcessArgs(clientCall("queryText", "status.get", {})), { cwd: root, stdio: ["ignore", "pipe", "ignore"],
        env: { PATH: "/usr/bin:/bin", HOME: root, OMA_SOCKET: socket, OMA_FRAME_BYTES: String(4 * 1024 * 1024) } });
      const chunks: Buffer[] = []; let status: number | null = null; let ended = false;
      const settle = (): void => { if (ended && status !== null) resolve({ status, stdout: Buffer.concat(chunks).toString("utf8") }); };
      // The reader takes nothing for a while, as a busy parent would.
      child.stdout.pause();
      setTimeout(() => { child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk)); child.stdout.resume(); }, 400);
      child.stdout.on("end", () => { ended = true; settle(); });
      child.on("exit", code => { status = code; settle(); });
    });
    assert.equal(result.status, 0);
    const preview = result.stdout.match(/\[preview\] the complete (\d+)-byte answer is at (.+)$/);
    assert.ok(preview, "oversized output must be explicitly marked with its complete file");
    assert.equal(Number(preview[1]), Buffer.byteLength(expected));
    assert.equal(readFileSync(preview[2]!, "utf8"), expected);
  } finally { await new Promise<void>(resolve => { server.close(() => resolve()); }); rmSync(root, { recursive: true, force: true }); }
});
