/** DR29: saved host Personal identity and the real private socket owner. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createServer, connect, type Socket } from "node:net";
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import { hostHistoryReference, parseHostHistoryReference, parseHostHistoryQuery, checkedHostHistoryPage } from "@oma/protocol/host-history";
import { isNewSessionHandoff, parseTerminalExit, TERMINAL_FRAME_BYTES } from "@oma/protocol/host-guest";
import { newSessionBirth, publishSessionBirth } from "#oma-test/app/runtime/session-mode";
import { hostPersonalHistoryQuery, inspectHostPersonalHistory } from "#oma-test/app/platform/host/personal-histories";
import { HostHistoryChannel } from "@oma/engine/host-history-channel";
import { FrameParser, encodeFrame } from "@oma/protocol/frame";

test("Session mode: host handoff accepts a mode only for a successful new session", () => {
  const valid = { code: 0, signal: null, next: "new", mode: "personal" };
  assert.deepEqual(parseTerminalExit(Buffer.from(JSON.stringify(valid))), valid);
  assert.equal(isNewSessionHandoff({ next: "new", mode: "personal" }), true);
  for (const fields of [{ mode: "invalid" }, { mode: null }, { code: 7 }, { signal: "SIGTERM" },
    { next: "resume" }, { history: "/untrusted/path" }])
    assert.equal(parseTerminalExit(Buffer.from(JSON.stringify({ ...valid, ...fields }))), null);
  assert.equal(isNewSessionHandoff({ next: "new", mode: "invalid" }), false);
  assert.equal(isNewSessionHandoff({ next: "new", mode: "personal", cwd: "/untrusted" }), false);
});

function world(t: import("node:test").TestContext) {
  const root = mkdtempSync(join(tmpdir(), "oma-host-history-")), cwd = join(root, "project");
  mkdirSync(cwd); t.after(() => rmSync(root, { recursive: true, force: true }));
  const sessionRoot = join(root, ".personal", randomUUID());
  const birth = publishSessionBirth(sessionRoot, newSessionBirth(sessionRoot, "personal", cwd));
  return { root, cwd, birth };
}
function save(w: ReturnType<typeof world>, index: number) {
  mkdirSync(w.birth.history, { recursive: true });
  const file = `history-${String(index).padStart(4, "0")}.jsonl`, sessionId = randomUUID(), timestamp = "2026-10-02T00:00:00.000Z";
  writeFileSync(join(w.birth.history, file), JSON.stringify({ type: "session", version: CURRENT_SESSION_VERSION, id: sessionId, timestamp, cwd: w.cwd }) + "\n" +
    JSON.stringify({ type: "message", id: "entry", parentId: null, timestamp,
      message: { role: "user", content: [{ type: "text", text: "가".repeat(160) }], timestamp: Date.parse(timestamp) } }) + "\n", { mode: 0o600 });
  return hostHistoryReference({ birthId: w.birth.id, file, sessionId });
}

test("DR29: host references are exact saved identities and terminal resume cannot import a path", () => {
  const identity = { birthId: randomUUID(), file: "a.jsonl", sessionId: randomUUID() }, reference = hostHistoryReference(identity);
  assert.deepEqual(parseHostHistoryReference(reference), identity);
  for (const value of [reference + "=", "/host/a.jsonl", "oma-host-history:garbage"])
    assert.throws(() => parseHostHistoryReference(value), { code: "INVALID_REQUEST" });
  for (const fields of [{ file: "../a.jsonl" }, { file: "/a.jsonl" }, { cwd: "/host" }, { birthId: "other" }])
    assert.throws(() => hostHistoryReference({ ...identity, ...fields }), { code: "INVALID_REQUEST" });
  assert.deepEqual(parseTerminalExit(Buffer.from(JSON.stringify({ code: 0, signal: null, next: "resume", history: reference }))),
    { code: 0, signal: null, next: "resume", history: reference });
  for (const fields of [{ code: 7 }, { signal: "SIGTERM" }, { cwd: "/host" }, { history: "/host/a.jsonl" }, { next: "new" }])
    assert.equal(parseTerminalExit(Buffer.from(JSON.stringify({ code: 0, signal: null, next: "resume", history: reference, ...fields }))), null);
  assert.throws(() => parseHostHistoryQuery({ id: "host-history-1", method: "inspect", reference, cwd: "/host" }), { code: "INVALID_REQUEST" });
});

test("DR29: host admission rereads saved birth and exact header without changing the history", async t => {
  const w = world(t), reference = save(w, 1), path = join(w.birth.history, "history-0001.jsonl"), before = readFileSync(path);
  const inspected = await inspectHostPersonalHistory(w.root, reference);
  assert.equal(inspected.file, path); assert.equal(inspected.birth.mode, "personal"); assert.deepEqual(readFileSync(path), before);
  const header = JSON.parse(before.toString().split("\n")[0]!); header.id = randomUUID(); writeFileSync(path, JSON.stringify(header) + "\n");
  await assert.rejects(inspectHostPersonalHistory(w.root, reference), { code: "INVALID_REQUEST" });
  writeFileSync(path, ""); await assert.rejects(hostPersonalHistoryQuery(w.root, { id: "host-history-1", method: "list" }), { code: "BROKER_UNAVAILABLE" });
  rmSync(path); assert.deepEqual(await hostPersonalHistoryQuery(w.root, { id: "host-history-1", method: "list" }), { sessions: [], after: null });
});

test("DR29: many host histories paginate without leaking directories or losing message facts", async t => {
  const w = world(t), expected = new Set<string>();
  for (let index = 0; index < 200; index++) expected.add(save(w, index));
  const found = new Set<string>(); let after: string | undefined, pages = 0;
  do {
    const reply = await hostPersonalHistoryQuery(w.root, { id: "host-history-1", method: "list", ...(after === undefined ? {} : { after }) });
    assert.ok(Buffer.byteLength(JSON.stringify(reply)) < TERMINAL_FRAME_BYTES);
    const page = checkedHostHistoryPage(reply);
    for (const info of page.sessions) {
      assert.equal(found.has(info.reference), false); found.add(info.reference);
      assert.equal(info.messageCount, 1); assert.equal(info.firstMessage, "가".repeat(160));
      assert.equal(Object.hasOwn(info, "cwd"), false); assert.equal(Object.hasOwn(info, "path"), false);
    }
    pages++; after = page.after ?? undefined;
  } while (after !== undefined);
  assert.ok(pages > 1); assert.deepEqual(found, expected);
});

async function channel(t: import("node:test").TestContext, w: ReturnType<typeof world>, answer: (raw: Record<string, unknown>, socket: Socket) => void) {
  let peer: Socket | undefined;
  const server = createServer(socket => {
    peer = socket; const parser = new FrameParser(TERMINAL_FRAME_BYTES - 1);
    socket.on("data", bytes => { for (const { raw } of parser.feed(typeof bytes === "string" ? Buffer.from(bytes) : bytes)) answer(raw, socket); });
  });
  const path = join(w.root, "history.sock"); await new Promise<void>(resolve => server.listen(path, resolve));
  const socket = connect(path); await new Promise<void>(resolve => socket.once("connect", resolve));
  const bridge = new HostHistoryChannel(socket, 5);
  t.after(async () => { bridge.close(); peer?.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); });
  return bridge;
}

test("DR29: real private replies are correlated; cancellation and late replies cannot fill another selector", async t => {
  const w = world(t), reference = save(w, 1); let old: Record<string, unknown> | undefined;
  const bridge = await channel(t, w, (raw, socket) => {
    if (raw.id === "host-history-1") { old = raw; return; }
    socket.write(encodeFrame({ id: old!.id, result: { sessions: [], after: null } }));
    void hostPersonalHistoryQuery(w.root, parseHostHistoryQuery(raw)).then(result => socket.write(encodeFrame({ id: raw.id, result })));
  });
  const abort = new AbortController(), reason = new Error("selector cancelled");
  const first = bridge.pages(() => assert.fail("cancelled selector consumed a reply"), abort.signal);
  await new Promise<void>(resolve => setTimeout(resolve, 20)); abort.abort(reason); await assert.rejects(first, error => error === reason);
  const found: string[] = []; await bridge.pages(page => found.push(...page.sessions.map(info => info.reference)));
  assert.deepEqual(found, [reference]);
});

for (const kind of ["closed", "partial", "damaged", "empty-error"] as const)
  test(`DR29: ${kind} private observation remains unknown`, async t => {
    const w = world(t), bridge = await channel(t, w, (raw, socket) => {
      if (kind === "closed") socket.end();
      else if (kind === "partial") socket.end(encodeFrame({ id: raw.id, result: {} }).subarray(0, 5));
      else if (kind === "damaged") socket.end(encodeFrame({ id: raw.id, result: [], cwd: "/host" }));
      else socket.write(encodeFrame({ id: raw.id, error: "unavailable" }));
    });
    await assert.rejects(bridge.pages(() => assert.fail("unknown became a history list")), { code: "BROKER_UNAVAILABLE" });
  });

test("Session mode: final Personal choice is flushed to the host before EOF", async t => {
  const w = world(t), seen: Record<string, unknown>[] = [];
  let ended!: () => void; const eof = new Promise<void>(resolve => { ended = resolve; });
  const bridge = await channel(t, w, (raw, socket) => { seen.push(raw); socket.once("end", ended); });
  await bridge.finish(null, "personal"); await eof;
  assert.deepEqual(seen, [{ next: "new", mode: "personal" }]);
});

test("DR29: final resume is exactly one flushed private request followed by EOF", async t => {
  const w = world(t), reference = save(w, 1), seen: Record<string, unknown>[] = [];
  let ended!: () => void; const eof = new Promise<void>(resolve => { ended = resolve; });
  const bridge = await channel(t, w, (raw, socket) => { seen.push(raw); socket.once("end", ended); });
  await bridge.finish(reference); await eof;
  assert.deepEqual(seen, [{ next: "resume", history: reference }]);
  await assert.rejects(bridge.finish(reference), { code: "BROKER_UNAVAILABLE" });
});
