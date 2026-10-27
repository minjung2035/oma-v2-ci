// Demonstrates that in stream.ts receive(), a synchronous writeSync() failure
// inside the socket "data" handler is NOT routed through finish(error): it
// throws out of the EventEmitter callback. We model the exact control flow of
// receive()'s onData without needing a real disk-full, by making writeSync
// throw (as ENOSPC/EIO/EDQUOT would).
//
// The point: serveStream() wraps only the *leading frame* await in try/catch;
// once receive() attaches socket.on("data", onData), a throw there is an
// uncaught exception on the process, not a STREAM refusal.

import { EventEmitter } from "node:events";

// Reproduce the onData control flow from dist/src/platform/guest/stream.ts.
function makeReceive(fdWrite, bytes, sha256Expected, hashOf) {
  const socket = new EventEmitter();
  socket.resume = () => {};
  let received = 0, done = false;
  const finish = (err) => { if (done) return; done = true; console.log("  finish called, err=", err && err.message); };
  const onData = (chunk) => {
    if (received + chunk.length > bytes) { finish(new Error("STREAM longer than declared")); return; }
    for (let at = 0; at < chunk.length; ) at += fdWrite(chunk, at, chunk.length - at); // writeSync stand-in
    received += chunk.length;
    if (received === bytes) finish(null);
  };
  socket.on("data", onData);
  return socket;
}

let sawUncaught = false;
process.on("uncaughtException", (e) => { sawUncaught = true; console.log("UNCAUGHT EXCEPTION escaped:", e.message); });

// writeSync stand-in that throws ENOSPC after accepting the first byte,
// exactly as fs.writeSync would when the data disk fills mid-stream.
const throwingWrite = () => { const e = new Error("ENOSPC: no space left on device, write"); e.code = "ENOSPC"; throw e; };

console.log("emitting data (from a timer, as a real socket does) with a writeSync that throws ENOSPC...");
const sock = makeReceive(throwingWrite, 100, "x", () => "x");
// A real Socket emits "data" from libuv's read callback: there is no JS caller
// on the stack that a try/catch could wrap. Model that with setImmediate.
setImmediate(() => { sock.emit("data", Buffer.alloc(10)); });

setTimeout(() => {
  console.log(sawUncaught
    ? "RESULT: a mid-stream writeSync failure becomes an uncaught exception (process crash)"
    : "RESULT: no uncaught exception (throw was contained)");
  process.exit(0);
}, 50);
