// G03-broker-r2: in RpcConnection.dispatch, the effect (handle) resolves first,
// then encodeFrame runs; if the response exceeds frameBytes it becomes
// FRAME_TOO_LARGE and fatal() writes an ERROR frame to the caller. Confirm the
// caller sees an error even though handle already ran to completion (committed).
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RpcConnection } from "../../../../dist/src/broker/connection.js";
import { SharedPeerPin } from "../../../../dist/src/broker/peer-pin.js";
import { encodeFrame, FrameParser } from "../../../../dist/src/frame.js";

class Sock extends EventEmitter {
  destroyed = false; ended = false; writable = true; output = [];
  pause() {} resume() {} write(b) { this.output.push(Buffer.from(b)); return this.writable; }
  end(b) { if (b) this.output.push(Buffer.from(b)); this.ended = true; }
  destroy() { if (this.destroyed) return; this.destroyed = true; this.emit("close", false); }
}

const root = mkdtempSync(join(tmpdir(), "oma-adv-G03-r2-ftl-"));
const socket = new Sock();
const peer = new SharedPeerPin(() => true, () => {});
let effectRan = false;
const tasks = [];
const conn = new RpcConnection({
  socket, peer, stagingRoot: root,
  limits: { frameBytes: 256, idleStreamSeconds: 2, receiptWaitSeconds: 5 },
  handle: async () => { effectRan = true; /* imagine a durable commit here */ return { v: 1, id: "req", ok: true, result: { big: "x".repeat(2000) } }; },
  preflight: () => {},
  onTask: t => tasks.push(t),
});

socket.emit("data", encodeFrame({ v: 1, id: "req", method: "status.get", params: {} }));
await Promise.allSettled(tasks);
await new Promise(r => setImmediate(r));

const parser = new FrameParser(1 << 20);
const frames = [];
for (const chunk of socket.output) for (const f of parser.feed(chunk)) frames.push(f.raw);
console.log("effect ran (committed):", effectRan);
console.log("frames to caller:", JSON.stringify(frames));
console.log("caller sees:", frames.length ? (frames[0].ok ? "OK" : `ERROR ${frames[0].error?.code} retry=${frames[0].error?.retry}`) : "(none)");

rmSync(root, { recursive: true, force: true });
