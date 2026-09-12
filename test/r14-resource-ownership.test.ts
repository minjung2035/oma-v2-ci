import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { SharedPeerPin } from "../src/broker/peer-pin.js";
import { TransportSpool } from "../src/broker/transport-spool.js";
import { StoreError } from "../src/domain/errors.js";
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
