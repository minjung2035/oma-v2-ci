/** P0V-103, P0V-104 (seventh review F-02, F-03): a declared stream is
 * received by one owner, whose sink's failures end that stream and nothing
 * else; an archive is sealed as it arrives and published only whole. */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, connect, type Server, type Socket } from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { receiveDeclared } from "#oma-test/app/platform/stream-receive";
import { type StreamSink } from "@oma/contracts/stream";
import { decryptArchive, sealedArchiveSink } from "@oma/platform-mac/archive-crypto";
import { getStream } from "#oma-test/app/platform/host/project";
import { encodeFrame } from "@oma/protocol/frame";
import { PLATFORM_FRAME_BYTES } from "@oma/protocol/host-guest";

const KEY = randomBytes(32);
const sha = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/** A sender on one end of a real socket pair: `send` writes to the other end. */
async function pair(t: import("node:test").TestContext): Promise<{ receiver: Socket; sender: Socket }> {
  const server: Server = createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as { port: number };
  const accepted = new Promise<Socket>(resolve => server.once("connection", resolve));
  const receiver = connect(address.port, "127.0.0.1");
  await new Promise<void>(resolve => receiver.once("connect", () => resolve()));
  const sender = await accepted;
  sender.on("error", () => {});
  t.after(() => { receiver.destroy(); sender.destroy(); server.close(); });
  receiver.pause();
  return { receiver, sender };
}

test("P0V-104 (F-03): a sink that fails mid-stream ends that stream through its promise, and the process goes on", async t => {
  const { receiver, sender } = await pair(t);
  const escaped: unknown[] = [];
  const catcher = (error: unknown): void => { escaped.push(error); };
  process.on("uncaughtException", catcher);
  t.after(() => { process.off("uncaughtException", catcher); });
  const body = randomBytes(256 * 1024);
  let written = 0; let abandoned = 0; let completed = 0;
  const full: StreamSink = {
    write: chunk => {
      if (written + chunk.length > 64 * 1024) throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });
      written += chunk.length;
    },
    complete: () => { completed += 1; },
    abandon: () => { abandoned += 1; },
  };
  const receiving = receiveDeclared(receiver, Buffer.alloc(0), { bytes: body.length, sha256: sha(body) }, full);
  for (let at = 0; at < body.length; at += 16 * 1024) sender.write(body.subarray(at, at + 16 * 1024));
  await assert.rejects(receiving, (error: NodeJS.ErrnoException) => error.code === "ENOSPC");
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(escaped, [], "nothing escaped to the process");
  assert.equal(abandoned, 1);
  assert.equal(completed, 0);
});

test("P0V-104: a stream is completed only when its bytes hash as declared; a short, long or different one is abandoned", async t => {
  const body = randomBytes(100_000);
  for (const [what, declared, send, error] of [
    ["short", { bytes: body.length, sha256: sha(body) }, body.subarray(0, 50_000), /ended before/],
    ["long", { bytes: 1000, sha256: sha(body.subarray(0, 1000)) }, body, /longer than declared/],
    ["different", { bytes: body.length, sha256: sha(randomBytes(10)) }, body, /not what was declared/],
  ] as const) {
    const { receiver, sender } = await pair(t);
    const events: string[] = [];
    const receiving = receiveDeclared(receiver, Buffer.alloc(0), declared,
      { write: () => {}, complete: () => { events.push("complete"); }, abandon: () => { events.push("abandon"); } });
    sender.end(send);
    await assert.rejects(receiving, error, what);
    assert.deepEqual(events, ["abandon"], what);
  }
});

test("P0V-103 (F-02): an archive is published only whole -- an interrupted one leaves no archive and no plain byte, and a retry makes it", async t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-archive-pub-"));
  t.after(() => { rmSync(dir, { recursive: true, force: true }); });
  const tar = Buffer.concat([Buffer.from("PRIVATE-CONTEXT "), randomBytes(300 * 1024)]);
  const name = "demo-0123456789abcdef.omaarchive";
  // The engine's stream stops a third of the way: nothing under the name, nothing left at all.
  const cut = await pair(t);
  const first = receiveDeclared(cut.receiver, Buffer.alloc(0), { bytes: tar.length, sha256: sha(tar) }, sealedArchiveSink(dir, name, KEY));
  cut.sender.end(tar.subarray(0, 100 * 1024));
  await assert.rejects(first, /ended before/);
  assert.deepEqual(readdirSync(dir), [], "no partial archive under the name, and no temporary");
  // The retry of the same key makes it whole, and it opens to the same bytes.
  const whole = await pair(t);
  const second = receiveDeclared(whole.receiver, Buffer.alloc(0), { bytes: tar.length, sha256: sha(tar) }, sealedArchiveSink(dir, name, KEY));
  whole.sender.end(tar);
  await second;
  assert.deepEqual(readdirSync(dir), [name]);
  const sealed = readFileSync(join(dir, name));
  assert.equal(sealed.includes(Buffer.from("PRIVATE-CONTEXT")), false, "the archive is sealed");
  const opened = join(dir, "opened");
  decryptArchive(join(dir, name), opened, KEY);
  assert.ok(readFileSync(opened).equals(tar));
  // A publication never replaces a finished archive under the same name.
  const again = await pair(t);
  const third = receiveDeclared(again.receiver, Buffer.alloc(0), { bytes: 3, sha256: sha(Buffer.from("abc")) }, sealedArchiveSink(dir, name, KEY));
  again.sender.end("abc");
  await third;
  assert.ok(readFileSync(join(dir, name)).equals(sealed), "the finished archive is kept as it was");
  assert.equal(readdirSync(dir).some(entry => entry.endsWith(".partial")), false);
});

test("P0V-104 (X2-01, X2-02): the host's get gives a failing sink's error to its caller and closes the stream", async t => {
  const server: Server = createServer(socket => {
    // The host closes its end on the failure; this end's reset is expected.
    socket.on("error", () => {});
    socket.once("data", () => {
      const body = randomBytes(200 * 1024);
      socket.write(encodeFrame({ v: 1, id: "get", ok: true, result: { bytes: body.length, sha256: sha(body) } }));
      socket.end(body);
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
  t.after(() => { server.close(); });
  const socket = connect((server.address() as { port: number }).port, "127.0.0.1");
  await new Promise<void>(resolve => socket.once("connect", () => resolve()));
  let abandoned = false;
  await assert.rejects(getStream({ socket, rest: Buffer.alloc(0) }, "k", () => ({
    write: () => { throw Object.assign(new Error("EIO: i/o error, write"), { code: "EIO" }); },
    complete: () => {}, abandon: () => { abandoned = true; },
  }), PLATFORM_FRAME_BYTES, "archive"), (error: NodeJS.ErrnoException) => error.code === "EIO");
  assert.equal(abandoned, true);
  assert.equal(socket.destroyed, true);
});
