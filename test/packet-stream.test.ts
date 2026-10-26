/** Shared TS flow/ownership tests only. The driver here supplies no OS facts
 * and cannot qualify Darwin or any process/file/auth security gate. */
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { setImmediate as turn } from "node:timers/promises";
import { PacketStream, type PacketDriver, type PacketObservation, type OutboundPacket } from "@oma/process/packet-stream";

function fixture() {
  const sender: Readonly<{ identity: string }> = Object.freeze({ identity: "original" });
  const alien = Object.freeze({ identity: "other" });
  const incoming: PacketObservation<typeof sender>[] = [], output: OutboundPacket[] = [];
  let credit = 0, closes = 0, enabled = false, writing = false, queued = false, closed = false;
  let ready = (): void => {}, failure: Error | null = null, cleanupFailure: Error | null = null;
  const wake = (): void => {
    if (closed || queued || !(enabled && incoming.length || writing && credit)) return;
    queued = true;
    queueMicrotask(() => { queued = false; if (!closed) ready(); });
  };
  const driver: PacketDriver<typeof sender> = {
    maximumPacketBytes: 7,
    read() { const result = incoming.shift() ?? { kind: "again" as const }; wake(); return result; },
    send(packet) {
      if (failure) throw failure;
      if (!credit) return "again";
      credit--; output.push(packet.kind === "end" ? packet : { kind: "data", bytes: Buffer.from(packet.bytes) });
      return "sent";
    },
    watch(callback) {
      ready = callback;
      return { request(read, write) { enabled = read; writing = write; wake(); }, close() { closed = true; } };
    },
    close() { closes++; if (cleanupFailure) throw cleanupFailure; },
  };
  const stream = new PacketStream(driver, value => value === sender); stream.on("error", () => {});
  return { stream, sender, alien, output,
    offer(packet: PacketObservation<typeof sender>) { incoming.push(packet); wake(); },
    permit(count: number) { credit += count; wake(); },
    fail(error: Error, cleanup?: Error) { failure = error; cleanupFailure = cleanup ?? null; },
    closes: () => closes,
  };
}

test("packet stream retains one blocked write and emits each original byte once", { timeout: 3000 }, async t => {
  const f = fixture(); t.after(() => f.stream.destroy());
  const bytes = Buffer.alloc(103); bytes.forEach((_, index) => { bytes[index] = index; });
  let completed = false;
  const written = new Promise<void>((resolve, reject) => f.stream.write(bytes, error => { completed = true; if (error) reject(error); else resolve(); }));
  await turn(); assert.equal(completed, false); assert.equal(f.output.length, 0);
  f.permit(2); await turn();
  assert.equal(completed, false); assert.equal(f.output.length, 2);
  f.permit(100); await written;
  assert.deepEqual(Buffer.concat(f.output.filter(packet => packet.kind === "data").map(packet => Buffer.from(packet.bytes))), bytes);
  await new Promise<void>(resolve => f.stream.end(resolve));
  assert.equal(f.output.filter(packet => packet.kind === "end").length, 1);
  assert.equal(f.closes(), 0, "write EOF leaves the readable half owned");
});

test("packet stream refuses a foreign EOF before delivering end", { timeout: 3000 }, async () => {
  const f = fixture(); let ended = false;
  const failed = once(f.stream, "error"), closed = new Promise<void>(resolve => f.stream.once("close", resolve));
  f.stream.on("end", () => { ended = true; }); f.stream.resume();
  f.offer({ kind: "end", sender: f.alien });
  assert.equal((await failed)[0].code, "AUTH_FAILED"); await closed;
  assert.equal(ended, false); assert.equal(f.closes(), 1); assert.equal(f.stream.resourcesReturned, true);
});

test("authenticated packet EOF preserves half-open replies and closes after both halves", { timeout: 3000 }, async t => {
  const f = fixture(); t.after(() => f.stream.destroy());
  const chunks: Buffer[] = [];
  f.stream.on("data", bytes => { assert.ok(Buffer.isBuffer(bytes)); chunks.push(bytes); });
  const ended = once(f.stream, "end");
  f.offer({ kind: "data", bytes: Buffer.from("hello"), sender: f.sender }); f.offer({ kind: "end", sender: f.sender });
  await ended;
  assert.equal(Buffer.concat(chunks).toString(), "hello"); assert.equal(f.closes(), 0);
  const closed = once(f.stream, "close"); f.permit(100); f.stream.end(Buffer.from("answer")); await closed;
  assert.equal(f.closes(), 1); assert.equal(f.stream.resourcesReturned, true);
  assert.deepEqual(f.output, [{ kind: "data", bytes: Buffer.from("answer") }, { kind: "end" }]);
});

test("packet write failure settles its callback and preserves cleanup failure", { timeout: 3000 }, async () => {
  const f = fixture(), primary = new Error("enqueue not observed"), cleanup = new Error("right return not observed");
  f.fail(primary, cleanup);
  const failed = once(f.stream, "error"), closed = new Promise<void>(resolve => f.stream.once("close", resolve));
  const writeError = new Promise<Error | null | undefined>(resolve => f.stream.write(Buffer.from("request"), resolve));
  const error = (await failed)[0]; await closed;
  assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [primary, cleanup]);
  assert.equal(await writeError, error); assert.equal(f.closes(), 1); assert.equal(f.output.length, 0);
  assert.equal(f.stream.resourcesReturned, false);
});
