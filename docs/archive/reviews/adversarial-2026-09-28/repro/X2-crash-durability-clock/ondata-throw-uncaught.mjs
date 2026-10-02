// X2: prove that a synchronous throw inside a net.Socket "data" listener
// (as writeSync ENOSPC would raise in project.ts getStream / stream.ts receive)
// becomes an uncaughtException, not a rejection of the surrounding Promise.
import net from "node:net";

let uncaught = null;
let promiseRejected = false;

process.on("uncaughtException", (e) => {
  uncaught = e;
  finish();
});

const server = net.createServer((conn) => {
  // Mirror project.ts getStream: a Promise executor that registers
  // socket.on("data", take), where take throws synchronously.
  const p = new Promise((resolve, reject) => {
    const take = (_chunk) => {
      const err = new Error("ENOSPC: no space left on device, write");
      err.code = "ENOSPC";
      throw err; // writeSync would throw exactly here
    };
    conn.on("data", take);
    conn.once("error", () => reject(new Error("socket error")));
    conn.resume();
  });
  p.catch(() => { promiseRejected = true; });
});

let done = false;
function finish() {
  if (done) return;
  done = true;
  console.log("promiseRejected:", promiseRejected);
  console.log("uncaughtException code:", uncaught?.code ?? null);
  if (uncaught?.code === "ENOSPC" && !promiseRejected)
    console.log("RESULT: CONFIRMED — throw in on(\"data\") escapes the Promise -> uncaughtException (process would die without a handler)");
  else
    console.log("RESULT: not reproduced");
  try { server.close(); } catch {}
  process.exit(0);
}

server.listen(0, () => {
  const port = server.address().port;
  const c = net.connect(port, () => c.write(Buffer.from("payload")));
});

setTimeout(finish, 2000);
