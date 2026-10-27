// Repro for src/platform/rpc.ts FramedPeer: verifies P0-5 (unknown outcome on
// timeout / connection close is ENGINE_UNAVAILABLE retry=same-key, never a
// refusal), and that oversized sends are rejected before hitting the wire.
import { FramedPeer, unknownOutcome, PlatformError } from "../../../../dist/src/platform/rpc.js";
import net from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "oma-adv-G12-rpc-"));
const sockPath = join(dir, "s.sock");
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log("PASS", name); } else { fail++; console.log("FAIL", name); } };

function makePair() {
  return new Promise((resolve) => {
    const server = net.createServer(s => { resolve({ server, serverSock: s }); });
    server.listen(sockPath, () => {
      const client = net.connect(sockPath);
      client.once("connect", () => { pairClient = client; });
    });
  });
}
let pairClient = null;

try {
  const { server, serverSock } = await makePair();
  await new Promise(r => setTimeout(r, 50));

  // 1. Timeout: server never answers.
  const peer = new FramedPeer(pairClient, { frameBytes: 1 << 20, requestTimeoutMs: 200 });
  let timeoutErr = null;
  try { await peer.request("noop", {}); } catch (e) { timeoutErr = e; }
  ok("timeout->PlatformError", timeoutErr instanceof PlatformError);
  ok("timeout->ENGINE_UNAVAILABLE", timeoutErr?.failure?.code === "ENGINE_UNAVAILABLE");
  ok("timeout->same-key (P0-5, unknown not failed)", timeoutErr?.failure?.retry === "same-key");

  // 2. Connection close mid-request -> unknown, not failed.
  const peer2sock = net.connect(sockPath);
  await new Promise(r => peer2sock.once("connect", r));
  await new Promise(r => setTimeout(r, 30));
  const peer2 = new FramedPeer(peer2sock, { frameBytes: 1 << 20, requestTimeoutMs: 5000 });
  const p = peer2.request("noop", {});
  // Destroy the server-side socket to force a close.
  for (const c of server._connections !== undefined ? [] : []) void c;
  peer2sock.destroy();
  let closeErr = null;
  try { await p; } catch (e) { closeErr = e; }
  ok("close->ENGINE_UNAVAILABLE", closeErr?.failure?.code === "ENGINE_UNAVAILABLE");
  ok("close->same-key", closeErr?.failure?.retry === "same-key");

  // 3. Oversized send rejected with FRAME_TOO_LARGE before write.
  const peer3sock = net.connect(sockPath);
  await new Promise(r => peer3sock.once("connect", r));
  const peer3 = new FramedPeer(peer3sock, { frameBytes: 64, requestTimeoutMs: 5000 });
  let sendErr = null;
  try { peer3.send({ v: 1, id: "x", method: "m", params: { big: "A".repeat(1000) } }); }
  catch (e) { sendErr = e; }
  ok("oversize send throws", sendErr !== null);
  ok("oversize send code FRAME_TOO_LARGE", sendErr?.code === "FRAME_TOO_LARGE");
  peer3.close();

  server.close();
} finally {
  rmSync(dir, { recursive: true, force: true });
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}
