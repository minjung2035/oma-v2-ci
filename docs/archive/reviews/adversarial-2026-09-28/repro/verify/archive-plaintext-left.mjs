// X-03 verification: when the host process dies while it receives an archive
// stream, the plain (unencrypted) archive stays in run/transfer.
// service.ts:137-140 removes it only in a `finally`, which a process crash does
// not run, and nothing removes run/transfer/*.archive.tar at the next start.
// The death is the one X2-01 found: writeSync throws ENOSPC inside the socket
// "data" listener of project.ts:getStream, which is an uncaught exception.
// Usage (from the repository root): timeout 60 node review/adversarial-2026-09-28/repro/verify/archive-plaintext-left.mjs
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "oma-adv-verify-"));
const dist = resolve("dist/src");
try {
  const plain = join(dir, "transfer", "k.archive.tar");
  const child = join(dir, "child.mjs");
  writeFileSync(child, `
import { createRequire, syncBuiltinESMExports } from "node:module";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const fs = require("node:fs");
const { encodeFrame } = await import(${JSON.stringify(join(dist, "frame.js"))});
const { getStream } = await import(${JSON.stringify(join(dist, "platform/host/project.js"))});
mkdirSync(${JSON.stringify(join(dir, "transfer"))}, { recursive: true, mode: 0o700 });
const secret = Buffer.alloc(1 << 20, "PRIVATE-CONTEXT ");
const sha256 = createHash("sha256").update(secret).digest("hex");
const sock = ${JSON.stringify(join(dir, "g.sock"))};
net.createServer(peer => {
  peer.once("data", () => {
    peer.write(encodeFrame({ v: 1, id: "get", ok: true, result: { bytes: secret.length, sha256 } }));
    peer.write(secret.subarray(0, 1 << 19)); // half, then more
    setTimeout(() => peer.end(secret.subarray(1 << 19)), 50);
  });
}).listen(sock, async () => {
  // The Mac disk fills while the second half arrives.
  let calls = 0; const real = fs.writeSync;
  fs.writeSync = (...a) => { if (++calls > 2) { const e = new Error("ENOSPC: no space left on device, write"); e.code = "ENOSPC"; throw e; } return real(...a); };
  syncBuiltinESMExports();
  const socket = net.connect(sock);
  await new Promise(r => socket.once("connect", r));
  try {
    await getStream({ socket, rest: Buffer.alloc(0) }, "k", ${JSON.stringify(plain)}, 1 << 20, "archive");
  } finally {
    // service.ts:140 -- the cleanup the product relies on.
    fs.rmSync(${JSON.stringify(plain)}, { force: true });
    console.log("finally ran");
  }
});
`);
  const run = spawnSync(process.execPath, [child], { encoding: "utf8", timeout: 30_000 });
  const died = run.status !== 0 && /ENOSPC/.test(run.stderr);
  console.log(`host process ${died ? "died with an uncaught ENOSPC" : `exited ${run.status}`}; finally ran: ${/finally ran/.test(run.stdout)}`);
  if (existsSync(plain)) {
    const bytes = readFileSync(plain);
    console.log(`plain archive left: ${plain.slice(dir.length)} (${statSync(plain).size} bytes, mode ${(statSync(plain).mode & 0o777).toString(8)}), begins "${bytes.subarray(0, 16).toString()}"`);
    console.log("CONFIRMED: unencrypted archive bytes remain on disk after the host process died (MAC-621)");
  } else console.log("plain archive was removed");
} finally { rmSync(dir, { recursive: true, force: true }); }
