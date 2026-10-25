import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, connect } from "node:net";
import { hasNativeLeaf, peerCred, sdNotifyReady, socketDescriptor } from "@oma/native/linux";

test("UNIT-004: failed notify calls reject invalid addresses and do not leak descriptors", () => {
  assert.equal(hasNativeLeaf(), true);
  const root = mkdtempSync(join(tmpdir(), "oma-notify-"));
  try {
    const before = readdirSync("/proc/self/fd").length;
    for (let i = 0; i < 32; i++) assert.equal(sdNotifyReady(join(root, "missing.sock")), false);
    for (const address of ["", "/bad\0path", "@bad\0path", "/" + "x".repeat(107), "@" + "x".repeat(108)])
      assert.equal(sdNotifyReady(address), false);
    assert.equal(readdirSync("/proc/self/fd").length, before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("UNIT-004: real Unix datagram receives READY and the sender closes its descriptor", { timeout: 5000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-notify-"));
  const path = join(root, "notify.sock");
  const child = spawn("python3", ["-c", "import socket,sys; s=socket.socket(socket.AF_UNIX,socket.SOCK_DGRAM); s.bind(sys.argv[1]); s.settimeout(3); print('ready',flush=True); assert s.recv(128)==b'READY=1'; s.close()", path], { timeout: 4000 });
  const exited = once(child, "exit");
  try {
    await Promise.race([once(child.stdout, "data"), exited.then(() => { throw new Error("notify receiver exited before readiness"); })]);
    const before = readdirSync("/proc/self/fd").length;
    assert.equal(sdNotifyReady(path), true);
    assert.equal(readdirSync("/proc/self/fd").length, before);
    assert.deepEqual(await exited, [0, null]);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    try { await exited; } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("AUTH-003: the one runtime internal peer identity depends on is named and checked", async () => {
  // Node publishes no accessor for an accepted socket's descriptor, and
  // SO_PEERCRED needs one. The dependency lives in the leaf with the other
  // primitives that have no public API, so a Node release that removes it fails
  // here -- loudly and in one place -- rather than as an authentication error.
  assert.equal(hasNativeLeaf(), true);
  for (const value of [null, undefined, {}, { _handle: null }, { _handle: {} },
    { _handle: { fd: -1 } }, { _handle: { fd: "3" } }, { _handle: { fd: 1.5 } }, 5, "socket"])
    assert.equal(socketDescriptor(value), null, `accepted ${JSON.stringify(value)}`);

  const root = mkdtempSync(join(tmpdir(), "oma-leaf-fd-"));
  const path = join(root, "peer.sock");
  const server = createServer();
  try {
    await new Promise<void>(resolve => { server.listen(path, resolve); });
    // Read while the connection is open: the descriptor belongs to the socket
    // and means nothing once it is closed.
    const accepted = new Promise<{ fd: number | null; pid: number | undefined }>(resolve => {
      server.once("connection", socket => {
        const fd = socketDescriptor(socket);
        resolve({ fd, pid: fd === null ? undefined : peerCred(fd)?.pid });
        socket.destroy();
      });
    });
    const client = connect(path);
    await new Promise<void>(resolve => client.once("connect", resolve));
    const observed = await accepted;
    assert.ok(typeof observed.fd === "number" && observed.fd >= 0, "an accepted socket has no descriptor");
    // The descriptor is the real one: SO_PEERCRED on it names this process.
    assert.equal(observed.pid, process.pid);
    client.destroy();
  } finally {
    await new Promise<void>(resolve => { server.close(() => resolve()); });
    rmSync(root, { recursive: true, force: true });
  }
});
