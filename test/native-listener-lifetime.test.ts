/** Listener ownership regressions. These exercise actual Unix listeners;
 * they do not qualify Darwin process/file/auth guarantees. */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as turn } from "node:timers/promises";
import { BrokerListeners } from "@oma/broker/listeners";

test("listener preparation failure after bind waits for actual close", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-listener-preparation-"));
  const server = createServer(), injected = new Error("injected preparation failure"), errors: unknown[] = [];
  const owner = new BrokerListeners(error => errors.push(error));
  try {
    owner.listen(server, join(root, "peer.sock"), () => { throw injected; });
    await assert.rejects(owner.ready(server), error => error === injected);
    assert.equal(server.listening, true, "failed preparation still owns a bound listener");
    const closed = once(server, "close");
    owner.close(server);
    const pending = owner.pendingCloses;
    assert.equal(pending.length, 1);
    await Promise.all(pending); await closed;
    assert.equal(server.listening, false);
    assert.equal(owner.pendingCloses.length, 0);
    assert.deepEqual(errors, [injected]);
  } finally {
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});

test("a failed bind also obtains a close observation", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-listener-bind-"));
  const server = createServer(), blocker = createServer(), errors: unknown[] = [];
  const owner = new BrokerListeners(error => errors.push(error));
  try {
    const path = join(root, "peer.sock");
    const bound = once(blocker, "listening"); blocker.listen(path); await bound;
    owner.listen(server, path);
    await assert.rejects(owner.ready(server), { code: "EADDRINUSE" });
    owner.close(server); await Promise.all(owner.pendingCloses);
    assert.equal(server.listening, false);
    assert.equal(blocker.listening, true, "failed acquisition must preserve the existing listener");
    assert.equal(owner.pendingCloses.length, 0);
    assert.equal(errors.length, 1);
  } finally {
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    await new Promise<void>(resolve => blocker.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});

test("a thrown close keeps a real listener pending instead of returning its owner", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-listener-close-"));
  const server = createServer(), injected = new Error("injected unanswered close"), errors: unknown[] = [];
  const owner = new BrokerListeners(error => errors.push(error)), close = server.close;
  try {
    owner.listen(server, join(root, "peer.sock")); await owner.ready(server);
    server.close = () => { throw injected; };
    owner.close(server);
    const pending = owner.pendingCloses;
    let returned = false; void Promise.all(pending).then(() => { returned = true; });
    await turn();
    assert.equal(server.listening, true);
    assert.equal(returned, false);
    assert.equal(owner.pendingCloses.length, 1);
    assert.deepEqual(errors, [injected]);
  } finally {
    server.close = close;
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});
