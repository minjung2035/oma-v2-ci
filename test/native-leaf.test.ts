import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { hasNativeLeaf, sdNotifyReady } from "../src/leaf.js";

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
