/** macos-platform §4.7 / §7 (MAC-225, MAC-704, MAC-710..712, MV-13, MV-25):
 * egress end to end on one machine -- the guest's pool and its service for
 * in-guest clients, behind the real guest server, and the host's pool and
 * per-run relays in front of a real TLS provider. The client plays the
 * runner: it asks for a placeholder, then speaks HTTP the way an engine does. */
import test from "node:test";
import assert from "node:assert/strict";
import { connect, type Server, type Socket } from "node:net";
import { request as httpRequest } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { encodeFrame } from "../src/frame.js";
import { StoreError } from "../src/domain/errors.js";
import { readLeadingFrame, sendHelloForBytes } from "../src/platform/rpc.js";
import { startGuestServer, type GuestIdentity } from "../src/platform/guest/server.js";
import { EgressPool, startEgressService } from "../src/platform/guest/egress.js";
import { EgressHost } from "../src/platform/host/egress.js";
import { HOST_GUEST_PROTOCOL, PLATFORM_FRAME_BYTES, type HelloParams } from "../src/protocol/host-guest.js";
import { tlsProvider, type TlsProvider } from "./fixtures/tls-provider.js";

// The provider's certificate is self-signed for the test, as in the relay's own tests.
const previousTlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
test.beforeEach(() => { process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; });
test.afterEach(() => {
  if (previousTlsSetting === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTlsSetting;
});

const INSTANCE = randomUUID();
const SECRET = "sk-ant-api03-REALSECRETyyyyyyyyyyyyyyyyyyyyy";
const identity = (): GuestIdentity => ({ instanceId: INSTANCE, guestImage: "2026.09.1", bootId: randomUUID(),
  stateSchema: { written: 1, readable: [1] }, capabilities: ["egress"] });
const egressHello: HelloParams = { channel: "egress", protocol: { min: HOST_GUEST_PROTOCOL, max: HOST_GUEST_PROTOCOL },
  hostVersion: "1.0.0", installationId: randomUUID(), instanceId: INSTANCE, expectImage: "2026.09.1" };
const RUN = { society: "demo", actor: "alice", incarnation: 3 };

async function world(t: import("node:test").TestContext, timeoutMs = 5000,
  resolve?: (credentialRef: string, provider: string, model: string) => Promise<{ provider: string; model: string; origin: string; apiKey: string; headers: Record<string, string> }>,
  extras?: { dial?: import("../src/runtime/connect-proxy.js").ConnectDial; audit?: (entry: import("../src/runtime/connect-proxy.js").EgressAudit) => void }) {
  const dir = mkdtempSync(join(tmpdir(), "oma-egress-"));
  const provider: TlsProvider = await tlsProvider();
  const pool = new EgressPool();
  const serviceSocket = join(dir, "egress.sock");
  const service: Server = await startEgressService({ socketPath: serviceSocket, pool, frameBytes: PLATFORM_FRAME_BYTES, deadlineMs: 5000 });
  const guestSocket = join(dir, "society.sock");
  const guest: Server = await startGuestServer({ socketPath: guestSocket, identity, bridge: { uid: process.getuid!(), gid: process.getgid!() },
    frameBytes: PLATFORM_FRAME_BYTES, helloDeadlineMs: 2000, requestTimeoutMs: 5000,
    channels: { egress: { kind: "bytes", serve: socket => { pool.park(socket); } } } });
  const resolved: string[] = [];
  const host = new EgressHost({
    open: async () => {
      const socket = connect(guestSocket);
      await new Promise<void>((ok, fail) => { socket.once("connect", ok); socket.once("error", fail); });
      return sendHelloForBytes(socket, egressHello, PLATFORM_FRAME_BYTES, 5000).then(({ rest }) => ({ socket, rest }));
    },
    resolve: resolve ?? (async (credentialRef, provider_, model) => {
      resolved.push(`${credentialRef}:${provider_}/${model}`);
      if (provider_ !== "anthropic") throw new StoreError("UNSUPPORTED_PROFILE", `the engine does not know ${provider_}/${model}`);
      return { provider: "anthropic", model: "claude-test", origin: `${provider.origin}/v1`, apiKey: SECRET, headers: {} };
    }),
    ...(extras?.dial === undefined ? {} : { dial: extras.dial }),
    ...(extras?.audit === undefined ? {} : { audit: extras.audit }),
    limits: { concurrent: 4, timeoutMs }, frameBytes: PLATFORM_FRAME_BYTES, maxPool: 32,
  });
  t.after(async () => {
    await host.stop();
    pool.close();
    await new Promise<void>(r => service.close(() => r()));
    await new Promise<void>(r => guest.close(() => r()));
    await provider.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { host, pool, provider, serviceSocket, resolved };
}

async function ask(serviceSocket: string, method: string, params: Record<string, unknown>): Promise<Socket> {
  const socket = connect(serviceSocket);
  await new Promise<void>((ok, fail) => { socket.once("connect", ok); socket.once("error", fail); });
  socket.write(encodeFrame({ v: 1, id: "e1", method, params }));
  return socket;
}
async function placeholder(serviceSocket: string, provider = "anthropic") {
  const socket = await ask(serviceSocket, "egress.placeholder", { credentialRef: "engine-managed", provider, model: "current", run: RUN });
  const { frame } = await readLeadingFrame(socket, PLATFORM_FRAME_BYTES, 5000);
  socket.destroy();
  return frame;
}
/** One engine connection: `egress.open`, then plain HTTP on the same socket. */
async function post(serviceSocket: string, open: Record<string, unknown>, key: string): Promise<{ status: number; body: string } | "closed"> {
  const socket = await ask(serviceSocket, "egress.open", open);
  return new Promise(resolve => {
    const request = httpRequest({ createConnection: () => socket, method: "POST", path: "/messages",
      headers: { "x-api-key": key, "content-type": "application/json" } }, response => {
      let body = "";
      response.on("data", chunk => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
    });
    request.on("error", () => resolve("closed"));
    request.end('{"hello":true}');
  });
}
const until = async (condition: () => boolean, what: string): Promise<void> => {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise(r => setTimeout(r, 10));
  assert.ok(condition(), what);
};

test("MAC-710/711: an engine in the guest reaches the provider with the host's key; the guest only ever held a placeholder", async t => {
  const { host, pool, provider, serviceSocket, resolved } = await world(t);
  await host.fill();
  await until(() => pool.size === 2, "two spare connections wait in the guest");
  const answer = await placeholder(serviceSocket);
  assert.equal(answer.ok, true, JSON.stringify(answer));
  const result = answer.result as Record<string, string>;
  assert.notEqual(result.placeholder, SECRET);
  assert.equal(result.provider, "anthropic");
  assert.deepEqual(resolved, ["engine-managed:anthropic/current"], "the host resolved it, from its own state");
  await until(() => pool.size >= 6, "the pool grows by the relay's four for the run");

  const reply = await post(serviceSocket, { placeholderId: result.placeholderId, ...RUN, modelProfile: "default" }, result.placeholder!);
  assert.deepEqual(reply, { status: 200, body: "ab" });
  assert.equal(provider.seen.length, 1);
  assert.equal(provider.seen[0]!.headers["x-api-key"], SECRET, "the key was put in its slot on the host");
  assert.equal(provider.seen[0]!.path, "/v1/messages", "the origin is the host's");
});

test("MAC-712: a placeholder the host did not issue, or one used for another run, opens nothing", async t => {
  const { host, pool, provider, serviceSocket } = await world(t);
  await host.fill();
  await until(() => pool.size === 2, "the pool");
  const issued = (await placeholder(serviceSocket)).result as Record<string, string>;
  assert.equal(await post(serviceSocket, { placeholderId: randomUUID(), ...RUN, modelProfile: "default" }, issued.placeholder!), "closed");
  assert.equal(await post(serviceSocket, { placeholderId: issued.placeholderId, ...RUN, actor: "mallory", modelProfile: "default" }, issued.placeholder!), "closed");
  assert.equal(host.activeRuns, 1, "a v4 placeholder's run lives until its boot ends");
  await host.forgetBoot();
  assert.equal(host.activeRuns, 0);
  assert.equal(await post(serviceSocket, { placeholderId: issued.placeholderId, ...RUN, modelProfile: "default" }, issued.placeholder!), "closed",
    "a placeholder of the last boot opens nothing");
  assert.equal(provider.seen.length, 0);
});

test("MV-13: the guest names a model; one the host does not know is refused, in words the guest may pass on", async t => {
  const { host, pool, serviceSocket } = await world(t);
  await host.fill();
  await until(() => pool.size === 2, "the pool");
  const answer = await placeholder(serviceSocket, "elsewhere");
  assert.deepEqual(answer.error, { code: "UNSUPPORTED_PROFILE", message: "the engine does not know elsewhere/current", retry: "never" });
  assert.equal(host.activeRuns, 0);
});

test("MAC-225: with no connection waiting, an engine's connection is refused at once rather than held", async t => {
  const { pool, serviceSocket } = await world(t);
  assert.equal(pool.size, 0);
  const started = performance.now();
  assert.equal(await post(serviceSocket, { placeholderId: randomUUID(), ...RUN, modelProfile: "default" }, "sk-ant-api03-PLACEHOLDERxxxxxxxxxxxxxxxx"), "closed");
  assert.ok(performance.now() - started < 1000, "refused, not waited out");
});

test("DR18 / D-10: a run in the guest asks for its placeholder and forwards the engine's connections through egress; the key is put in on the host", async t => {
  const { EgressForwarder, requestEgressPlaceholder, openPrincipalEgress } = await import("../src/runtime/egress-forwarder.js");
  const { host, pool, provider, serviceSocket, resolved } = await world(t);
  await host.fill();
  await until(() => pool.size === 2, "the pool");
  const ask = { socket: serviceSocket, frameBytes: PLATFORM_FRAME_BYTES, deadlineMs: 5000 };
  const issued = await requestEgressPlaceholder(ask, RUN, "anthropic", "current", 5);
  assert.notEqual(issued.placeholder, SECRET);
  assert.deepEqual(resolved, ["engine-managed:anthropic/current"]);
  await until(() => pool.size >= 6, "the pool grows for the run");
  const dir = mkdtempSync(join(tmpdir(), "oma-forwarder-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const socketPath = join(dir, "inference.sock");
  const forwarder = await EgressForwarder.listen(socketPath, serviceSocket, { placeholderId: issued.placeholderId, ...RUN, modelProfile: "worker" }, 4, issued);
  // The engine speaks HTTP to the socket it was given, with the placeholder as its key.
  const engine = (key: string) => new Promise<{ status: number; body: string } | "closed">(resolve => {
    const request = httpRequest({ socketPath, method: "POST", path: "/messages", headers: { "x-api-key": key, "content-type": "application/json" } }, response => {
      let body = "";
      response.on("data", chunk => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
    });
    request.on("error", () => resolve("closed"));
    request.end('{"hello":true}');
  });
  assert.deepEqual(await engine(issued.placeholder), { status: 200, body: "ab" });
  assert.equal(provider.seen.length, 1);
  assert.equal(provider.seen[0]!.headers["x-api-key"], SECRET, "the key was not put in on the host");
  await forwarder.close();
  assert.equal(await engine(issued.placeholder), "closed", "a closed forwarder still forwarded");
  // A host that refuses the credential is refused to the run, by name.
  await assert.rejects(requestEgressPlaceholder(ask, RUN, "openai", "gpt", 5), (error: unknown) =>
    error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE" && /no placeholder/.test(error.message));
  // The Principal's path: nothing without the environment's egress socket, the bridge's environment with it.
  assert.equal(await openPrincipalEgress({ society: "demo", runRoot: dir, provider: "anthropic", model: "current", modelProfile: "default", inferenceSeconds: 5,
    frameBytes: PLATFORM_FRAME_BYTES, deadlineMs: 5000, env: {} }), null);
  const principal = await openPrincipalEgress({ society: "demo", runRoot: dir, provider: "anthropic", model: "current", modelProfile: "default", inferenceSeconds: 5,
    frameBytes: PLATFORM_FRAME_BYTES, deadlineMs: 5000, env: { OMA_EGRESS_SOCKET: serviceSocket } });
  assert.ok(principal !== null);
  assert.deepEqual(Object.keys(principal.env).sort(), ["OMA_INFERENCE_KEY", "OMA_INFERENCE_PORT", "OMA_INFERENCE_PROVIDER", "OMA_INFERENCE_SOCKET"]);
  assert.equal(principal.env.OMA_INFERENCE_PROVIDER, "anthropic");
  assert.notEqual(principal.env.OMA_INFERENCE_KEY, SECRET);
  await principal.close();
});

test("AV-15: a listen refused before its socket name is cleared releases the run's lease", async t => {
  // A name clearSocketName cannot remove (not a socket) refused the audited
  // listen before the lease became the forwarder's -- and the run leaked on
  // the host: still held, never told it was over.
  const { EgressForwarder } = await import("../src/runtime/egress-forwarder.js");
  const dir = mkdtempSync(join(tmpdir(), "oma-forwarder-refused-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const socketPath = join(dir, "inference.sock");
  writeFileSync(socketPath, "not a socket");
  let released = 0;
  const lease = { release() { released++; } };
  assert.throws(() => EgressForwarder.listen(socketPath, join(dir, "upstream.sock"),
    { placeholderId: "placeholder", ...RUN, modelProfile: "worker" }, 4, lease),
    (error: unknown) => error instanceof StoreError && error.code === "STORE_CORRUPT");
  assert.equal(released, 1, "a forwarder that never listened ends the run it was given");
});


test("DR27 / MAC-710: each run carries its model silence budget, not the host RPC budget", { timeout: 15_000 }, async t => {
  const { host, pool, provider, serviceSocket } = await world(t, 100);
  await host.fill();
  await until(() => pool.size === 2, "the pool");
  const socket = await ask(serviceSocket, "egress.placeholder", { credentialRef: "engine-managed", provider: "anthropic",
    model: "current", run: RUN, inferenceSeconds: 1 });
  const { frame } = await readLeadingFrame(socket, PLATFORM_FRAME_BYTES, 5000);
  socket.destroy();
  assert.equal(frame.ok, true);
  const issued = frame.result as Record<string, string>;
  provider.reply = { status: 200, chunks: ["reasoned"], delayMs: 300 };
  const open = { placeholderId: issued.placeholderId, ...RUN, modelProfile: "default" };
  assert.deepEqual(await post(serviceSocket, open, issued.placeholder!), { status: 200, body: "reasoned" });
  provider.reply = { status: 200, chunks: ["too late"], delayMs: 2000 };
  const result = await post(serviceSocket, open, issued.placeholder!);
  assert.notEqual(result, "closed");
  assert.equal((result as { status: number }).status, 504);
  assert.equal(provider.seen.length, 2, "no hidden replay after a silence timeout");
});

test("AV-14: a credential that resolves after the boot it was asked under ended creates nothing", async t => {
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  let resolving = false;
  const { host, pool, serviceSocket } = await world(t, 5000, async (_credentialRef, provider_, model) => {
    resolving = true;
    await gate;
    return { provider: provider_, model, origin: "https://provider.invalid", apiKey: SECRET, headers: {} };
  });
  await host.fill();
  await until(() => pool.size === 2, "the pool");
  const socket = await ask(serviceSocket, "egress.placeholder", { hold: true, credentialRef: "engine-managed", provider: "anthropic", model: "current", run: RUN });
  const ended = new Promise(r => socket.once("close", r));
  await until(() => resolving, "the request reached the resolver");
  await host.forgetBoot();
  release();
  await ended;
  assert.equal(host.activeRuns, 0, "the late answer made no run, no relay, and kept no credential");

  // The same holds when the host itself stopped while resolving.
  let release2!: () => void;
  const gate2 = new Promise<void>(r => { release2 = r; });
  let resolving2 = false;
  const stopped = await world(t, 5000, async (_credentialRef, provider_, model) => {
    resolving2 = true;
    await gate2;
    return { provider: provider_, model, origin: "https://provider.invalid", apiKey: SECRET, headers: {} };
  });
  await stopped.host.fill();
  await until(() => stopped.pool.size === 2, "the pool");
  const socket2 = await ask(stopped.serviceSocket, "egress.placeholder", { credentialRef: "engine-managed", provider: "anthropic", model: "current", run: RUN });
  const ended2 = new Promise(r => socket2.once("close", r));
  await until(() => resolving2, "the request reached the resolver");
  await stopped.host.stop();
  release2();
  await ended2;
  assert.equal(stopped.host.activeRuns, 0);
});

test("AV-15/§4.7 v5: the answered connection a run holds open is its lease; its end ends the run on the host", async t => {
  const { host, pool, provider, serviceSocket } = await world(t);
  await host.fill();
  await until(() => pool.size === 2, "the pool");
  const socket = await ask(serviceSocket, "egress.placeholder", { hold: true, credentialRef: "engine-managed", provider: "anthropic", model: "current", run: RUN });
  const { frame } = await readLeadingFrame(socket, PLATFORM_FRAME_BYTES, 5000);
  assert.equal(frame.ok, true, JSON.stringify(frame));
  const issued = frame.result as Record<string, string>;
  assert.notEqual(issued.placeholder, SECRET);
  assert.equal(host.activeRuns, 1);
  // While the lease lives the placeholder opens a connection.
  assert.deepEqual(await post(serviceSocket, { placeholderId: issued.placeholderId, ...RUN, modelProfile: "default" }, issued.placeholder!),
    { status: 200, body: "ab" });
  assert.equal(provider.seen[0]!.headers["x-api-key"], SECRET);
  // The run's own end -- whatever closed the forwarder -- releases the host's run.
  socket.destroy();
  await until(() => host.activeRuns === 0, "the lease's end released the run and its credential");
  assert.equal(await post(serviceSocket, { placeholderId: issued.placeholderId, ...RUN, modelProfile: "default" }, issued.placeholder!), "closed",
    "the ended run's placeholder opens nothing");
});

/** Whether anything still accepts on a forwarder's socket. */
const accepts = (socketPath: string) => new Promise<boolean>(resolve => {
  const probe = connect(socketPath);
  probe.once("connect", () => { probe.destroy(); resolve(true); });
  probe.once("error", () => resolve(false));
});
const untilClosed = async (socketPath: string, what: string): Promise<void> => {
  for (let i = 0; i < 200 && await accepts(socketPath); i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(await accepts(socketPath), false, what);
};

test("DR18: the session's provider path fails closed where the environment requires it", async t => {
  // oma-society's open used to degrade every egress failure to a one-line
  // notice and start the session anyway. Where the environment names the
  // egress socket that is a lie: the guest holds no credential and no route,
  // so the engine the session just started can never reach a provider. The
  // failure is the session's own there; only an optional path may degrade,
  // and then it is still said.
  const { egressRequired, adoptPrincipalEgress } = await import("../src/runtime/egress-forwarder.js");
  assert.equal(egressRequired({}), false);
  assert.equal(egressRequired({ OMA_EGRESS_SOCKET: "" }), false);
  assert.equal(egressRequired({ OMA_EGRESS_SOCKET: "/e.sock" }), true);
  // Through the real open: a required environment whose service is gone is a
  // start failure -- it propagates, never degrades; the same dead socket
  // unnamed is simply no path at all.
  const dir = mkdtempSync(join(tmpdir(), "oma-egress-dead-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dead = join(dir, "gone.sock");
  const ask = { society: "demo", runRoot: dir, provider: "anthropic", model: "current", modelProfile: "default",
    inferenceSeconds: 5, frameBytes: PLATFORM_FRAME_BYTES, deadlineMs: 500 };
  const held: unknown[] = [];
  const owner = { hold: async (holding: unknown) => { held.push(holding); return true; } };
  await assert.rejects(adoptPrincipalEgress(owner, { ...ask, env: { OMA_EGRESS_SOCKET: dead } }),
    (error: unknown) => error instanceof StoreError && error.code === "BROKER_UNAVAILABLE");
  assert.equal(held.length, 0, "a failed open adopts nothing");
  assert.equal(await adoptPrincipalEgress(owner, { ...ask, env: {} }), null,
    "no socket named: no path, nothing said");
});

test("AV-15/§4.7 v5: a run the host ends ends the guest's forwarder; the lease is how it learns", async t => {
  // The lease detects both ends of the run: the run's own close reaches the
  // host (the previous test), and the host's end of the run -- a reboot or a
  // stop the same way -- reaches the guest here. Without it the forwarder
  // kept accepting engine connections for a run the host no longer had.
  const { EgressForwarder, requestEgressPlaceholder } = await import("../src/runtime/egress-forwarder.js");
  const { host, pool, provider, serviceSocket } = await world(t);
  await host.fill();
  await until(() => pool.size === 2, "the pool");
  const ask = { socket: serviceSocket, frameBytes: PLATFORM_FRAME_BYTES, deadlineMs: 5000 };
  const issued = await requestEgressPlaceholder(ask, RUN, "anthropic", "current", 5);
  const dir = mkdtempSync(join(tmpdir(), "oma-forwarder-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const socketPath = join(dir, "inference.sock");
  const forwarder = await EgressForwarder.listen(socketPath, serviceSocket,
    { placeholderId: issued.placeholderId, ...RUN, modelProfile: "worker" }, 4, issued);
  const engine = (key: string) => new Promise<{ status: number; body: string } | "closed">(resolve => {
    const request = httpRequest({ socketPath, method: "POST", path: "/messages", headers: { "x-api-key": key, "content-type": "application/json" } }, response => {
      let body = "";
      response.on("data", chunk => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
    });
    request.on("error", () => resolve("closed"));
    request.end('{"hello":true}');
  });
  assert.deepEqual(await engine(issued.placeholder), { status: 200, body: "ab" });
  // The host ends the run itself: its relay closes, its placeholder dies, and
  // the lease it held is how the guest is told -- the forwarder ends with it.
  await host.release(issued.placeholderId);
  assert.equal(host.activeRuns, 0);
  await untilClosed(socketPath, "the forwarder kept accepting for a run the host had ended");
  await forwarder.close();
  assert.equal(await engine(issued.placeholder), "closed");

  // A lease that already ended still ends the forwarder it was just given to:
  // the end is not missed by being early.
  const issued2 = await requestEgressPlaceholder(ask, RUN, "anthropic", "current", 5);
  issued2.release();
  const socketPath2 = join(dir, "inference2.sock");
  const forwarder2 = await EgressForwarder.listen(socketPath2, serviceSocket,
    { placeholderId: issued2.placeholderId, ...RUN, modelProfile: "worker" }, 4, issued2);
  await untilClosed(socketPath2, "a forwarder on a dead lease accepts nothing");
  await forwarder2.close();
  await until(() => host.activeRuns === 0, "the ended lease's run is over on the host too");
});

/* ---- DR34 / UX-08: egress.connect -- the run's CONNECT tunnels through the
 * same pool, declared policy and all. The host re-checks run identity,
 * enforces the declared allowlist, owns resolution and the address screen. */

const CONNECT_POLICY = Object.freeze({ role: "worker", allow: Object.freeze(["registry.npmjs.org", "*.github.com"]) });

/** A plain TCP echo on loopback stands in for the outside TLS endpoint; the
 * injected `dial` is the oracle, so no DNS runs in these tests. */
async function echoServer(t: import("node:test").TestContext): Promise<number> {
  const server = (await import("node:net")).createServer(socket => socket.pipe(socket));
  await once(server.listen(0, "127.0.0.1"), "listening");
  t.after(() => { server.close(); });
  return (server.address() as { port: number }).port;
}

test("DR34: egress.connect tunnels a declared allowlisted target through the pool; the rest are refused", async t => {
  const { requestEgressConnect, requestEgressPlaceholder } = await import("../src/runtime/egress-forwarder.js");
  const port = await echoServer(t);
  const audits: import("../src/runtime/connect-proxy.js").EgressAudit[] = [];
  const { host, pool, serviceSocket } = await world(t, 5000, undefined,
    { dial: async () => connect({ host: "127.0.0.1", port }), audit: entry => audits.push(entry) });
  await host.fill();
  await until(() => pool.size === 2, "the pool");
  const ask = { socket: serviceSocket, frameBytes: PLATFORM_FRAME_BYTES, deadlineMs: 5000 };
  const issued = await requestEgressPlaceholder(ask, RUN, "anthropic", "current", 5);

  // The allowlisted CONNECT goes through: one frame out, ok back, raw bytes.
  const tunnel = await requestEgressConnect(ask, issued, RUN, "registry.npmjs.org", 443, CONNECT_POLICY);
  tunnel.write("through-the-host");
  const [echoed] = await once(tunnel, "data");
  assert.equal(String(echoed), "through-the-host");
  tunnel.destroy();
  assert.ok(audits.some(e => e.decision === "allow" && e.target === "registry.npmjs.org:443" && e.actor === "alice" && e.role === "worker"));

  // Everything off the declared list, off the one port, or for a run that is
  // not this boot's is refused -- and never dials.
  for (const [host_, port_, code] of [
    ["pypi.org", 443, "INVALID_REQUEST"],            // not on the allowlist
    ["registry.npmjs.org", 22, "INVALID_REQUEST"],   // not HTTPS's port
    ["registry.npmjs.org", 443, "STALE_RUN"],        // a run the placeholder does not stand for
  ] as const) {
    await assert.rejects(
      requestEgressConnect(ask, issued, host_ === "registry.npmjs.org" && code === "STALE_RUN" ? { ...RUN, actor: "mallory" } : RUN,
        host_, port_, CONNECT_POLICY),
      (error: unknown) => error instanceof StoreError && error.code === code, `${host_}:${port_} -> ${code}`);
  }

  // A malformed declaration (an entry that is no egress entry) never leaves
  // the service's own validation.
  const malformed = connect(serviceSocket);
  await once(malformed, "connect");
  malformed.write(encodeFrame({ v: 1, id: "e1", method: "egress.connect",
    params: { placeholderId: issued.placeholderId, run: RUN, host: "registry.npmjs.org", port: 443, role: "worker", allow: ["10.0.0.1"] } }));
  await once(malformed, "close");

  // The run's end ends its tunnels: release the lease, the next connect is a
  // stale run, and a reboot forgets every run of the last boot.
  issued.release();
  await until(() => host.activeRuns === 0, "the released run is over on the host");
  await assert.rejects(requestEgressConnect(ask, issued, RUN, "registry.npmjs.org", 443, CONNECT_POLICY),
    (error: unknown) => error instanceof StoreError && (error as StoreError).code === "STALE_RUN");
});

test("DR34: the run's tunnel bound counts tunnels -- four stand, the fifth is refused, a close frees its slot", async t => {
  const { requestEgressConnect, requestEgressPlaceholder } = await import("../src/runtime/egress-forwarder.js");
  const port = await echoServer(t);
  const { host, pool, serviceSocket } = await world(t, 5000, undefined,
    { dial: async () => connect({ host: "127.0.0.1", port }) });
  await host.fill();
  const ask = { socket: serviceSocket, frameBytes: PLATFORM_FRAME_BYTES, deadlineMs: 5000 };
  const issued = await requestEgressPlaceholder(ask, RUN, "anthropic", "current", 5);
  await until(() => pool.size >= 6, "the pool grew for the run");

  // limits.concurrent is 4: four tunnels stand at once. Each tunnel is ONE
  // unit (its pooled connection); counting socket halves would halve the
  // declared bound and refuse the third.
  const held: Socket[] = [];
  for (let i = 0; i < 4; i++) held.push(await requestEgressConnect(ask, issued, RUN, "registry.npmjs.org", 443, CONNECT_POLICY));
  assert.equal(held.length, 4, "four tunnels at the declared concurrent bound");
  held[0]!.write("live");
  await once(held[0]!, "data");
  await assert.rejects(requestEgressConnect(ask, issued, RUN, "registry.npmjs.org", 443, CONNECT_POLICY),
    (error: unknown) => error instanceof StoreError && (error as StoreError).code === "BROKER_UNAVAILABLE",
    "the fifth tunnel is refused at the bound");

  // A closed tunnel returns its slot: destroy one, then the same connect
  // succeeds once the host has observed the close.
  held[0]!.destroy();
  let reopened: Socket | undefined;
  for (let i = 0; i < 100 && reopened === undefined; i++) {
    try { reopened = await requestEgressConnect(ask, issued, RUN, "registry.npmjs.org", 443, CONNECT_POLICY); }
    catch (error) { assert.ok(error instanceof StoreError && (error as StoreError).code === "BROKER_UNAVAILABLE"); await new Promise(r => setTimeout(r, 10)); }
  }
  assert.ok(reopened, "a closed tunnel frees its slot");

  // The bound check and the slot reservation are one synchronous step: a
  // burst cannot pass the check together and only then dial. On a fresh run
  // (the first run's closed sockets take no deterministic time to release),
  // one more than the bound at once yields exactly the bound standing.
  for (const socket of held) socket.destroy();
  issued.release();
  await until(() => host.activeRuns === 0, "the first run is over on the host");
  const issued2 = await requestEgressPlaceholder(ask, RUN, "anthropic", "current", 5);
  await until(() => pool.size >= 6, "the pool refilled for the burst");
  const burst = await Promise.allSettled(Array.from({ length: 5 },
    () => requestEgressConnect(ask, issued2, RUN, "registry.npmjs.org", 443, CONNECT_POLICY)));
  const admitted = burst.filter((r): r is PromiseFulfilledResult<Socket> => r.status === "fulfilled");
  const refused = burst.filter(r => r.status === "rejected" && r.reason instanceof StoreError && r.reason.code === "BROKER_UNAVAILABLE");
  assert.equal(admitted.length, 4, "four free slots admit four tunnels");
  assert.equal(refused.length, 1, "the fifth is refused -- no overshoot past the bound");
  for (const socket of admitted.map(r => r.value)) socket.destroy();
  issued2.release();
});

test("DR34: every connect decision audits once -- the refused, the failed, and the run that ended mid-dial", async t => {
  const { requestEgressConnect, requestEgressPlaceholder } = await import("../src/runtime/egress-forwarder.js");
  const port = await echoServer(t);
  const audits: import("../src/runtime/connect-proxy.js").EgressAudit[] = [];
  let openGate!: () => void;
  const gate = new Promise<void>(r => { openGate = r; });
  let dialledSlow = false;
  const { host, pool, serviceSocket } = await world(t, 5000, undefined, {
    audit: entry => audits.push(entry),
    dial: async (host_, port_) => {
      if (host_ === "private.github.com") throw new StoreError("INVALID_REQUEST", "resolves only to private space");
      if (host_ === "wedge.github.com") throw new StoreError("BROKER_UNAVAILABLE", "connection refused");
      if (host_ === "slow.github.com") { dialledSlow = true; await gate; return connect({ host: "127.0.0.1", port }); }
      return connect({ host: "127.0.0.1", port });
    },
  });
  await host.fill();
  const ask = { socket: serviceSocket, frameBytes: PLATFORM_FRAME_BYTES, deadlineMs: 5000 };
  const issued = await requestEgressPlaceholder(ask, RUN, "anthropic", "current", 5);
  await until(() => pool.size >= 6, "the pool grew for the run");

  // An INVALID_REQUEST dial is a policy refusal, not an operational failure --
  // the same word the guest-side proxy uses for it.
  await assert.rejects(requestEgressConnect(ask, issued, RUN, "private.github.com", 443, CONNECT_POLICY),
    (error: unknown) => error instanceof StoreError && error.code === "INVALID_REQUEST");
  await assert.rejects(requestEgressConnect(ask, issued, RUN, "wedge.github.com", 443, CONNECT_POLICY),
    (error: unknown) => error instanceof StoreError && error.code === "BROKER_UNAVAILABLE");
  assert.equal(audits.find(e => e.target === "private.github.com:443")!.decision, "refuse");
  assert.equal(audits.find(e => e.target === "wedge.github.com:443")!.decision, "fail");

  // The run ending under the dial drops the dialed socket -- and still writes
  // its one audit line; a decision path cannot pass silently.
  const pending = requestEgressConnect(ask, issued, RUN, "slow.github.com", 443, CONNECT_POLICY);
  const rejection = assert.rejects(pending, (error: unknown) => error instanceof StoreError && error.code === "BROKER_UNAVAILABLE");
  await until(() => dialledSlow, "the dial is in flight");
  issued.release();
  await until(() => host.activeRuns === 0, "the run is over on the host");
  openGate();
  await rejection;
  await until(() => audits.some(e => e.target === "slow.github.com:443"), "the dropped tunnel was audited");
  const dropped = audits.find(e => e.target === "slow.github.com:443")!;
  assert.equal(dropped.decision, "fail");
  assert.match(dropped.reason, /run ended|no longer exists|ended during/i, dropped.reason);
});

test("DR34: an audit sink that throws cannot crash the host or orphan the dialed upstream", async t => {
  const { requestEgressConnect, requestEgressPlaceholder } = await import("../src/runtime/egress-forwarder.js");
  const port = await echoServer(t);
  const dialedSockets: Socket[] = [];
  const { host, pool, serviceSocket } = await world(t, 5000, undefined, {
    audit: () => { throw new Error("journal unavailable"); },
    dial: async () => { const s = connect({ host: "127.0.0.1", port }); dialedSockets.push(s); return s; },
  });
  await host.fill();
  const ask = { socket: serviceSocket, frameBytes: PLATFORM_FRAME_BYTES, deadlineMs: 5000 };
  const issued = await requestEgressPlaceholder(ask, RUN, "anthropic", "current", 5);
  await until(() => pool.size >= 6, "the pool grew for the run");

  // The throw lands after the dial succeeded: the connect request dies with
  // its upstream rather than becoming an unhandled rejection on the host.
  await assert.rejects(requestEgressConnect(ask, issued, RUN, "registry.npmjs.org", 443, CONNECT_POLICY),
    (error: unknown) => error instanceof StoreError);
  assert.equal(dialedSockets.length, 1);
  await until(() => dialedSockets[0]!.destroyed, "the upstream of the half-built tunnel was destroyed");
  // The host keeps serving: the run still stands and the next request is
  // processed (refused at the allowlist -- and its audit throw handled too).
  assert.equal(host.activeRuns, 1);
  await assert.rejects(requestEgressConnect(ask, issued, RUN, "pypi.org", 443, CONNECT_POLICY),
    (error: unknown) => error instanceof StoreError);
  await until(() => pool.size >= 2, "the pool refilled after the failed requests");
  issued.release();
});

test("DR34: bytes riding with the host's answer frame are tunnel bytes, and post-answer bytes still end the lease", async t => {
  const { requestEgressConnect, requestEgressPlaceholder } = await import("../src/runtime/egress-forwarder.js");
  const dir = mkdtempSync(join(tmpdir(), "oma-egress-race-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const serviceSocket = join(dir, "e.sock");
  // A stub egress service: reads the client's first frame, answers with the
  // ok frame and the tunnel's first bytes in one segment.
  const service = (await import("node:net")).createServer(client => {
    client.once("data", () => {
      client.write(Buffer.concat([encodeFrame({ v: 1, id: "e1", ok: true, result: {} }), Buffer.from("raced-bytes")]));
    });
  });
  await once(service.listen(serviceSocket), "listening");
  t.after(() => { service.close(); });
  const ask = { socket: serviceSocket, frameBytes: PLATFORM_FRAME_BYTES, deadlineMs: 5000 };
  const tunnel = await requestEgressConnect(ask, { placeholderId: randomUUID() }, RUN, "registry.npmjs.org", 443, CONNECT_POLICY);
  const [first] = await once(tunnel, "data");
  assert.equal(String(first), "raced-bytes",
    "bytes that rode with the answer frame reach the tunnel unchanged -- not swallowed inside the frame parser");
  tunnel.destroy();

  // The placeholder lease: bytes after the answer -- even in the same
  // segment -- are the host speaking on the lease, and that ends the run.
  const placeholderSocket = join(dir, "p.sock");
  const placeholderService = (await import("node:net")).createServer(client => {
    client.once("data", () => {
      client.write(Buffer.concat([
        encodeFrame({ v: 1, id: "e1", ok: true, result: { placeholderId: randomUUID(), placeholder: "p".repeat(20), provider: "anthropic", model: "m" } }),
        Buffer.from("the host kept talking"),
      ]));
    });
  });
  await once(placeholderService.listen(placeholderSocket), "listening");
  t.after(() => { placeholderService.close(); });
  const lease = await requestEgressPlaceholder({ ...ask, socket: placeholderSocket }, RUN, "anthropic", "current", 5);
  const ended = new Promise<void>(r => lease.ended(r));
  await Promise.race([ended, new Promise<void>((_, fail) => setTimeout(() => fail(new Error("the lease outlived bytes after its answer")), 3000))]);
});
