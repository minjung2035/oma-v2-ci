/** A short transport name must not become a second metadata/configuration root. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync, readFileSync } from "node:fs";
import { createServer, connect, Server, Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { holdSocketNames } from "./fixtures/socket-names.js";

test("socket-name fixture: long transport paths work while metadata retains its canonical name", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-socket-name-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const listen = Server.prototype.listen, connection = Socket.prototype.connect;
  const held = holdSocketNames(root);
  const dir = join(root, "long-" + "x".repeat(70)); mkdirSync(dir);
  const metadata = join(dir, "settings.json"), socketPath = join(dir, "fixture.sock");
  writeFileSync(metadata, "unchanged");
  const server = createServer(socket => socket.end("answered"));
  let client: Socket | undefined;
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(socketPath, resolve); });
    client = connect({ path: socketPath });
    let bytes = "";
    client.on("data", chunk => { bytes += chunk; });
    await new Promise<void>((resolve, reject) => { client!.once("error", reject); client!.once("close", () => resolve()); });
    assert.equal(bytes, "answered");
    assert.equal(realpathSync(metadata), metadata);
    assert.equal(readFileSync(metadata, "utf8"), "unchanged");
  } finally {
    client?.destroy();
    try { await new Promise<void>(resolve => server.close(() => resolve())); }
    finally { held.close(); held.close(); }
  }
  assert.equal(Server.prototype.listen, listen);
  assert.equal(Socket.prototype.connect, connection);
});

for (const first of [0, 1]) test(`socket-name fixture: overlapping owners return out of order; first=${first}`, async t => {
  if (process.platform !== "linux") return;
  const root = mkdtempSync(join(tmpdir(), "oma-socket-overlap-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const listen = Server.prototype.listen, connection = Socket.prototype.connect;
  const roots = [join(root, "a" + "x".repeat(60)), join(root, "b" + "x".repeat(60))];
  for (const dir of roots) mkdirSync(dir);
  const held = roots.map(holdSocketNames);
  const server = createServer(socket => socket.end("still owned"));
  let client: Socket | undefined;
  try {
    held[first]!.close();
    const socketPath = join(roots[1 - first]!, "s.sock");
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(socketPath, resolve); });
    client = connect(socketPath);
    let bytes = ""; client.on("data", chunk => { bytes += chunk; });
    await new Promise<void>((resolve, reject) => { client!.once("error", reject); client!.once("close", () => resolve()); });
    assert.equal(bytes, "still owned");
  } finally {
    client?.destroy();
    try { await new Promise<void>(resolve => server.close(() => resolve())); }
    finally { for (const owner of held) { owner.close(); owner.close(); } }
  }
  assert.equal(Server.prototype.listen, listen);
  assert.equal(Socket.prototype.connect, connection);
});

test("socket-name fixture: a refused directory acquires no transport hooks", t => {
  if (process.platform !== "linux") return;
  const root = mkdtempSync(join(tmpdir(), "oma-socket-refused-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const target = join(root, "real"), linked = join(root, "linked");
  mkdirSync(target); symlinkSync(target, linked);
  const listen = Server.prototype.listen, connection = Socket.prototype.connect;
  assert.throws(() => holdSocketNames(linked), { code: "ENOTDIR" });
  assert.equal(Server.prototype.listen, listen);
  assert.equal(Socket.prototype.connect, connection);
});
