import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, connect } from "node:net";
import { hasNativeLeaf, peerCred, socketDescriptor } from "@oma/native/linux";

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
