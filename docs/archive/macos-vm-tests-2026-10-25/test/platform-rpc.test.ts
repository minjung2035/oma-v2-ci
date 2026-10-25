/** DR27, P0-4/P0-5, MAC-210/241: a transport observation ends without
 * inventing a request result, and hands off only the bytes it actually read. */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { connect, createServer, Socket } from "node:net";
import { once } from "node:events";
import fs, { mkdtempSync, rmSync, writeFileSync, renameSync, openSync, fstatSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { encodeFrame } from "@oma/protocol/frame";
import { StoreError } from "@oma/domain/errors";
import { FramedPeer, connectSocket, readLeadingFrame, readLeadingResponse } from "#oma-test/app/platform/rpc";
import { PlatformError } from "@oma/protocol/host-errors";
import { syncBuiltinESMExports } from "node:module";
import { borrowedFileRange } from "#oma-test/app/platform/stream-source";
import { receiveDeclared } from "#oma-test/app/platform/stream-receive";
import { serveRequests } from "#oma-test/app/platform/rpc-server";
import { serveStream } from "#oma-test/app/platform/guest/stream";
import { RequestLedger } from "#oma-test/app/platform/guest/requests";
import { createHash } from "node:crypto";
import { putStream } from "#oma-test/app/platform/host/project";
import { EgressHost } from "#oma-test/app/platform/host/egress";
import { GuestLink } from "#oma-test/app/platform/host/guest-link";
import { HOST_GUEST_PROTOCOL, PLATFORM_FRAME_BYTES } from "@oma/protocol/host-guest";

async function pair(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "oma-rpc-"));
  const server = createServer({ allowHalfOpen: true });
  const path = join(dir, "peer.sock");
  server.listen(path);
  await once(server, "listening");
  const accepted = once(server, "connection");
  const client = connect({ path, allowHalfOpen: true });
  const [remote] = await accepted as [Socket];
  await once(client, "connect");
  // Error handling is also checked at the reader; the fixture must survive a
  // missing reader handler long enough to report the failed assertion.
  client.on("error", () => {}); remote.on("error", () => {});
  t.after(async () => {
    client.destroy(); remote.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });
  return { client, remote };
}

async function observed<T>(pending: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("observation did not settle")), 500);
    })]);
  } finally { clearTimeout(timer); }
}
const unavailable = (error: unknown) => error instanceof StoreError && error.code === "BROKER_UNAVAILABLE";
const unknown = (error: unknown) => error instanceof PlatformError && error.failure.code === "ENGINE_UNAVAILABLE" && error.failure.retry === "same-key";

for (const prefix of [Buffer.alloc(0), encodeFrame({ partial: true }).subarray(0, 7)]) {
  test(`DR27: leading frame ends on peer FIN with ${prefix.length} partial bytes, even in an idle pool`, async t => {
    const { client, remote } = await pair(t);
    const before = ["data", "end", "error", "close"].map(name => client.listenerCount(name));
    const pending = readLeadingFrame(client, PLATFORM_FRAME_BYTES, Infinity);
    remote.end(prefix);
    await assert.rejects(observed(pending), unavailable);
    assert.equal(client.destroyed, false, "the reader does not seize the caller's socket owner");
    assert.deepEqual(["data", "end", "error", "close"].map(name => client.listenerCount(name)), before);
    assert.equal(client.isPaused(), true);
  });
}

for (const state of ["ended", "destroyed", "error"] as const) {
  test(`DR27: leading frame refuses an already ${state} connection without waiting for a new event`, async t => {
    const { client, remote } = await pair(t);
    if (state === "ended") {
      const ended = once(client, "end"); client.resume(); remote.end(); await ended;
    } else {
      const closed = new Promise<void>(resolve => client.once("close", () => resolve()));
      client.destroy(state === "error" ? new Error("injected transport error") : undefined); await closed;
    }
    await assert.rejects(observed(readLeadingFrame(client, PLATFORM_FRAME_BYTES, Infinity)), unavailable);
  });
}

test("DR27: leading-frame error settles immediately and removes only its own listeners", async t => {
  const { client } = await pair(t);
  const before = ["data", "end", "error", "close"].map(name => client.listenerCount(name));
  const pending = readLeadingFrame(client, PLATFORM_FRAME_BYTES, Infinity);
  client.emit("error", new Error("injected read error"));
  await assert.rejects(observed(pending), unavailable);
  assert.deepEqual(["data", "end", "error", "close"].map(name => client.listenerCount(name)), before);
});

test("DR27: a complete leading frame and following bytes survive FIN and a paused handoff", async t => {
  const { client, remote } = await pair(t);
  const frame = { v: 1, id: "answer", ok: true, result: {} };
  const raw = Buffer.from([0, 255, 128, 42]);
  const pending = readLeadingFrame(client, PLATFORM_FRAME_BYTES, 1000);
  const bytes = Buffer.concat([encodeFrame(frame), raw]);
  remote.write(bytes.subarray(0, 3));
  remote.end(bytes.subarray(3));
  const result = await observed(pending);
  assert.deepEqual(result, { frame, rest: raw });
  assert.equal(client.isPaused(), true);
});

test("DR27: buffered data before an unread FIN still contains a valid leading frame", async t => {
  const { client, remote } = await pair(t);
  client.pause();
  remote.end(encodeFrame({ buffered: true }));
  await once(client, "readable");
  assert.deepEqual((await observed(readLeadingFrame(client, PLATFORM_FRAME_BYTES, 1000))).frame, { buffered: true });
});

for (const budget of [NaN, -Infinity, 0, -1, 0.5, 2_147_483_648]) {
  test(`DR27: invalid leading-frame budget ${budget} is rejected before observing the socket`, async t => {
    const { client } = await pair(t);
    const before = client.eventNames().map(name => [name, client.listenerCount(name)]);
    await assert.rejects(observed(readLeadingFrame(client, PLATFORM_FRAME_BYTES, budget)), RangeError);
    assert.deepEqual(client.eventNames().map(name => [name, client.listenerCount(name)]), before);
  });
}

test("DR27: silence expires without leaving leading-frame listeners", async t => {
  const { client } = await pair(t);
  const before = client.eventNames().map(name => [name, client.listenerCount(name)]);
  const start = performance.now();
  await assert.rejects(observed(readLeadingFrame(client, PLATFORM_FRAME_BYTES, 40)), unavailable);
  assert.ok(performance.now() - start >= 30);
  assert.deepEqual(client.eventNames().map(name => [name, client.listenerCount(name)]), before);
});

test("DR27: an unconstructible parser rejects inside the data emit, not the process", async t => {
  const { client, remote } = await pair(t);
  const escaped: unknown[] = [];
  const onUncaught = (error: Error) => { escaped.push(error); };
  process.once("uncaughtException", onUncaught);
  t.after(() => { process.off("uncaughtException", onUncaught); });
  // A NaN limit is refused by neither the declared-size checks (NaN
  // compares false against the length) nor any earlier validation: the
  // parser's constructor is reached with it inside the 'data' listener,
  // and its throw must become this read's rejection rather than escaping
  // the emit as the host's death.
  const pending = readLeadingFrame(client, NaN, 1000);
  remote.write(encodeFrame({ hello: true }));
  await assert.rejects(observed(pending), RangeError);
  assert.deepEqual(escaped, [], "a constructor throw inside the emit reached the process");
});

for (const channel of ["control", "stream"] as const) {
  test(`DR27: ${channel} hello uses the handshake budget, not the later request budget`, async t => {
    const { client, remote } = await pair(t);
    const peer = new FramedPeer(remote, { frameBytes: PLATFORM_FRAME_BYTES, requestTimeoutMs: 1000 });
    t.after(() => peer.close());
    const reply = { protocol: HOST_GUEST_PROTOCOL, guestImage: "test-image", bootId: randomUUID(),
      stateSchema: { written: 1, readable: [1] }, capabilities: [] };
    const timers: NodeJS.Timeout[] = [];
    t.after(() => { for (const timer of timers) clearTimeout(timer); });
    peer.onFrame(frame => {
      timers.push(setTimeout(() => { if (!peer.isClosed) peer.answer(frame.id as string, frame.method === "hello" ? reply : { answered: true }); }, 80));
    });
    const link = new GuestLink({ connect: async () => client }, { hostVersion: "1.0.0", installationId: randomUUID(), instanceId: randomUUID(),
      expectImage: reply.guestImage, protocol: { min: HOST_GUEST_PROTOCOL, max: HOST_GUEST_PROTOCOL } },
    { frameBytes: PLATFORM_FRAME_BYTES, helloDeadlineMs: 400, requestTimeoutMs: 20 });
    if (channel === "control") {
      const opened = await link.json(channel);
      t.after(() => opened.close());
      assert.equal(link.currentBoot, reply.bootId);
      await assert.rejects(opened.request("slow", {}), unknown);
    } else {
      assert.equal((await link.bytes(channel)).socket, client);
      assert.equal(link.currentBoot, reply.bootId);
    }
  });
}

test("DR27: a silent JSON hello ends at its own budget and releases the socket", async t => {
  const { client, remote } = await pair(t);
  const peer = new FramedPeer(remote, { frameBytes: PLATFORM_FRAME_BYTES, requestTimeoutMs: 1000 });
  t.after(() => peer.close());
  const link = new GuestLink({ connect: async () => client }, { hostVersion: "1.0.0", installationId: randomUUID(), instanceId: randomUUID(),
    expectImage: "test-image", protocol: { min: HOST_GUEST_PROTOCOL, max: HOST_GUEST_PROTOCOL } },
  { frameBytes: PLATFORM_FRAME_BYTES, helloDeadlineMs: 30, requestTimeoutMs: 1000 });
  await assert.rejects(observed(link.json("control")), unknown);
  assert.equal(client.destroyed, true);
  assert.equal(link.currentBoot, null);
});

for (const frame of [
  { v: 1, id: "other", ok: true, result: {} },
  { v: 1, id: "answer", ok: true, result: null },
  { v: 1, id: "answer", ok: false },
]) {
  test(`DR27: malformed response ${JSON.stringify(frame)} proves no outcome`, async t => {
    const { client, remote } = await pair(t);
    const pending = readLeadingResponse(client, "answer", PLATFORM_FRAME_BYTES, 100);
    remote.end(encodeFrame(frame));
    await assert.rejects(pending, unknown);
  });
}

test("DR27: a valid refusal keeps its retry policy; a missing answer is only unknown", async t => {
  const refused = await pair(t);
  const failure = { code: "AUTH_FAILED", message: "not admitted", retry: "never" };
  const pending = readLeadingResponse(refused.client, "answer", PLATFORM_FRAME_BYTES, 100);
  refused.remote.end(encodeFrame({ v: 1, id: "answer", ok: false, error: failure }));
  await assert.rejects(pending, error => error instanceof PlatformError && JSON.stringify(error.failure) === JSON.stringify(failure));
  const missing = await pair(t);
  const unanswered = readLeadingResponse(missing.client, "answer", PLATFORM_FRAME_BYTES, 100);
  missing.remote.end();
  await assert.rejects(unanswered, unknown);
});

test("DR27: an invalid JSON response is an unknown outcome, never an input refusal", async t => {
  const { client, remote } = await pair(t);
  const pending = readLeadingResponse(client, "answer", PLATFORM_FRAME_BYTES, 100);
  remote.end(Buffer.from([0, 0, 0, 1, 123]));
  await assert.rejects(pending, unknown);
});

test("DR27: connection timeout releases its socket and listeners without asserting remote death", async t => {
  let socket: Socket | undefined;
  t.mock.method(Socket.prototype, "connect", function(this: Socket) { socket = this; return this; });
  await assert.rejects(observed(connectSocket("unused-fixture-path", 30)), unknown);
  assert.ok(socket?.destroyed);
  await new Promise<void>(resolve => setImmediate(resolve));
  for (const name of ["connect", "error", "close"]) assert.equal(socket.listenerCount(name), 0);
});

test("DR27: connection failure is bounded and does not leave a listener owner behind", async t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-rpc-connect-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  await assert.rejects(connectSocket(join(dir, "absent.sock"), 100), unknown);
  await assert.rejects(connectSocket(join(dir, "absent.sock"), Infinity), RangeError);
});

test("DR27: host egress pool releases a half-closed slot and replaces it", async t => {
  const peers: Socket[] = [];
  const host = new EgressHost({
    open: async () => { const { client, remote } = await pair(t); peers.push(remote); return { socket: client, rest: Buffer.alloc(0) }; },
    resolve: async () => { throw new Error("no provider may be called"); },
    frameBytes: PLATFORM_FRAME_BYTES, maxPool: 1,
    concurrent: 1,
    retry: { initialMs: 10, maxMs: 20 }
});
  t.after(() => host.stop());
  await host.fill();
  assert.equal(host.pooled, 1);
  peers[0]!.end();
  for (let attempt = 0; attempt < 40 && peers.length < 2; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(peers.length, 2, "FIN freed a slot instead of leaking its infinite wait");
  assert.equal(host.pooled, 1);
  await host.stop();
  for (let attempt = 0; attempt < 40 && Number(host.pooled) !== 0; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(host.pooled, 0);
});

test("DR27: put owns its socket through local failure, remote failure and completed upload", async t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-rpc-put-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const missing = await pair(t);
  await assert.rejects(putStream({ socket: missing.client, rest: Buffer.alloc(0) }, "k", join(dir, "missing"), PLATFORM_FRAME_BYTES),
    (error: NodeJS.ErrnoException) => error.code === "ENOENT");
  assert.equal(missing.client.destroyed, true, "local failure releases the connection it already owns");
  for (const mode of ["success", "wrong-receipt", "disconnect"] as const) {
    const body = Buffer.alloc(mode === "disconnect" ? 4 * 1024 * 1024 : 32, 42);
    const path = join(dir, mode); writeFileSync(path, body);
    const { client, remote } = await pair(t);
    const serving = (async () => {
      const header = await readLeadingFrame(remote, PLATFORM_FRAME_BYTES, 1000);
      if (mode === "disconnect") { remote.destroy(); return; }
      const params = header.frame.params as Record<string, unknown>;
      assert.equal(params.bytes, body.length);
      assert.equal(params.sha256, createHash("sha256").update(body).digest("hex"));
      let bytes = header.rest.length;
      if (bytes < body.length) await new Promise<void>(resolve => {
        remote.on("data", chunk => { bytes += chunk.length; if (bytes >= body.length) resolve(); });
        remote.resume();
      });
      remote.end(encodeFrame({ v: 1, id: "put", ok: true, result: { bytes, sha256: mode === "success" ? params.sha256 : "wrong" } }));
    })();
    const uploading = observed(putStream({ socket: client, rest: Buffer.alloc(0) }, "k", path, PLATFORM_FRAME_BYTES));
    if (mode === "success") await uploading;
    else await assert.rejects(uploading, unknown);
    await serving;
    assert.equal(client.destroyed, true, mode);
  }
});

test("DR27: put sends the file it declared even if its pathname is replaced", async t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-rpc-put-source-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "source"); const next = join(dir, "replacement");
  const body = Buffer.from("original stream");
  writeFileSync(path, body); writeFileSync(next, "replaced stream");
  const { client, remote } = await pair(t);
  const write = client.write.bind(client);
  let replaced = false;
  t.mock.method(client, "write", (...args: Parameters<Socket["write"]>) => {
    if (!replaced) { replaced = true; renameSync(next, path); }
    return write(...args);
  });
  const serving = (async () => {
    const header = await readLeadingFrame(remote, PLATFORM_FRAME_BYTES, 1000);
    const chunks = [header.rest];
    if (header.rest.length < body.length) await new Promise<void>(resolve => {
      remote.on("data", (chunk: Buffer) => { chunks.push(chunk); if (Buffer.concat(chunks).length >= body.length) resolve(); });
      remote.resume();
    });
    assert.deepEqual(Buffer.concat(chunks), body);
    const params = header.frame.params as Record<string, unknown>;
    remote.end(encodeFrame({ v: 1, id: "put", ok: true, result: { bytes: body.length, sha256: params.sha256 } }));
  })();
  await observed(putStream({ socket: client, rest: Buffer.alloc(0) }, "k", path, PLATFORM_FRAME_BYTES));
  await serving;
});

test("DR27: a failed borrowed file read leaves descriptor release to its one owner", async t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-rpc-read-fault-"));
  const path = join(dir, "source"); writeFileSync(path, "bytes");
  const fd = openSync(path, "r");
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); closeSync(fd); rmSync(dir, { recursive: true, force: true }); });
  const fault = Object.assign(new Error("injected read failure"), { code: "EIO" });
  t.mock.method(fs, "read", (...args: unknown[]) => { (args.at(-1) as (error: Error) => void)(fault); });
  syncBuiltinESMExports();
  await assert.rejects(async () => { for await (const _chunk of borrowedFileRange(fd, 5)) { /* exhaust */ } }, error => error === fault);
  assert.equal(fstatSync(fd).size, 5, "stream failure must not return its borrowed descriptor");
});

for (const state of ["ended", "destroyed"] as const) {
  test(`DR27: a declared receive handed an already ${state} socket abandons only incomplete bytes`, async t => {
    const { client, remote } = await pair(t);
    if (state === "ended") { const ended = once(client, "end"); client.resume(); remote.end(); await ended; }
    else { const closed = once(client, "close"); client.destroy(); await closed; }
    const body = Buffer.from("body"); const declared = { bytes: body.length, sha256: createHash("sha256").update(body).digest("hex") };
    for (const head of [Buffer.alloc(0), body]) {
      const events: string[] = [];
      const pending = receiveDeclared(client, head, declared, { write: () => {}, complete: () => { events.push("complete"); }, abandon: () => { events.push("abandon"); } });
      if (head.length === 0) await assert.rejects(observed(pending), (error: unknown) => error instanceof StoreError && error.code === "STREAM_INVALID");
      else await observed(pending);
      assert.deepEqual(events, head.length === 0 ? ["abandon"] : ["complete"]);
    }
  });
}

function closeFault(t: TestContext) {
  const realClose = fs.closeSync;
  const cleanup = new Error("injected close failure after release");
  const calls: number[] = [];
  t.mock.method(fs, "closeSync", (fd: number) => {
    const source = fstatSync(fd).isFile();
    realClose(fd);
    if (source) { calls.push(fd); throw cleanup; }
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return { cleanup, calls };
}

test("DR27: put retains a read failure alongside its single close failure", async t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-rpc-put-close-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "source"); writeFileSync(path, "bytes");
  const { client } = await pair(t);
  const primary = Object.assign(new Error("injected read failure"), { code: "EIO" });
  t.mock.method(fs, "read", (...args: unknown[]) => { (args.at(-1) as (error: Error) => void)(primary); });
  const fault = closeFault(t);
  await assert.rejects(observed(putStream({ socket: client, rest: Buffer.alloc(0) }, "k", path, PLATFORM_FRAME_BYTES)), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [primary, fault.cleanup]);
    return true;
  });
  assert.equal(fault.calls.length, 1); assert.equal(client.destroyed, true);
});

test("DR27: a put refusal keeps its remote retry meaning when local close also fails", async t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-rpc-put-refusal-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "source"); writeFileSync(path, "");
  const { client, remote } = await pair(t);
  const failure = { code: "AUTH_FAILED", message: "not authorized", retry: "never" };
  const serving = (async () => {
    await readLeadingFrame(remote, PLATFORM_FRAME_BYTES, 1000);
    remote.end(encodeFrame({ v: 1, id: "put", ok: false, error: failure }));
  })();
  const fault = closeFault(t);
  await assert.rejects(observed(putStream({ socket: client, rest: Buffer.alloc(0) }, "k", path, PLATFORM_FRAME_BYTES)), error => {
    assert.ok(error instanceof PlatformError); assert.deepEqual(error.failure, failure);
    assert.ok(error.cause instanceof AggregateError); assert.equal(error.cause.errors[1], fault.cleanup);
    return true;
  });
  await serving; assert.equal(fault.calls.length, 1); assert.equal(client.destroyed, true);
});

for (const mode of ["empty", "body", "close-failure", "read-failure", "replace-path"] as const) {
  test(`DR27: guest get has one declared byte phase and one source owner (${mode})`, async t => {
    const dir = mkdtempSync(join(tmpdir(), "oma-rpc-get-source-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const ledger = new RequestLedger(dir);
    const path = ledger.staging("get-key", "export.bundle");
    const body = mode === "empty" || mode === "close-failure" ? Buffer.alloc(0) : Buffer.from("the staged bytes");
    writeFileSync(path, body);
    const { client, remote } = await pair(t);
    const write = remote.write.bind(remote);
    let declared = false;
    t.mock.method(remote, "write", (...args: Parameters<Socket["write"]>) => {
      if (!declared) {
        declared = true;
        if (mode === "replace-path") { const next = join(dir, "next"); writeFileSync(next, "other file bytes"); renameSync(next, path); }
      }
      return write(...args);
    });
    const realRead = fs.read;
    t.mock.method(fs, "read", ((...args: Parameters<typeof fs.read>) => {
      if (mode === "read-failure" && declared) { (args.at(-1) as (error: Error) => void)(new Error("injected source failure")); return; }
      return Reflect.apply(realRead, fs, args);
    }) as typeof fs.read);
    const realClose = fs.closeSync;
    let closed = 0;
    t.mock.method(fs, "closeSync", (fd: number) => {
      const source = fstatSync(fd).isFile(); realClose(fd);
      if (source) { closed++; if (mode === "close-failure") throw new Error("injected close failure"); }
    });
    syncBuiltinESMExports();
    t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
    const endings: Buffer[] = [];
    const end = remote.end.bind(remote);
    t.mock.method(remote, "end", (...args: Parameters<Socket["end"]>) => {
      if (Buffer.isBuffer(args[0])) endings.push(args[0]);
      return end(...args);
    });
    const serving = serveStream(remote, { ledger, frameBytes: PLATFORM_FRAME_BYTES, deadlineMs: 1000, reserveBytes: 0, dataDir: dir });
    client.write(encodeFrame({ v: 1, id: "get", method: "stream.get", params: { key: "get-key", kind: "export" } }));
    const answer = await observed(readLeadingResponse(client, "get", PLATFORM_FRAME_BYTES, 1000));
    assert.deepEqual(answer.result, { bytes: body.length, sha256: createHash("sha256").update(body).digest("hex") });
    const chunks: Buffer[] = [];
    const receiving = observed(receiveDeclared(client, answer.rest, answer.result as unknown as { bytes: number; sha256: string }, {
      write: chunk => { chunks.push(chunk); }, complete: () => {}, abandon: () => {},
    }));
    if (mode === "read-failure") await assert.rejects(receiving, /ended before|connection failed/);
    else { await assert.doesNotReject(receiving); assert.deepEqual(Buffer.concat(chunks), body); }
    await observed(serving);
    assert.equal(closed, 1, "only the source owner releases the descriptor");
    assert.deepEqual(endings, [], "a cleanup error cannot append JSON to a declared byte stream");
  });
}

test("DR27: destroying a borrowed source waits for its outstanding read without releasing its FD", async t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-rpc-pending-read-"));
  const path = join(dir, "source"); writeFileSync(path, "bytes");
  const fd = openSync(path, "r");
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); closeSync(fd); rmSync(dir, { recursive: true, force: true }); });
  let release!: () => void;
  let started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  t.mock.method(fs, "read", (...args: unknown[]) => {
    release = () => { (args.at(-1) as (error: null, count: number) => void)(null, 0); };
    started();
  });
  syncBuiltinESMExports();
  const stream = borrowedFileRange(fd, 5);
  stream.on("error", () => {});
  let closed = false;
  const closing = new Promise<void>(resolve => stream.once("close", () => { closed = true; resolve(); }));
  stream.resume(); await observed(reading);
  stream.destroy(new Error("cancelled transfer"));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(closed, false, "the pending read still belongs to this owner");
  release(); await observed(closing);
  assert.equal(fstatSync(fd).size, 5);
});

for (const mode of ["read-failure", "not-staged"] as const) {
  test(`DR27: pre-declaration stream errors retain their retry category (${mode})`, async t => {
    const dir = mkdtempSync(join(tmpdir(), "oma-rpc-get-refusal-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const ledger = new RequestLedger(dir);
    if (mode === "read-failure") {
      writeFileSync(ledger.staging("k", "export.bundle"), "bytes");
      t.mock.method(fs, "read", (...args: unknown[]) => { (args.at(-1) as (error: Error) => void)(Object.assign(new Error("read failed"), { code: "EIO" })); });
      syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
    }
    const { client, remote } = await pair(t);
    const serving = serveStream(remote, { ledger, frameBytes: PLATFORM_FRAME_BYTES, deadlineMs: 1000, reserveBytes: 0, dataDir: dir });
    client.write(encodeFrame({ v: 1, id: "get", method: "stream.get", params: { key: "k", kind: "export" } }));
    await assert.rejects(observed(readLeadingResponse(client, "get", PLATFORM_FRAME_BYTES, 1000)), error => {
      assert.ok(error instanceof PlatformError);
      assert.equal(error.failure.retry, mode === "read-failure" ? "same-key" : "never");
      assert.equal(error.failure.code, mode === "read-failure" ? "INTERNAL_ERROR" : "REQUEST_NOT_FOUND");
      return true;
    });
    await serving;
  });
}

test("DR27: a host egress observation failure is not a permanent placeholder refusal", async t => {
  const { client, remote } = await pair(t);
  let opened = false;
  const host = new EgressHost({
    open: async () => { if (opened)
        throw new Error("fixture has one socket"); opened = true; return { socket: client, rest: Buffer.alloc(0) }; },
    resolve: async () => { throw new StoreError("BROKER_UNAVAILABLE", "the provider cannot be observed now"); },
    concurrent: 1,
    frameBytes: PLATFORM_FRAME_BYTES, maxPool: 1
});
  t.after(() => host.stop()); await host.fill();
  remote.write(encodeFrame({ v: 1, id: "placeholder", method: "egress.placeholder", params: {
    credentialRef: "engine-managed", provider: "anthropic", model: "test", run: { society: "demo", actor: "alice", incarnation: 1 },
    inferenceSeconds: 5
} }));
  await assert.rejects(observed(readLeadingResponse(remote, "placeholder", PLATFORM_FRAME_BYTES, 1000)), error => {
    assert.ok(error instanceof PlatformError);
    assert.equal(error.failure.code, "BROKER_UNAVAILABLE"); assert.equal(error.failure.retry, "same-key"); return true;
  });
});

const channelFailures = [
  { name: "internal", error: new Error("private error"), expected: { code: "INTERNAL_ERROR", message: "INTERNAL_ERROR", retry: "same-key" } },
  { name: "transient", error: new StoreError("DB_BUSY", "the request is busy"), expected: { code: "DB_BUSY", message: "the request is busy", retry: "same-key" } },
  { name: "ambiguous", error: new StoreError("RUN_TERMINATION_UNKNOWN", "the run is not confirmed stopped"), expected: { code: "RUN_TERMINATION_UNKNOWN", message: "the run is not confirmed stopped", retry: "same-key" } },
  { name: "storage", error: new StoreError("STORAGE_FULL", "the engine has no room for this"), expected: { code: "STORAGE_FULL", message: "the engine has no room for this", retry: "after-repair" } },
  { name: "native-storage", error: Object.assign(new Error("ENOSPC /var/private"), { code: "ENOSPC" }), expected: { code: "STORAGE_FULL", message: "STORAGE_FULL", retry: "after-repair" } },
  { name: "aggregate-input", error: new AggregateError([new AggregateError([new StoreError("AUTH_FAILED", "the request is not authorized"), new Error("inner close")]), new Error("outer close")]), expected: { code: "AUTH_FAILED", message: "the request is not authorized", retry: "never" } },
  { name: "remote-repair", error: new AggregateError([new AggregateError([new PlatformError({ code: "ENGINE_UNAVAILABLE", message: "systemd /var/private", retry: "after-repair" })]), new Error("close")]), expected: { code: "ENGINE_UNAVAILABLE", message: "ENGINE_UNAVAILABLE", retry: "after-repair" } },
  { name: "remote-unknown", error: new PlatformError({ code: "ENGINE_UNAVAILABLE", message: "the answer was not observed", retry: "same-key" }), expected: { code: "ENGINE_UNAVAILABLE", message: "the answer was not observed", retry: "same-key" } },
  { name: "input-redacted", error: new StoreError("INVALID_REQUEST", "EACCES /home/private"), expected: { code: "INVALID_REQUEST", message: "INVALID_REQUEST", retry: "never" } },
];
for (const entry of channelFailures) {
  for (const channel of ["json", "stream", "egress"] as const) {
    test(`DR27: ${channel} preserves the primary failure and retry (${entry.name})`, async t => {
      const { client, remote } = await pair(t);
      let serving: Promise<void> | undefined;
      let socket = client;
      let id = "probe";
      if (channel === "json") {
        const peer = new FramedPeer(remote, { frameBytes: PLATFORM_FRAME_BYTES, requestTimeoutMs: 1000 });
        t.after(() => peer.close());
        serveRequests(peer, async () => { throw entry.error; });
        client.write(encodeFrame({ v: 1, id, method: "health.get", params: {} }));
      } else if (channel === "stream") {
        const dir = mkdtempSync(join(tmpdir(), "oma-rpc-errors-"));
        t.after(() => rmSync(dir, { recursive: true, force: true }));
        const ledger = new RequestLedger(dir);
        t.mock.method(ledger, "staging", () => { throw entry.error; });
        serving = serveStream(remote, { ledger, frameBytes: PLATFORM_FRAME_BYTES, deadlineMs: 1000, reserveBytes: 0, dataDir: dir });
        client.write(encodeFrame({ v: 1, id, method: "stream.get", params: { key: "k", kind: "export" } }));
      } else {
        let opened = false;
        const host = new EgressHost({
    open: async () => { if (opened)
        throw new Error("fixture has one socket"); opened = true; return { socket: client, rest: Buffer.alloc(0) }; },
    resolve: async () => { throw entry.error; },
    concurrent: 1,
    frameBytes: PLATFORM_FRAME_BYTES, maxPool: 1
});
        t.after(() => host.stop()); await host.fill();
        socket = remote; id = "placeholder";
        remote.write(encodeFrame({ v: 1, id, method: "egress.placeholder", params: {
    credentialRef: "engine-managed", provider: "anthropic", model: "test", run: { society: "demo", actor: "alice", incarnation: 1 },
    inferenceSeconds: 5
} }));
      }
      await assert.rejects(observed(readLeadingResponse(socket, id, PLATFORM_FRAME_BYTES, 1000)), error => {
        assert.ok(error instanceof PlatformError);
        assert.deepEqual(error.failure, entry.expected);
        return true;
      });
      await serving;
    });
  }
}
