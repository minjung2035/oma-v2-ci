import test from "node:test";
import assert from "node:assert/strict";
import fs, { mkdtempSync, rmSync, existsSync, readdirSync, openSync, closeSync, fstatSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { SharedPeerPin } from "@oma/broker/peer-pin";
import { TransportSpool } from "@oma/storage/transport-spool";
import { StoreError } from "@oma/domain/errors";
import { closeEvery } from "@oma/native/files";
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

test("R14: a native peer pin closes once after both connection and executing owners release", () => {
  let closes = 0; let alive = true;
  const peer = new SharedPeerPin(() => alive, () => { closes++; });
  const release = peer.retainForExecution();
  assert.throws(() => peer.retainForExecution(), StoreError);
  peer.releaseConnection(); peer.releaseConnection();
  assert.equal(peer.alive(), true); assert.equal(closes, 0);
  alive = false; assert.equal(peer.alive(), false);
  release(); release(); peer.releaseConnection();
  assert.equal(closes, 1); assert.throws(() => peer.retainForExecution(), StoreError);
});

test("R14: a transferred spool remains readable after disconnect and is unlinked once by its task", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-r14-spool-"));
  try {
    const bytes = Buffer.from("first\nsecond\n");
    const spool = new TransportSpool(root, { bytes: bytes.length, sha256: hash(bytes) });
    for (const byte of bytes) spool.append(Buffer.from([byte]));
    spool.seal(); const execution = spool.handoff();
    spool.releaseConnection(); assert.equal(existsSync(spool.path), true);
    const chunks: Buffer[] = [];
    for await (const chunk of execution.chunks) chunks.push(Buffer.from(chunk));
    assert.deepEqual(Buffer.concat(chunks), bytes);
    execution.release(); execution.release(); spool.releaseConnection();
    assert.deepEqual(readdirSync(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("R14: zero bytes are exact; mismatched length/hash never acquires execution ownership", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-r14-zero-"));
  try {
    const empty = new TransportSpool(root, { bytes: 0, sha256: hash(Buffer.alloc(0)) });
    empty.seal(); const body = empty.handoff(); body.release();
    const short = new TransportSpool(root, { bytes: 2, sha256: hash(Buffer.from("ok")) });
    short.append(Buffer.from("o")); assert.throws(() => short.seal(), StoreError);
    assert.throws(() => short.handoff(), StoreError); short.releaseConnection();
    const wrong = new TransportSpool(root, { bytes: 2, sha256: hash(Buffer.from("ok")) });
    wrong.append(Buffer.from("no")); assert.throws(() => wrong.seal(), StoreError); wrong.releaseConnection();
    assert.deepEqual(readdirSync(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const openDescriptors = (): number => readdirSync("/proc/self/fd").length;

test("P0V-65 / R10, P0-4: every descriptor handed to closeEvery is given back, whichever fails to close", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-close-every-"));
  try {
    // Two distinct numbers: the one closed first is not reused for the other.
    const gone = openSync(root, "r");
    const kept = openSync(root, "r");
    closeSync(gone);
    assert.throws(() => closeEvery(gone, undefined, kept, null), (error: NodeJS.ErrnoException) => error.code === "EBADF");
    assert.throws(() => fstatSync(kept), (error: NodeJS.ErrnoException) => error.code === "EBADF", "the second descriptor was left open");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("P0V-65 / R10, P0-4: a spool reader that fails before its stream exists gives its descriptor back", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-spool-gap-"));
  t.after(() => { syncBuiltinESMExports(); rmSync(root, { recursive: true, force: true }); });
  const bytes = Buffer.from("body\n");
  const spool = new TransportSpool(root, { bytes: bytes.length, sha256: hash(bytes) });
  spool.append(bytes); spool.seal();
  const execution = spool.handoff();
  const before = openDescriptors();
  // The reader's identity check cannot be answered (EIO) after it opened the copy.
  // The first fstat after arming is the containment check inside the open
  // (which gives its own descriptor back); the second is the reader's.
  const real = fs.fstatSync;
  let calls = 0;
  t.mock.method(fs, "fstatSync", ((fd: number, options?: object) => {
    calls += 1;
    if (calls === 2) throw Object.assign(new Error("EIO: injected"), { code: "EIO" });
    return real(fd, options as never);
  }) as typeof fs.fstatSync);
  syncBuiltinESMExports();
  await assert.rejects((async () => { for await (const chunk of execution.chunks) void chunk; })(), /EIO/);
  assert.equal(calls, 2, "the injected failure did not reach the reader");
  assert.equal(openDescriptors(), before, "the reader's descriptor has no owner");
  execution.release();
});
