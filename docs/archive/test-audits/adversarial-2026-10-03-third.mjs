/** Third-pass REQUIRED-behavior oracles; current defects intentionally fail.
 * Disposable Unix sockets only; no VM, manager, engine, saved credential or
 * provider request. Host/guest byte-channel handshakes are supplied by the
 * local fixture, so these tests do not qualify native platform ownership.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs, { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { syncBuiltinESMExports } from "node:module";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InferenceRelay } from "#oma-test/app/runtime/inference-relay";
import { EgressForwarder, requestEgressPlaceholder } from "#oma-test/app/runtime/egress-forwarder";
import { EgressHost } from "#oma-test/app/platform/host/egress";
import { EgressPool, startEgressService } from "#oma-test/app/platform/guest/egress";
import { encodeFrame } from "../../dist/src/frame.js";
import { RequestLedger } from "#oma-test/app/platform/guest/requests";
import { StoreError } from "../../dist/src/domain/errors.js";

const RUN = { society: "demo", actor: "alice", incarnation: 3 };
const AUTH = { provider: "fixture", model: "fixture-model", origin: "https://provider.invalid/v1",
  apiKey: "sk-ant-api03-SYNTHETIC-only-xxxxxxxxxxxxxxxxxxxx", headers: {} };
const delay = ms => new Promise(done => setTimeout(done, ms));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function until(check, message) {
  const end = performance.now() + 2000;
  while (!check() && performance.now() < end) await delay(5);
  assert.ok(check(), message);
}
async function connected(path) {
  const socket = connect(path);
  socket.on("error", () => {});
  await new Promise((done, fail) => { socket.once("connect", done); socket.once("error", fail); });
  return socket;
}
async function listening(server, path) {
  await new Promise((done, fail) => { server.once("error", fail); server.listen(path, done); });
}
async function closeServer(server) {
  if (server.listening) await new Promise(done => server.close(done));
}

/** Actual product pool, service, placeholder parser and host relay. The
 * fixture supplies a completed byte channel over a disposable Unix socket. */
async function world(resolveAuth = async () => AUTH) {
  const dir = mkdtempSync(join(tmpdir(), "oma-audit-egress-"));
  const sockets = new Set();
  const track = socket => { sockets.add(socket); socket.on("error", () => {}); socket.once("close", () => sockets.delete(socket)); };
  const pool = new EgressPool();
  const guestPath = join(dir, "guest.sock"), servicePath = join(dir, "egress.sock");
  const guest = createServer(socket => { track(socket); pool.park(socket); });
  await listening(guest, guestPath);
  const service = await startEgressService({ socketPath: servicePath, pool, frameBytes: 262144, deadlineMs: 2000 });
  service.on("connection", track);
  const host = new EgressHost({ open: async () => {
    const socket = await connected(guestPath); track(socket);
    return { socket, rest: Buffer.alloc(0) };
  }, resolve: resolveAuth, limits: { concurrent: 1, timeoutMs: 2000 }, frameBytes: 262144, maxPool: 8 });
  await host.fill();
  await until(() => pool.size === 2, "fixture pool ready");
  return { dir, host, pool, servicePath,
    issue: () => requestEgressPlaceholder({ socket: servicePath, frameBytes: 262144, deadlineMs: 2000 }, RUN, "fixture", "current", 2),
    async close() {
      await host.stop(); pool.close();
      for (const socket of sockets) socket.destroy();
      await closeServer(service); await closeServer(guest);
      rmSync(dir, { recursive: true, force: true });
    } };
}

/** Connect through the actual service/host with a forbidden endpoint path.
 * HTTP 403 proves the relay still accepted the connection, without making
 * ANY upstream provider request. A revoked placeholder must simply close. */
async function relayProbe(w, issued) {
  await w.host.fill();
  await until(() => w.pool.size > 0, "probe pool ready");
  const socket = await connected(w.servicePath);
  let body = "";
  try {
    const closed = new Promise(done => socket.once("close", done));
    socket.on("data", bytes => { body += bytes.toString("utf8"); socket.destroy(); });
    socket.write(Buffer.concat([encodeFrame({ v: 1, id: "probe", method: "egress.open",
      params: { placeholderId: issued.placeholderId, ...RUN, modelProfile: "fixture" } }),
    Buffer.from("GET /../../outside HTTP/1.1\r\nHost: fixture\r\nConnection: close\r\n\r\n")]));
    await Promise.race([closed, delay(1000)]);
    return body;
  } finally { socket.destroy(); }
}

test("AV-20261003-13: a relay rejected after listen must return its socket and listener", async t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-audit-relay-open-")), path = join(dir, "relay.sock");
  const chmod = fs.chmodSync, makeServer = http.createServer;
  let server, failure;
  try {
    http.createServer = (...args) => { server = makeServer(...args); return server; };
    fs.chmodSync = (file, ...args) => {
      if (file === path) throw Object.assign(new Error("injected socket chmod I/O failure"), { code: "EIO" });
      return chmod(file, ...args);
    };
    syncBuiltinESMExports();
    try { await InferenceRelay.open(path, { origin: AUTH.origin, headers: {} }, { concurrent: 1, timeoutMs: 2000 }); }
    catch (error) { failure = error.code; }
    fs.chmodSync = chmod; http.createServer = makeServer; syncBuiltinESMExports();
    assert.equal(failure, "EIO", "the fault must occur after successful listen");
    const leaked = { listening: server.listening, socketName: existsSync(path) };
    t.diagnostic(JSON.stringify({ rejected: failure, ...leaked }));
    assert.deepEqual(leaked, { listening: false, socketName: false }, "a rejected opener returns no owner to the caller");
  } finally {
    fs.chmodSync = chmod; http.createServer = makeServer; syncBuiltinESMExports();
    server?.closeAllConnections(); if (server) await closeServer(server);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AV-20261003-14: delayed credential resolution cannot recreate a run after boot revocation or stop", async t => {
  const observed = [];
  for (const boundary of ["forgetBoot", "stop"]) {
    const entered = deferred(), release = deferred();
    const w = await world(async () => { entered.resolve(); await release.promise; return AUTH; });
    try {
      const answer = w.issue();
      await entered.promise;
      await w.host[boundary]();
      assert.equal(w.host.activeRuns, 0, "revocation has completed before the old resolver is released");
      release.resolve();
      let issued, error;
      try { issued = await answer; } catch (caught) { error = caught.code; }
      const row = { boundary, activeRunsAfterResolution: w.host.activeRuns, issued: Boolean(issued), error: error ?? null };
      // After a reboot, the old resolver even grants an operational relay.
      if (boundary === "forgetBoot" && issued) row.oldRelayStillAnswers = (await relayProbe(w, issued)).startsWith("HTTP/1.1 403");
      observed.push(row);
    } finally { release.resolve(); await w.close(); }
  }
  t.diagnostic(JSON.stringify(observed));
  assert.deepEqual(observed.map(row => row.activeRunsAfterResolution), [0, 0], "authority must not be accepted by a revoked asynchronous owner");
});

test("AV-20261003-15: ending a guest run must also release the host's run and placeholder", async t => {
  const w = await world();
  let forwarder;
  try {
    const issued = [], counts = [];
    for (let i = 0; i < 3; i++) {
      const run = await w.issue(); issued.push(run);
      forwarder = await EgressForwarder.listen(join(w.dir, "engine.sock"), w.servicePath,
        { placeholderId: run.placeholderId, ...RUN, modelProfile: "fixture" }, 1);
      // runner.ts's delivery finally performs exactly this run teardown.
      await forwarder.close();
      counts.push(w.host.activeRuns);
    }
    const stale = await relayProbe(w, issued[0]);
    // Control: release itself works when invoked, but normal teardown never
    // invokes it across the guest/host boundary.
    for (const run of issued) await w.host.release(run.placeholderId);
    assert.equal(w.host.activeRuns, 0);
    assert.equal(await relayProbe(w, issued[0]), "");
    t.diagnostic(JSON.stringify({ forwarderEnded: !existsSync(forwarder.socketPath),
      retainedAfterEachEnd: counts, stalePlaceholderStillAnswers: stale.startsWith("HTTP/1.1 403"), explicitReleaseControl: "closed" }));
    assert.deepEqual(counts, [0, 0, 0], "the engine-side forwarders are gone but the host never receives a release");
    assert.equal(stale, "");
  } finally { await forwarder?.close(); await w.close(); }
});

test("AV-20261003-16: detached relays enforce the same idle connection bound as listening relays", async t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-audit-relay-bound-"));
  const sockets = new Set();
  const local = await InferenceRelay.open(join(dir, "local.sock"), { origin: AUTH.origin, headers: {} }, { concurrent: 1, timeoutMs: 2000 });
  const detached = InferenceRelay.detached({ origin: AUTH.origin, headers: {} }, { concurrent: 1, timeoutMs: 2000 });
  const guest = createServer(socket => { sockets.add(socket); socket.on("error", () => {}); detached.accept(socket); });
  await listening(guest, join(dir, "detached.sock"));
  try {
    const clients = { listening: [], detached: [] };
    for (const [kind, path] of [["listening", join(dir, "local.sock")], ["detached", join(dir, "detached.sock")]]) {
      for (let i = 0; i < 6; i++) {
        const socket = await connected(path); sockets.add(socket); clients[kind].push(socket);
        // An unfinished HTTP header holds an idle connection; it makes no
        // provider request and sends only a few dozen fixture bytes.
        socket.write("GET /messages HTTP/1.1\r\nHost: fixture\r\n");
      }
    }
    await until(() => clients.listening.filter(s => !s.destroyed).length === 4, "listening relay's existing four-connection control");
    await delay(30);
    const live = Object.fromEntries(Object.entries(clients).map(([kind, all]) => [kind, all.filter(s => !s.destroyed).length]));
    t.diagnostic(JSON.stringify({ concurrent: 1, expectedConnections: 4, ...live }));
    assert.equal(live.detached, live.listening, "maxConnections is checked by net.Server.listen, not by emit(connection)");
  } finally {
    for (const socket of sockets) socket.destroy();
    await local.close(); await detached.close(); await closeServer(guest);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AV-20261003-17: a malformed durable refusal is corruption, never a successful outcome", async t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-audit-platform-ledger-"));
  try {
    const ledger = new RequestLedger(dir), key = "fixture-refusal", params = { project: "fixture" };
    let effects = 0;
    await assert.rejects(ledger.run(key, "fixture.method", params, async () => {
      effects++; throw new StoreError("INVALID_REQUEST", "fixture was refused");
    }), error => error.failure?.code === "INVALID_REQUEST");
    assert.equal(ledger.status(key).state, "refused");
    const file = ledger.staging(key, "outcome.json");
    const outcome = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(outcome.ok, false);
    // Physical corruption fault: retain valid JSON and the original refusal,
    // but change the boolean's type. No engine, DB, or real ledger is used.
    outcome.ok = "false";
    writeFileSync(file, JSON.stringify(outcome));
    const reopened = new RequestLedger(dir);
    const status = reopened.status(key);
    let answer, error;
    try { answer = await reopened.run(key, "fixture.method", params, async () => { effects++; return { unexpected: true }; }); }
    catch (caught) { error = caught.code ?? caught.failure?.code; }
    assert.equal(effects, 1, "historical replay must not re-execute its effect");
    t.diagnostic(JSON.stringify({ original: "refused", corruptBoolean: outcome.ok,
      status: status.state, replayResolved: error === undefined, replayValue: answer ?? null, error: error ?? null, effects }));
    assert.equal(error, "STORE_CORRUPT", "both the observer and replay must decode durable outcomes, rather than trust truthiness");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
