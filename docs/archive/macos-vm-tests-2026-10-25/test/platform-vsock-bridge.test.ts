import { GUEST_IMAGE_ASSETS } from "@oma/platform-linux/guest-assets";
/** MAC-202: the guest's only vsock code. The bridge is built here from its
 * source and driven over this machine's own vsock loopback, as systemd drives
 * it in the guest (one instance per accepted connection, the socket as fd 3).
 * A loopback peer has CID 1, which is exactly what the production build must
 * refuse; a build that allows CID 1 shows the relay itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = join(GUEST_IMAGE_ASSETS, "bridge", "oma-vsock-bridge.c");

function vsockLoopback(): boolean {
  const probe = spawnSync("python3", ["-c", `
import socket
l = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM); l.bind((socket.VMADDR_CID_ANY, socket.VMADDR_PORT_ANY)); l.listen(1)
c = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM); c.settimeout(2); c.connect((1, l.getsockname()[1]))`], { encoding: "utf8" });
  return probe.status === 0;
}
const available = vsockLoopback();

/** Accepts one vsock loopback connection, starts the bridge on it the way
 * systemd would, and reports what the client and the unix-side service saw. */
const HARNESS = String.raw`
import json, os, socket, subprocess, sys, threading
bridge, service_path, mode = sys.argv[1], sys.argv[2], sys.argv[3]
server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM); server.bind(service_path); server.listen(1); server.settimeout(3)
seen = {"service_connected": False, "service_got": ""}
def serve():
    try:
        conn, _ = server.accept()
    except OSError:
        return
    seen["service_connected"] = True
    data = b""
    while True:
        chunk = conn.recv(65536)
        if not chunk: break
        data += chunk
    seen["service_got"] = data.decode()
    conn.sendall(b"pong:" + data)
    conn.close()
thread = threading.Thread(target=serve, daemon=True); thread.start()
listener = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM); listener.bind((socket.VMADDR_CID_ANY, socket.VMADDR_PORT_ANY)); listener.listen(1)
client = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM); client.settimeout(5); client.connect((1, listener.getsockname()[1]))
accepted, _ = listener.accept()
fd = accepted.fileno()
def child():
    os.dup2(fd, 3)
env = dict(os.environ, LISTEN_FDS="1")
pid_expr = "$$" if mode != "wrong-pid" else "1"
process = subprocess.Popen(["sh", "-c", 'LISTEN_PID=' + pid_expr + ' exec "$0" "$1"', bridge, service_path],
                           pass_fds=(fd, 3), preexec_fn=child, env=env, stderr=subprocess.PIPE)
accepted.close()
reply = b""
if mode == "relay":
    client.sendall(b"ping"); client.shutdown(socket.SHUT_WR)
    while True:
        chunk = client.recv(65536)
        if not chunk: break
        reply += chunk
_, err = process.communicate(timeout=10)
client.close(); thread.join(timeout=3)
print(json.dumps({"exit": process.returncode, "stderr": err.decode(), "reply": reply.decode(), **seen}))
`;

function build(dir: string, allowedCid: number | null): string {
  const output = join(dir, allowedCid === null ? "bridge" : `bridge-${allowedCid}`);
  execFileSync("gcc", ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror",
    ...(allowedCid === null ? [] : [`-DOMA_ALLOWED_CID=${allowedCid}`]), "-o", output, SOURCE]);
  return output;
}
function run(bridge: string, dir: string, mode: "relay" | "refused" | "wrong-pid"): Record<string, unknown> {
  const out = execFileSync("python3", ["-c", HARNESS, bridge, join(dir, `${mode}.sock`), mode], { encoding: "utf8", timeout: 20_000 });
  return JSON.parse(out.trim().split("\n").at(-1)!) as Record<string, unknown>;
}

test("MAC-202: the production bridge closes a connection that is not from the host, unread", { skip: available ? false : "no vsock loopback on this machine" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-bridge-"));
  try {
    const result = run(build(dir, null), dir, "refused");
    assert.equal(result.exit, 3, JSON.stringify(result));
    // Refused for the reason under test: the peer was identified, and it is not the host.
    assert.match(String(result.stderr), /not from the host/);
    assert.equal(result.service_connected, false, "the service was reached from a peer that is not the host");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("MAC-202: the bridge relays both ways and passes each end's close on", { skip: available ? false : "no vsock loopback on this machine" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-bridge-"));
  try {
    // A build that allows the loopback's CID stands in for the host's.
    const result = run(build(dir, 1), dir, "relay");
    assert.equal(result.exit, 0, JSON.stringify(result));
    assert.equal(result.service_got, "ping");
    assert.equal(result.reply, "pong:ping");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("MAC-202: the bridge runs only as the socket-activated instance its descriptor was given to", { skip: available ? false : "no vsock loopback on this machine" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-bridge-"));
  try {
    const result = run(build(dir, 1), dir, "wrong-pid");
    assert.equal(result.exit, 2, JSON.stringify(result));
    assert.equal(result.service_connected, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
