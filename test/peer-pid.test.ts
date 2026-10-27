import { test } from "node:test";
import assert from "node:assert/strict";
import { connect, createServer, type Socket } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { closeSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { peerCred, peerPidFd, pidfdLiveness } from "@oma/native/linux";
import { PeerAuthenticator } from "@oma/broker/peer-authenticator";
import { pinLinuxPeer } from "@oma/platform-linux/peer-identity";

test("AUTH-003 native: peer pidfd detects connector death while an inherited socket stays open", { timeout: 5000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-peer-pid-"));
  const path = join(root, "peer.sock");
  const server = createServer();
  await new Promise<void>(resolve => server.listen(path, resolve));
  const accepted = once(server, "connection");
  const child = spawn("python3", ["-c", [
    "import socket,sys,os",
    "s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM); s.settimeout(3); s.connect(sys.argv[1])",
    "s.sendall(b'ready'); assert s.recv(1)==b'x'",
    "if os.fork()==0:",
    " s.sendall(b'inherited'); s.recv(1); os._exit(0)",
    "os._exit(0)",
  ].join("\n"), path], { timeout: 4000 });
  const exited = once(child, "exit");
  const childClosed = once(child, "close");
  let peer: Socket | undefined;
  let pinned: number | null = null;
  try {
    [peer] = await Promise.race([accepted, exited.then(() => { throw new Error("connector exited before connection"); })]) as [Socket];
    peer.on("error", () => {});
    assert.equal((await once(peer, "data"))[0].toString(), "ready");
    const fd = (peer as unknown as { _handle: { fd: number } })._handle.fd;
    assert.equal(peerCred(fd)?.pid, child.pid);
    pinned = peerPidFd(fd);
    assert.notEqual(pinned, null, "SO_PEERPIDFD must be supported; no PID-only fallback");
    assert.deepEqual(pidfdLiveness(pinned!), { kind: "running" });
    const info = readFileSync(`/proc/self/fdinfo/${pinned}`, "utf8");
    const flags = Number.parseInt(/^flags:\s+([0-7]+)$/m.exec(info)![1]!, 8);
    assert.notEqual(flags & 0o2000000, 0, "peer pidfd must be close-on-exec");
    const inherited = once(peer, "data");
    peer.write("x");
    assert.deepEqual(await exited, [0, null]);
    assert.equal((await inherited)[0].toString(), "inherited");
    assert.equal(peer.destroyed, false);
    assert.deepEqual(pidfdLiveness(pinned!), { kind: "exited" }, "the socket holder is not the original connector");
    const closed = once(peer, "close");
    peer.write("q");
    await closed;
  } finally {
    peer?.destroy();
    if (pinned !== null) closeSync(pinned);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    try { await Promise.all([exited, childClosed]); } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("AUTH-003 native binding seam: closing sockets releases pidfds and cannot revive old bindings", { timeout: 5000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-peer-close-"));
  const path = join(root, "peer.sock");
  const bindings: Array<{ alive: () => boolean } | null> = [];
  const validWhileConnected: boolean[] = [];
  const closed: Array<Promise<unknown>> = [];
  const cleanupErrors: unknown[] = [];
  const setupErrors: unknown[] = [];
  const sockets = new Set<Socket>();
  const server = createServer(peer => {
    sockets.add(peer); peer.once("close", () => sockets.delete(peer));
    closed.push(new Promise<void>(resolve => peer.once("close", resolve)));
    peer.on("error", () => {});
    // The shared binding/reference owner uses the actual Linux pin adapter.
    // No credential, PID or pidfd observation is replaced with a test value.
    try {
      const bound: ReturnType<PeerAuthenticator["bind"]> = Reflect.apply(PeerAuthenticator.prototype.bind,
        { pinPeer: pinLinuxPeer, cleanupError: (error: unknown) => { cleanupErrors.push(error); } }, [peer]);
      validWhileConnected.push(!!bound?.alive() && bindings.every(binding => binding && !binding.alive()));
      bindings.push(bound); peer.end();
    } catch (error) { setupErrors.push(error); peer.destroy(); }
  });
  try {
    await new Promise<void>(resolve => server.listen(path, resolve));
    const before = readdirSync("/proc/self/fd").length;
    for (let index = 0; index < 16; index++) {
      const client = connect(path);
      await once(client, "close");
      await closed[index];
      assert.deepEqual(setupErrors, []);
      assert.ok(bindings[index]);
      assert.equal(validWhileConnected[index], true);
      assert.ok(bindings.every(binding => binding && !binding.alive()));
      assert.equal(readdirSync("/proc/self/fd").length, before);
      assert.deepEqual(cleanupErrors, []);
    }
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});
