/** AV8 -- FS-005, INV10 and INV12 applied to the CLI's local files.
 *
 * WP26 recorded CLI effects as "no-follow reads". The bundle and context reads
 * were; the file a command is given with `--file` or `--reply` was read by
 * following a link and without a bound, so a link named as the body put the
 * file it pointed at in the request, and a device such as /dev/zero was read
 * until memory ran out. These run the real CLI against a socket peer that
 * records every frame: a refusal must come before anything is sent.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildEml } from "@oma/mail/serialize";

const CLI = fileURLToPath(new URL("../../apps/oma/dist/cli.js", import.meta.url));

interface Peer { readonly path: string; readonly frames: Record<string, unknown>[]; close(): Promise<void> }
/** Records every request frame and reports an unavailable fixture, never success. */
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
/** Asynchronous, because the socket peer answers from this same event loop. */
function cli(root: string, socket: string, args: string[]): Promise<{ status: number | null; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: root, stdio: ["ignore", "ignore", "pipe"],
      env: { PATH: "/usr/bin:/bin", HOME: root, OMA_SOCKET: socket } });
    let stderr = "";
    child.stderr.setEncoding("utf8"); child.stderr.on("data", chunk => { stderr += chunk; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    child.on("close", status => { clearTimeout(timer); resolve({ status, stderr }); });
  });
}

test("AV8 / FS-005, INV10: a file given to the CLI is read only if it is a regular file, not through a link, and within a request frame", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-av8-"));
  const fixture = await peer(root);
  try {
    const secret = join(root, "secret.txt");
    writeFileSync(secret, "a host file the link points at\n");
    const link = join(root, "body.txt");
    symlinkSync(secret, link);
    const linked = await cli(root, fixture.path, ["send", "--subject", "s", "--file", link, "--", "commons"]);
    assert.equal(linked.status, 2);
    assert.match(linked.stderr, /a link is not followed/);

    const device = await cli(root, fixture.path, ["send", "--subject", "s", "--file", "/dev/zero", "--", "commons"]);
    assert.equal(device.status, 2);
    assert.match(device.stderr, /not a regular file/);

    const large = join(root, "large.txt");
    writeFileSync(large, "x".repeat(256 * 1024 + 1));
    const oversized = await cli(root, fixture.path, ["send", "--subject", "s", "--file", large, "--", "commons"]);
    assert.equal(oversized.status, 2);
    assert.match(oversized.stderr, /larger than a request can carry/);

    const reply = await cli(root, fixture.path, ["send", "--reply", link, "--", "commons"]);
    assert.equal(reply.status, 2);
    assert.match(reply.stderr, /a link is not followed/);
    assert.equal(fixture.frames.length, 0, "a refused file still reached the broker");

    // The control: a regular file within the frame is read and sent as the body.
    const plain = join(root, "plain.txt");
    writeFileSync(plain, "the body\n");
    await cli(root, fixture.path, ["send", "--subject", "s", "--file", plain, "--", "commons"]);
    assert.deepEqual(fixture.frames.map(frame => frame.method), ["mail.send", "operation.get"]);
    assert.equal((fixture.frames[0]!.params as { body?: string }).body, "the body\n");
    assert.equal((fixture.frames[1]!.params as { key?: string }).key, fixture.frames[0]!.request);
  } finally {
    await fixture.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("P0V-63 / R08: a reply to a stored message larger than a request reads its headers and is sent", async () => {
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
    const body = join(root, "reply.txt");
    writeFileSync(body, "short answer\n");
    const sent = await cli(root, fixture.path, ["send", "--reply", original, "--subject", "re", "--file", body, "--request", "reply-large", "--", "commons"]);
    assert.doesNotMatch(sent.stderr, /larger than a request can carry/);
    const frame = fixture.frames.find(entry => entry.method === "mail.send");
    assert.ok(frame, `nothing was sent: ${sent.stderr}`);
    assert.equal((frame.params as { replyToMessage?: string }).replyToMessage, id);
  } finally { await fixture.close(); rmSync(root, { recursive: true, force: true }); }
});

test("P0V-62 / R07, P0-4: a long answer reaches a reader that is slow to take it, whole, before the CLI exits", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-cli-output-"));
  const agents = Array.from({ length: 6000 }, (_, index) => ({ agent: `worker-${String(index).padStart(5, "0")}`, desired: "enabled",
    activeState: "active", subState: "running", unitResult: "success", execMainStatus: 0, pending: 0, preparedBatches: 0,
    reason: null, runnerObservedAtMs: null }));
  const answer = { observedAtMs: 1, agents };
  const expected = `${JSON.stringify(answer)}\n`;
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
      const child = spawn(process.execPath, [CLI, "status"], { cwd: root, stdio: ["ignore", "pipe", "ignore"],
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
    assert.equal(result.stdout.length, expected.length, "the answer was cut off before the CLI exited");
    assert.equal(result.stdout, expected);
  } finally { await new Promise<void>(resolve => { server.close(() => resolve()); }); rmSync(root, { recursive: true, force: true }); }
});
