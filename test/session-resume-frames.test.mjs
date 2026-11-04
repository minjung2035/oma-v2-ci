/** AUD-12: the real interactive channel carries a large /resume catalog whole.
 *
 * The audit reproduced the defect with a real socket: one 3200-directory
 * `session_dirs` answer (275254 bytes) closed the 262144-byte InteractiveChannel
 * and every session past the bound became unreachable. This drives the
 * production answer shaper (apps/oma's sessionDirectoryReplies) into the
 * production InteractiveChannel over a real TCP pair, with the engine's own
 * ProjectSessionDirectories as the observer, and asserts that the whole
 * catalog arrives in bounded frames and neither side of the channel ends.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, connect } from "node:net";
import { once } from "node:events";
import { Script } from "node:vm";
import ts from "typescript";
import { alarm } from "@oma/protocol/alarm";
import { InteractiveChannel } from "@oma/engine/interactive-channel";
import { sessionDirectoryReplies } from "#oma-test/app/runtime/session-catalog";

/** The engine-side observer, compiled from source with the one runtime
 * dependency it has, so this exercises the current accumulation contract. */
const compiled = ts.transpileModule(readFileSync("packages/engine/src/session-directories.ts", "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const engineModule = { exports: {} };
new Script(compiled, { filename: "session-directories.ts" }).runInNewContext({
  exports: engineModule.exports, module: engineModule,
  require(name) {
    if (name === "@oma/protocol/alarm") return { alarm };
    throw new Error(`uncontrolled dependency in session-directories.ts: ${name}`);
  },
});
const { ProjectSessionDirectories } = engineModule.exports;

const LIMITS = Object.freeze({ frameBytes: 262144, idleStreamSeconds: 30, receiptWaitSeconds: 30 });
const OWN = "/home/u/.local/share/oma/oma/.society/principal/private/sessions";
const CURRENT = `${OWN}/2026-10-31T00-00-00-000Z.jsonl`;

async function world(t, catalog, frameBytes = LIMITS.frameBytes, receiptWaitSeconds = LIMITS.receiptWaitSeconds, current = CURRENT) {
  const limits = Object.freeze({ ...LIMITS, frameBytes, receiptWaitSeconds });
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const accepted = new Promise(resolve => server.once("connection", resolve));
  const client = connect({ port: server.address().port, host: "127.0.0.1" });
  const [engineSocket] = await Promise.all([accepted, once(client, "connect")]);
  const ended = [], hostFrames = [];
  const firstFrame = Promise.withResolvers();
  let engineChannel;
  const engine = new ProjectSessionDirectories(OWN, limits.receiptWaitSeconds, event => engineChannel.send(event));
  const host = new InteractiveChannel(client, limits, event => {
    if (event.type !== "sessions_request" || typeof event.id !== "string") return;
    const frames = sessionDirectoryReplies(event.id, typeof catalog === "function" ? catalog(event.id) : catalog, current, limits.frameBytes);
    void (async () => {
      for (const frame of frames) {
        hostFrames.push(frame);
        firstFrame.resolve();
        await host.sendAndWait(frame);
      }
    })().catch(error => ended.push(error));
  }, error => ended.push(error));
  engineChannel = new InteractiveChannel(engineSocket, limits, event => engine.accept(event), error => ended.push(error));
  t.after(() => {
    engine.close();
    try { host.close(); } catch { /* already closed by the observation */ }
    try { engineChannel.close(); } catch { /* already closed by the observation */ }
    return new Promise(resolve => server.close(resolve));
  });
  return { engine, host, client, firstFrame: firstFrame.promise, hostFrames, ended };
}

test("001. A 3200-directory catalog crosses the real interactive channel whole", { timeout: 30_000 }, async t => {
  const catalog = Array.from({ length: 3200 }, (_, index) =>
    `/home/u/.local/share/oma/oma/.personal/00000000-0000-4000-8000-${String(index).padStart(12, "0")}/history`);
  const unsplitBytes = Buffer.byteLength(JSON.stringify({ type: "session_dirs", id: "sessions-1", dirs: catalog, current: CURRENT }));
  assert.ok(unsplitBytes > LIMITS.frameBytes, `the unsplit answer (${unsplitBytes} bytes) outgrows the ${LIMITS.frameBytes}-byte channel`);
  const { engine, hostFrames, ended } = await world(t, catalog);
  const snapshot = await engine.snapshot();
  assert.equal(snapshot.error, undefined);
  assert.deepEqual(Array.from(snapshot.dirs), [OWN, ...catalog], "every directory arrives, in order, with the society's own once");
  assert.ok(hostFrames.length > 1, `the catalog was split into ${hostFrames.length} frame(s)`);
  for (const [index, frame] of hostFrames.entries()) {
    const bytes = Buffer.byteLength(JSON.stringify(frame));
    assert.ok(bytes <= LIMITS.frameBytes, `frame ${index} (${bytes} bytes) exceeds the channel bound`);
    assert.equal(frame.more === true, index < hostFrames.length - 1, "only the frames before the last continue");
  }
  assert.deepEqual(ended, [], "neither side of the channel ended");
});

test("006. An exactly aligned continuation keeps array brackets inside the real frame budget", { timeout: 5000 }, async t => {
  let catalog;
  const makeCatalog = id => {
    const overhead = Buffer.byteLength(JSON.stringify({ type: "session_dirs", id, dirs: [], current: CURRENT, more: true }));
    catalog = ["/" + "x".repeat(768 - overhead - 6), "/x", "/y"];
    return catalog;
  };
  const { engine, hostFrames, ended, firstFrame } = await world(t, makeCatalog, 768);
  const pending = engine.snapshot();
  void pending.catch(() => {});
  await firstFrame;
  assert.ok(hostFrames.every(frame => Buffer.byteLength(JSON.stringify(frame)) <= 768));
  const snapshot = await pending;
  assert.equal(snapshot.error, undefined);
  assert.deepEqual(Array.from(snapshot.dirs), [OWN, ...catalog]);
  assert.equal(ended.length, 0);
  assert.ok(hostFrames.every(frame => Buffer.byteLength(JSON.stringify(frame)) <= 768));
});

for (const [encoding, seed] of [["ASCII", "/session"], ["UTF-8", "/한😀"], ["JSON escapes", '/quote"\\line\n']]) {
  for (const delta of [-1, 0, 1]) test(`007. ${encoding} final catalog at frame bound ${delta >= 0 ? "+" : ""}${delta} over the real channel`, { timeout: 5000 }, async t => {
    let catalog;
    const makeCatalog = id => {
      const initial = Buffer.byteLength(JSON.stringify({ type: "session_dirs", id, dirs: [seed], current: CURRENT }));
      catalog = [seed + "x".repeat(768 + delta - initial)];
      return catalog;
    };
    const { engine, firstFrame, hostFrames, ended } = await world(t, makeCatalog, 768);
    const pending = engine.snapshot();
    void pending.catch(() => {});
    await firstFrame;
    assert.ok(hostFrames.every(frame => Buffer.byteLength(JSON.stringify(frame)) <= 768));
    const snapshot = await pending;
    if (delta <= 0) {
      assert.equal(snapshot.error, undefined, "a catalog that fits its complete final envelope is serviceable");
      assert.deepEqual(Array.from(snapshot.dirs), [OWN, ...catalog]);
      assert.equal(hostFrames.length, 1);
      assert.equal(Buffer.byteLength(JSON.stringify(hostFrames[0])), 768 + delta);
    } else {
      assert.equal(typeof snapshot.error, "string");
      assert.deepEqual(Array.from(snapshot.dirs), [OWN]);
    }
    assert.deepEqual(ended, [], "a boundary refusal is an answer, not channel death");
  });
}

for (const delta of [-1, 0, 1]) test(`008. An empty catalog's fixed envelope at frame bound ${delta >= 0 ? "+" : ""}${delta}`, () => {
  const id = "sessions-1";
  const fixed = Buffer.byteLength(JSON.stringify({ type: "session_dirs", id, dirs: [], current: "" }));
  const frames = sessionDirectoryReplies(id, [], "x".repeat(768 + delta - fixed), 768);
  assert.ok(frames.every(frame => Buffer.byteLength(JSON.stringify(frame)) <= 768));
  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0].dirs, []);
  assert.equal(typeof frames[0].error, delta > 0 ? "string" : "undefined");
});

for (const last of ["", "/😀"]) test(`009. A final suffix uses its own envelope after a full continuation (${JSON.stringify(last)})`, () => {
  const id = "sessions-1", bound = 768;
  const fixed = more => Buffer.byteLength(JSON.stringify({ type: "session_dirs", id, dirs: [], current: CURRENT, ...(more ? { more: true } : {}) }));
  const first = "x".repeat(bound - fixed(true) - 2);
  const suffix = "한" + "x".repeat(bound - fixed(false) - Buffer.byteLength(JSON.stringify(last)) - 1 - 5);
  const catalog = [first, suffix, last];
  const frames = sessionDirectoryReplies(id, catalog, CURRENT, bound);
  assert.ok(frames.every(frame => !frame.error && Buffer.byteLength(JSON.stringify(frame)) <= bound));
  assert.deepEqual(frames.flatMap(frame => frame.dirs), catalog);
  assert.equal(frames.length, 2);
  assert.equal(frames[0].more, true);
  assert.equal(frames[1].more, undefined);
  assert.equal(Buffer.byteLength(JSON.stringify(frames[1])), bound);
});

test("002. A directory too large for one frame is reported through the channel, not dropped", { timeout: 30_000 }, async t => {
  const catalog = [`/home/u/.local/share/oma/oma/.personal/${"a".repeat(2000)}/history`];
  const { engine, hostFrames, ended } = await world(t, catalog, 1024);
  const snapshot = await engine.snapshot();
  assert.deepEqual(Array.from(snapshot.dirs), [OWN], "no part of the answer is invented or silently kept");
  assert.equal(typeof snapshot.error, "string", "the oversized entry is explicitly reported as a failed catalog");
  assert.equal(hostFrames.length, 1);
  assert.deepEqual(hostFrames[0].dirs, []);
  assert.deepEqual(ended, []);
});

test("003. A buffered catalog waits for output capacity before adding another frame", { timeout: 30_000 }, async t => {
  const catalog = Array.from({ length: 15000 }, (_, index) =>
    `/home/u/.local/share/oma/oma/.personal/00000000-0000-4000-8000-${String(index).padStart(12, "0")}/history`);
  const { engine, client, firstFrame, ended } = await world(t, catalog);
  // A real Socket's cork retains writes until uncork: deterministic backpressure,
  // without delays, fake writableLength values or a fast-reader assumption.
  client.cork();
  const pending = engine.snapshot();
  await firstFrame;
  for (let turn = 0; turn < 8; turn++) {
    const { promise, resolve } = Promise.withResolvers();
    setImmediate(resolve);
    await promise;
  }
  assert.ok(client.writableLength > 0, "the real socket still holds the blocked write");
  assert.ok(client.writableLength <= LIMITS.frameBytes + 1, "no second catalog frame is queued behind it");
  assert.deepEqual(ended, [], "backpressure does not close a healthy conversation");
  client.uncork();
  const snapshot = await pending;
  assert.equal(snapshot.error, undefined);
  assert.deepEqual(Array.from(snapshot.dirs), [OWN, ...catalog]);
  assert.deepEqual(ended, []);
});

test("004. Closing a buffered UI channel rejects its waiting writer", { timeout: 30_000 }, async t => {
  const { host, client } = await world(t, []);
  client.cork();
  const failed = assert.rejects(host.sendAndWait({ type: "notice", text: "buffered" }),
    { code: "ERR_STREAM_DESTROYED" });
  host.close();
  await failed;
});

test("005. Even a small buffered frame has a write deadline below the socket high-water mark", { timeout: 3000 }, async t => {
  const { host, client, ended } = await world(t, [], 1024, 0.02);
  client.cork();
  const failed = assert.rejects(host.sendAndWait({ type: "notice", text: "buffered" }),
    { code: "ERR_STREAM_DESTROYED" });
  assert.equal(client.writableNeedDrain, false, "the write fits below the stream's high-water mark");
  await failed;
  assert.equal(client.destroyed, true, "the configured write deadline terminates the blocked channel");
  assert.equal(ended.length, 1);
});
