// X-01 verification: run uring-socket.c inside bubblewrap with the isolation
// flags of src/sandbox.ts:99 (the Resident sandbox), with and without the
// product's seccomp filter (src/runtime/vsock-seccomp.ts). A vsock listener on
// the local CID (VMADDR_CID_LOCAL, loopback only) stands in for any vsock
// service outside the sandbox; the sandboxed program connects to it through
// the socket io_uring made. Nothing leaves this machine.
// Usage (from the repository root): timeout 60 node review/adversarial-2026-09-28/repro/verify/uring-socket.mjs
import { spawn, spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { vsockSeccompFilter } from "../../../../dist/src/runtime/vsock-seccomp.js";

const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "oma-adv-verify-"));
const port = 40000 + Math.floor(Math.random() * 20000);
const listener = spawn("python3", ["-c", `
import socket
s = socket.socket(40, socket.SOCK_STREAM); s.bind((1, ${port})); s.listen(1)
print("ready", flush=True); s.settimeout(20)
c, _ = s.accept(); c.sendall(b"outside-service"); c.close()`], { stdio: ["ignore", "pipe", "inherit"] });
try {
  await new Promise((resolve, reject) => { listener.stdout.once("data", resolve); listener.once("exit", reject); });
  const binary = join(dir, "uring-socket");
  const cc = spawnSync("gcc", ["-O1", "-o", binary, join(here, "uring-socket.c")], { encoding: "utf8" });
  if (cc.status !== 0) throw new Error(cc.stderr);
  const run = (filter, args) => {
    const path = join(dir, "filter.bpf");
    writeFileSync(path, filter ?? Buffer.alloc(0));
    const fd = openSync(path, "r");
    try {
      const out = spawnSync("bwrap", ["--unshare-all", "--new-session", "--die-with-parent", "--cap-drop", "ALL",
        "--ro-bind", "/", "/", "--dev", "/dev", ...(filter ? ["--seccomp", "3"] : []), binary, ...args],
        { stdio: ["ignore", "pipe", "pipe", fd], encoding: "utf8", timeout: 20_000 });
      return (out.stdout + out.stderr).trim();
    } finally { closeSync(fd); }
  };
  const without = run(null, []);
  const withFilter = run(vsockSeccompFilter(), [String(port)]);
  console.log(`without filter : socket()=${without.split(" ")[0]} io_uring=${without.split(" ").slice(1).join(" ")}`);
  console.log(`with filter    : socket()=${withFilter.split(" ")[0]} io_uring=${withFilter.split(" ").slice(1).join(" ")}`);
  if (withFilter.startsWith("EPERM") && withFilter.includes("connected:outside-service"))
    console.log("BYPASS: socket(AF_VSOCK) is refused, but an io_uring IORING_OP_SOCKET vsock socket reached a listener outside the sandbox");
  else if (withFilter.startsWith("EPERM") && / made/.test(withFilter))
    console.log("BYPASS: io_uring makes an AF_VSOCK socket the filter was meant to refuse");
  else console.log("no bypass observed on this kernel");
} finally {
  listener.kill();
  rmSync(dir, { recursive: true, force: true });
}
