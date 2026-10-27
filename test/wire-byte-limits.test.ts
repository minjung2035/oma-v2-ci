/** V26C (WP26): the frame budget is counted in encoded bytes, in both
 * directions of the real BrokerChannel over a real Unix socket. Text whose
 * character count fits but whose UTF-8 encoding does not is refused before it
 * is written, and a response past the budget is a failure, never a result.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrokerChannel } from "@oma/client/channel";
import { FrameParser, encodeFrame } from "@oma/protocol/frame";

const ID = `rpc-${"0".repeat(8)}-0000-4000-8000-${"0".repeat(12)}`;
const status = (reason: string) => ({ observedAtMs: 1, agents: [{ agent: "alice", desired: "enabled", activeState: null, subState: null,
  unitResult: null, execMainStatus: null, pending: 0, preparedBatches: 0, reason, runnerObservedAtMs: null }] });
const encodedBody = (value: object) => encodeFrame(value).length - 4;

async function exchange(frameBytes: number, params: Record<string, unknown>, answer: (id: string) => object) {
  const root = mkdtempSync(join(tmpdir(), "oma-v26c-"));
  const received: unknown[] = [];
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket);
    const parser = new FrameParser(1024 * 1024);
    socket.on("error", () => {});
    socket.on("data", (chunk: Buffer) => {
      for (const frame of parser.feed(chunk)) { received.push(frame.raw); socket.write(encodeFrame(answer(String(frame.raw.id)))); }
    });
  });
  const path = join(root, "peer.sock");
  await new Promise<void>(resolve => server.listen(path, resolve));
  const channel = new BrokerChannel({ frameBytes, idleStreamSeconds: 5, receiptWaitSeconds: 5 });
  try {
    await channel.connect(path);
    const reply = await channel.call("status.get", params).then(value => ({ value, error: null }), (error: Error & { code?: string }) => ({ value: null, error }));
    return { ...reply, received };
  } finally {
    channel.close();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
}

test("V26C: a request is measured in encoded bytes, not characters, before anything is written", async () => {
  const params = { agent: "한".repeat(300) };                        // 300 characters, 900 bytes
  const exact = encodedBody({ v: 1, id: ID, method: "status.get", params });
  assert.ok(JSON.stringify(params).length < exact - 600, "the fixture does not separate characters from bytes");
  const fits = await exchange(exact, params, id => ({ v: 1, id, ok: true, result: status("") }));
  assert.equal(fits.error, null, String(fits.error));
  assert.equal(fits.received.length, 1);
  const over = await exchange(exact - 1, params, id => ({ v: 1, id, ok: true, result: status("") }));
  assert.equal(over.error?.code, "FRAME_TOO_LARGE");
  assert.equal(over.received.length, 0, "an oversized request reached the peer");
});

test("V26C: a response past the budget in encoded bytes is a failure, never a result", async () => {
  const reason = "😀".repeat(200);                                   // 400 UTF-16 units, 800 bytes
  const exact = encodedBody({ v: 1, id: ID, ok: true, result: status(reason) });
  const fits = await exchange(exact, {}, id => ({ v: 1, id, ok: true, result: status(reason) }));
  assert.equal(fits.error, null, String(fits.error));
  assert.equal(fits.value?.ok, true);
  const over = await exchange(exact - 1, {}, id => ({ v: 1, id, ok: true, result: status(reason) }));
  assert.equal(over.value, null, "an oversized response was handed over as a result");
  assert.equal(over.error?.code, "FRAME_TOO_LARGE");
});

test("V26C: a response for another request id or with an unknown field is not this call's result", async () => {
  for (const [name, answer] of [
    ["another id", (id: string) => ({ v: 1, id: `${id}x`, ok: true, result: status("") })],
    ["unknown envelope field", (id: string) => ({ v: 1, id, ok: true, result: status(""), extra: true })],
    ["unknown result field", (id: string) => ({ v: 1, id, ok: true, result: { ...status(""), extra: true } })],
  ] as const) {
    const reply = await exchange(64 * 1024, {}, answer);
    assert.ok(reply.value === null || reply.value.ok === false, `${name}: accepted as a result`);
  }
});
