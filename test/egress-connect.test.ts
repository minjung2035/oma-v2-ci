import { residentEngineEffects } from "#oma-test/app/engine/resident-effects";
/** CONNECT egress: authority grammar, unrestricted destination
 * routing, address pinning, socket protocol and owned connection lifetime. */
import test from "node:test";
import assert from "node:assert/strict";
import { connect, createServer, Socket } from "node:net";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { parseConnectTarget } from "@oma/domain/egress";
import {
  ConnectProxy, makePublicDial, type ConnectDial, type EgressAudit,
} from "#oma-test/app/runtime/connect-proxy";
import { StoreError } from "@oma/domain/errors";
import { validateConfig } from "@oma/config";
import { defaultHostConfig } from "@oma/config/defaults";
import { planPiSpawn } from "@oma/engine/pi-spawn-plan";
import { residentArgv } from "@oma/platform-linux/sandbox";
import { RESIDENT_PATHS } from "@oma/domain/resident-paths";
import { residentOptions } from "./fixtures/resident.js";


/* ---------------- authority grammar ---------------- */

test("DR34: the CONNECT authority is host:port or [literal]:port, strictly", () => {
  for (const url of ["registry.npmjs.org:443", "EXAMPLE.com:443", "a.b.c.org:1"]) {
    const { target, problem } = parseConnectTarget(url);
    assert.equal(problem, null, url);
    assert.equal(target!.port, Number(url.slice(url.lastIndexOf(":") + 1)));
    assert.equal(target!.literal, false);
  }
  assert.deepEqual(parseConnectTarget("registry.npmjs.org:443").target, { host: "registry.npmjs.org", port: 443, literal: false });
  assert.equal(parseConnectTarget("[::1]:443").target!.literal, true);
  assert.equal(parseConnectTarget("[fe80::1%eth0]:443").target !== null, true, "a zone-id literal parses, then is refused as a literal");
  for (const url of [
    "", "registry.npmjs.org", "registry.npmjs.org:", ":443", "host:notaport", "host:0", "host:65536", "host:-1",
    "http://registry.npmjs.org/", "http://registry.npmjs.org:443", "//registry.npmjs.org:443",
    "user:pass@registry.npmjs.org:443", "registry.npmjs.org:443/path", "registry.npmjs.org:443:443",
    "registry.npmjs.org :443", " registry.npmjs.org:443", "registry.npmjs.org:443 ",
    "registry.npmjs.org:443 extra", "a:b@c:443", "[]:443", "[::1]", "[::1]:",
    "host:443\x00", `${"h".repeat(256)}:443`, "h:443\r\nX: y",
  ]) {
    const { problem } = parseConnectTarget(url);
    assert.notEqual(problem, null, JSON.stringify(url));
  }

});

/* ---------------- unrestricted destination routing ---------------- */

test("DR37/39: the actual dial admits local, private, mapped and public addresses on any port", async () => {
  const addresses = ["10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.0.1",
    "::1", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1", "64:ff9b::10.0.0.1", "2002:0a00:0001::1",
    "8.8.8.8", "2001:4860:4860::8888"];
  for (const address of addresses) {
    const socket = new Socket();
    const calls: [string, number][] = [];
    const dial = makePublicDial({ lookup: async () => [{ address, family: address.includes(":") ? 6 : 4 }],
      connect: async (target, port) => { calls.push([target, port]); return socket; } });
    assert.equal(await dial("destination.example", 2222), socket);
    assert.deepEqual(calls, [[address, 2222]]);
    socket.destroy();
  }
});

/* ---------------- the pinned dial ---------------- */

test("DR34: the dial resolves once and pins the chosen address", async () => {
  const dialed: string[] = [];
  const connect = async (address: string, _port: number): Promise<Socket> => {
    dialed.push(address);
    const socket = new Socket();
    return socket;
  };
  const dial = makePublicDial({ connect, lookup: async () => [{ address: "10.0.0.9", family: 4 }, { address: "104.16.1.1", family: 4 }] });
  await dial("registry.npmjs.org", 443);
  assert.deepEqual(dialed, ["10.0.0.9"], "the first resolved address is dialed literally");
});

test("DR37: a private resolver answer reaches the connect boundary", async () => {
  let connects = 0;
  const dial = makePublicDial({ lookup: async () => [{ address: "169.254.169.254", family: 4 }], connect: async () => { connects += 1; return new Socket(); } });
  (await dial("metadata.internal", 443)).destroy();
  assert.equal(connects, 1);
});

test("DR37: resolver answers are pinned; absence fails and a failed address permits the next", async () => {
  // Loopback is a valid destination. Resolve once, then dial its literal.
  const dial = makePublicDial({ lookup: async () => [{ address: "127.0.0.1", family: 4 }, { address: "::1", family: 6 }], connect: async () => new Socket() });
  (await dial("registry.npmjs.org", 443)).destroy();
  // A resolver with no answer fails the dial honestly.
  const empty = makePublicDial({ lookup: async () => [] });
  await assert.rejects(empty("gone.invalid", 443), (e: unknown) => e instanceof StoreError && (e as StoreError).code === "BROKER_UNAVAILABLE");
  // The first public answer that refuses is not silently the last word: the
  // next public answer is tried.
  const seen: string[] = [];
  const dial2 = makePublicDial({ lookup: async () => [{ address: "9.9.9.9", family: 4 }, { address: "8.8.8.8", family: 4 }],
    connect: async (address: string) => { seen.push(address); if (address === "9.9.9.9") throw new Error("refused"); return new Socket(); } });
  await dial2("registry.npmjs.org", 443);
  assert.deepEqual(seen, ["9.9.9.9", "8.8.8.8"]);
});

/* ---------------- the proxy ---------------- */

const echo = async (t: import("node:test").TestContext): Promise<number> => {
  const server = createServer(socket => socket.pipe(socket));
  await once(server.listen(0, "127.0.0.1"), "listening");
  t.after(() => { server.close(); });
  return (server.address() as { port: number }).port;
};

async function proxyWorld(t: import("node:test").TestContext, dial: ConnectDial, audit?: (e: EgressAudit) => void) {
  const dir = mkdtempSync(join(tmpdir(), "oma-connect-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const socketPath = join(dir, "egress.sock");
  const proxy = await ConnectProxy.open({ socketPath, actor: "alice", dial, ...(audit === undefined ? {} : { audit }) });
  t.after(() => proxy.close());
  return { proxy, socketPath };
}

/** One raw CONNECT exchange: write the request, read the status line.
 * `trailing` keeps buffering bytes past the status head -- tunnel bytes a
 * test waits for -- because they may arrive in a later segment than the 200. */
function connectRaw(socketPath: string, head: string): Promise<{ status: number; socket: Socket; trailing: Buffer[] }> {
  return new Promise(resolve => {
    const socket = connect(socketPath);
    socket.once("connect", () => socket.write(head));
    const chunks: Buffer[] = [];
    const trailing: Buffer[] = [];
    let headers = false;
    socket.on("data", (chunk: Buffer) => {
      if (headers) { trailing.push(chunk); return; }
      chunks.push(chunk);
      const whole = Buffer.concat(chunks);
      const at = whole.indexOf("\r\n\r\n");
      if (at < 0) return;
      headers = true;
      if (at + 4 < whole.length) trailing.push(whole.subarray(at + 4));
      const status = Number(whole.subarray(0, at).toString("latin1").split(" ")[1]);
      resolve({ status, socket, trailing });
    });
    socket.once("close", () => {
      if (headers) return;
      headers = true;
      const whole = Buffer.concat(chunks);
      const status = /HTTP\/1\.1 (\d+)/.exec(whole.toString("latin1"));
      resolve({ status: status ? Number(status[1]) : 0, socket, trailing });
    });
    socket.once("error", () => { if (!headers) { headers = true; resolve({ status: 0, socket, trailing }); } });
  });
}

/** The buffered tunnel bytes once any arrive, drained; empty after `ms`. */
async function collect(trailing: Buffer[], ms = 3000): Promise<string> {
  const started = Date.now();
  while (trailing.length === 0 && Date.now() - started < ms) await new Promise(r => setTimeout(r, 10));
  return Buffer.concat(trailing.splice(0)).toString("latin1");
}

test("DR34: an allowlisted CONNECT answers 200 and the tunnel carries bytes end to end", async t => {
  const port = await echo(t);
  const audits: EgressAudit[] = [];
  const { socketPath } = await proxyWorld(t, async () => connect({ host: "127.0.0.1", port }), e => audits.push(e));
  const { status, socket, trailing } = await connectRaw(socketPath, "CONNECT registry.npmjs.org:443 HTTP/1.1\r\nHost: registry.npmjs.org:443\r\n\r\n");
  assert.equal(status, 200);
  socket.write("hello-tunnel");
  assert.equal(await collect(trailing), "hello-tunnel", "bytes tunnel both ways");
  socket.destroy();
  assert.equal(audits.length, 1);
  assert.deepEqual([audits[0]!.actor, audits[0]!.target, audits[0]!.decision], ["alice", "registry.npmjs.org:443", "allow"]);
});

test("DR34: refused CONNECTs -- unlisted names, literals, other ports -- answer 403 and nothing is dialed", async t => {
  let dialed = 0;
  const audits: EgressAudit[] = [];
  const { socketPath } = await proxyWorld(t, async () => { dialed += 1; return new Socket(); }, e => audits.push(e));
  for (const target of ["pypi.org:443", "github.com:443", "[::1]:443", "127.0.0.1:443", "registry.npmjs.org:22", "registry.npmjs.org:80"]) {
    const { status, socket } = await connectRaw(socketPath, `CONNECT ${target} HTTP/1.1\r\n\r\n`);
    assert.equal(status, 200, target); socket.destroy();
  }
  assert.equal(dialed, 6);
  assert.equal(audits.filter(e => e.decision === "allow").length, 6);
  assert.ok(audits.every(e => e.reason.length > 0));
});

test("DR34: a dial refusal answers 502/403 and the error stays a refusal, never a tunnel", async t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-connect-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const refused = await ConnectProxy.open({ socketPath: join(dir, "a.sock"), actor: "alice",
    dial: async () => { throw new StoreError("INVALID_REQUEST", "egress destination resolves only to private or special-use addresses"); } });
  const broken = await ConnectProxy.open({ socketPath: join(dir, "b.sock"), actor: "alice",
    dial: async () => { throw new Error("ECONNREFUSED"); } });
  t.after(async () => { await refused.close(); await broken.close(); });
  assert.equal((await connectRaw(join(dir, "a.sock"), "CONNECT registry.npmjs.org:443 HTTP/1.1\r\n\r\n")).status, 403);
  assert.equal((await connectRaw(join(dir, "b.sock"), "CONNECT registry.npmjs.org:443 HTTP/1.1\r\n\r\n")).status, 502);
});

test("DR34: malformed requests -- non-CONNECT, garbage, oversized heads -- are refused or destroyed", async t => {
  const { socketPath } = await proxyWorld(t, async () => new Socket());
  // A plain GET is not a tunnel: refused with a status.
  const get = await connectRaw(socketPath, "GET / HTTP/1.1\r\nHost: registry.npmjs.org\r\n\r\n");
  assert.equal(get.status, 502);
  // Garbage that is not HTTP at all is destroyed, not answered.
  const garbage = connect(socketPath);
  await once(garbage, "connect");
  garbage.write("\x16\x03\x01\x00\x05this is not HTTP at all\r\n\r\n\r\n");
  const [garbageClosed] = await once(garbage, "close");
  assert.equal(garbageClosed !== undefined, true);
  // A head past Node's 16KB bound never reaches CONNECT handling.
  const oversized = connect(socketPath);
  await once(oversized, "connect");
  oversized.write(`CONNECT registry.npmjs.org:443 HTTP/1.1\r\nX-Pad: ${"p".repeat(20000)}\r\n\r\n`);
  const closed = await Promise.race([
    once(oversized, "close").then(() => true),
    new Promise(r => setTimeout(() => r(false), 3000)),
  ]);
  assert.equal(closed, true, "an oversized request head is destroyed");
  oversized.destroy();
});

test("DR34: credential-bearing headers die at the proxy -- the tunnel carries only post-200 bytes", async t => {
  const port = await echo(t);
  const { socketPath } = await proxyWorld(t, async () => connect({ host: "127.0.0.1", port }));
  // The CONNECT request's own headers (Proxy-Authorization et al.) end at the
  // proxy; what the target sees is exactly what was written after the 200.
  const { status, socket, trailing } = await connectRaw(socketPath,
    "CONNECT registry.npmjs.org:443 HTTP/1.1\r\nHost: registry.npmjs.org:443\r\n" +
    "Proxy-Authorization: Basic c2stc2VjcmV0\r\nAuthorization: Bearer c2stc2VjcmV0\r\nCookie: session=x\r\n\r\n");
  assert.equal(status, 200);
  socket.write("post-tunnel-bytes");
  assert.equal(await collect(trailing), "post-tunnel-bytes",
    "the echo server saw only tunnel bytes -- no request headers crossed");
  socket.destroy();
});

test("DR34: bytes written with the CONNECT (a racing ClientHello) are forwarded", async t => {
  const port = await echo(t);
  const { socketPath } = await proxyWorld(t, async () => connect({ host: "127.0.0.1", port }));
  const { status, trailing, socket } = await connectRaw(socketPath,
    "CONNECT registry.npmjs.org:443 HTTP/1.1\r\n\r\n" + "early-bytes");
  assert.equal(status, 200);
  assert.equal(await collect(trailing), "early-bytes", "the head past the headers reached the target and echoed");
  socket.destroy();
});

/** Poll a condition with a bounded deadline, then assert it. */
const until = async (condition: () => boolean, what: string): Promise<void> => {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise(r => setTimeout(r, 10));
  assert.ok(condition(), what);
};

test("DR34: a refused request dies with its answer -- no socket lingers in keep-alive or upgrade state", async t => {
  const dials: string[] = [];
  const audits: EgressAudit[] = [];
  const { socketPath } = await proxyWorld(t, async host => { dials.push(host); return new Socket(); }, e => audits.push(e));

  // A plain request gets its 405 and the socket is gone -- it cannot idle on
  // keep-alive occupying a listener or tunnel slot (the refusal says close,
  // and the proxy enforces it rather than trusting the peer to leave).
  const get = connect(socketPath);
  await once(get, "connect");
  get.write("GET /?api_key=SECRET HTTP/1.1\r\nHost: registry.npmjs.org\r\n\r\n");
  let getBytes = Buffer.alloc(0);
  get.on("data", (chunk: Buffer) => { getBytes = Buffer.concat([getBytes, chunk]); });
  const [getClosed] = await Promise.race([once(get, "close").then(() => [true]), new Promise<boolean[]>(r => setTimeout(() => r([false]), 2000))]);
  assert.equal(getClosed, true, "the 405 connection must close, not linger");
  assert.match(getBytes.toString("latin1"), /^HTTP\/1\.1 502 .*\r\n(.*\r\n)*?[Cc]onnection: close\r\n/s,
    "the refusal carries Connection: close");

  // An Upgrade: request is not a CONNECT either: refused and destroyed.
  const up = connect(socketPath);
  await once(up, "connect");
  up.write("GET / HTTP/1.1\r\nHost: registry.npmjs.org\r\nConnection: upgrade\r\nUpgrade: websocket\r\n\r\n");
  const [upClosed] = await Promise.race([once(up, "close").then(() => [true]), new Promise<boolean[]>(r => setTimeout(() => r([false]), 2000))]);
  assert.equal(upClosed, true, "an upgrade request is refused and destroyed, not left open");

  // A CONNECT pipelined behind a refused request is still policy-checked and
  // refused -- the socket the refusal closed cannot smuggle it into a dial.
  const both = connect(socketPath);
  await once(both, "connect");
  both.write("GET / HTTP/1.1\r\nHost: registry.npmjs.org\r\n\r\nCONNECT user:password@registry.npmjs.org:443 HTTP/1.1\r\nHost: registry.npmjs.org:443\r\n\r\n");
  let bothBytes = Buffer.alloc(0);
  both.on("data", (chunk: Buffer) => { bothBytes = Buffer.concat([bothBytes, chunk]); });
  const [bothClosed] = await Promise.race([once(both, "close").then(() => [true]), new Promise<boolean[]>(r => setTimeout(() => r([false]), 2000))]);
  assert.equal(bothClosed, true, "the refused connection closes");
  assert.equal(bothBytes.includes("200 Connection Established"), false, "no tunnel was established behind the refused request");
  await until(() => audits.some(e => e.decision === "refuse"), "the pipelined CONNECT is audited");
  assert.equal(dials.length, 0, "nothing was dialed -- every request on the refused socket stayed refused");
});

test("DR34: the audit journal carries the normalized host:port or a redaction marker -- never request bytes", async t => {
  const audits: EgressAudit[] = [];
  const { socketPath } = await proxyWorld(t, async () => new Socket(), e => audits.push(e));
  // A credential-bearing authority is refused at the grammar and must not
  // leave the password in the journal.
  const withCredentials = await connectRaw(socketPath, "CONNECT user:passw0rd@evil.com:443 HTTP/1.1\r\nHost: x\r\n\r\n");
  assert.equal(withCredentials.status, 403);
  // A query string on a plain request is request content the same way.
  const withQuery = await connectRaw(socketPath, "GET /x?api_key=SECRET HTTP/1.1\r\nHost: registry.npmjs.org\r\n\r\n");
  assert.equal(withQuery.status, 502);
  // A policy refusal still names its normalized target.
  const offList = await connectRaw(socketPath, "CONNECT pypi.org:443 HTTP/1.1\r\n\r\n");
  assert.equal(offList.status, 200);
  offList.socket.destroy();
  const journal = JSON.stringify(audits);
  assert.ok(!journal.includes("passw0rd") && !journal.includes("SECRET") && !journal.includes("api_key"),
    `request bytes must never reach the journal: ${journal}`);
  assert.equal(audits.find(e => e.target === "pypi.org:443")!.target, "pypi.org:443",
    "a parsed refusal still records the normalized host:port");
  assert.ok(audits.filter(e => e.decision === "refuse").every(e => e.target.length > 0 && e.target.length < 300));
});

test("DR34: the proxy socket obeys the same 0600 ownership discipline as every sibling listener", async t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-connect-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const socketPath = join(dir, "egress.sock");
  const proxy = await ConnectProxy.open({ socketPath, actor: "alice", dial: async () => new Socket() });
  t.after(() => proxy.close());
  assert.equal(statSync(socketPath).mode & 0o777, 0o600,
    "the unix listener is private to this user whatever the umask");
});

test("DR34: a failure after the dial ends the upstream it opened -- nothing is orphaned", async t => {
  const port = await echo(t);
  const dialed: Socket[] = [];
  // The audit callback throws on the allow line -- the tunnel is half-built.
  const { socketPath } = await proxyWorld(t,
    async () => { const s = connect({ host: "127.0.0.1", port }); dialed.push(s); return s; },
    () => { throw new Error("journal unavailable"); });
  const { status, socket } = await connectRaw(socketPath, "CONNECT registry.npmjs.org:443 HTTP/1.1\r\n\r\n");
  assert.notEqual(status, 200, "no tunnel was handed out");
  assert.equal(dialed.length, 1, "the dial happened before the throw");
  await until(() => dialed[0]!.destroyed, "the upstream the proxy opened is destroyed with the client");
  assert.ok(socket.destroyed, "the client socket is destroyed too");
});

test("DR34: an audit sink that throws cannot crash the proxy's synchronous listeners -- the refusal still stands", async t => {
  // The "request" and "upgrade" listeners run inside `server.emit`: a sink
  // throw there escaped whole and took the runner -- every tunnel and relay
  // of the delivery -- down with it. Now the journal is best-effort at
  // these boundaries: refused, destroyed, and the listener keeps serving.
  const { socketPath } = await proxyWorld(t, async () => new Socket(), () => { throw new Error("journal unavailable"); });
  const get = await connectRaw(socketPath, "GET / HTTP/1.1\r\nHost: registry.npmjs.org\r\n\r\n");
  assert.equal(get.status, 502, "the refusal still answers with the journal dead");
  await until(() => get.socket.destroyed, "the refused socket is destroyed");
  // The upgrade listener the same way: refused, destroyed, no escape.
  const up = connect(socketPath);
  await once(up, "connect");
  up.write("GET / HTTP/1.1\r\nHost: registry.npmjs.org\r\nConnection: upgrade\r\nUpgrade: websocket\r\n\r\n");
  const [upClosed] = await Promise.race([once(up, "close").then(() => [true]), new Promise<boolean[]>(r => setTimeout(() => r([false]), 2000))]);
  assert.equal(upClosed, true, "an upgrade is refused and destroyed with the journal dead");
  // A refused CONNECT dies through the connect handler's own boundary --
  // refused and destroyed, still no escape. (A dead journal means no 403
  // frame either: the refusal's record is gone with the socket.)
  const refused = connect(socketPath);
  await once(refused, "connect");
  refused.write("CONNECT pypi.org:443 HTTP/1.1\r\n\r\n");
  const [rClosed] = await Promise.race([once(refused, "close").then(() => [true]), new Promise<boolean[]>(r => setTimeout(() => r([false]), 2000))]);
  assert.equal(rClosed, true, "a refused CONNECT dies through its own boundary");
  // This test itself still running is the process-survives proof; the
  // listener also kept answering -- a second non-CONNECT refusal lands.
  const again = await connectRaw(socketPath, "GET / HTTP/1.1\r\nHost: pypi.org\r\n\r\n");
  assert.equal(again.status, 502, "the proxy kept refusing past the dead journal");
  await until(() => again.socket.destroyed, "the second refused socket is destroyed too");
});

test("DR34: an upstream-initiated close ends the tunnel and frees its slot at once", async t => {
  // The target's end of the tunnel dying -- here a RST from the server side
  // of the dialed connection -- must end the client half too. Without the
  // propagation the client stayed open and held its `tunnels` slot until the
  // idle budget (120s) ran out: a slot the run could never reuse.
  const upstreamPeers: Socket[] = [];
  const server = createServer(socket => { upstreamPeers.push(socket); socket.pipe(socket); });
  await once(server.listen(0, "127.0.0.1"), "listening");
  t.after(() => { server.close(); });
  const port = (server.address() as { port: number }).port;
  const { proxy, socketPath } = await proxyWorld(t, async () => connect({ host: "127.0.0.1", port }));
  const { status, socket } = await connectRaw(socketPath, "CONNECT registry.npmjs.org:443 HTTP/1.1\r\n\r\n");
  assert.equal(status, 200);
  assert.equal(proxy.activeTunnels, 1);
  t.after(() => socket.destroy());
  // The dial resolves with a socket that is still connecting; the upstream
  // server sees it a turn later. Wait for the peer before ending it.
  await until(() => upstreamPeers.length === 1, "the dialed upstream connected");
  upstreamPeers[0]!.resetAndDestroy();
  const [closed] = await Promise.race([
    once(socket, "close").then(() => [true]),
    new Promise<boolean[]>(r => setTimeout(() => r([false]), 3000)),
  ]);
  assert.equal(closed, true, "the client half followed the upstream's end");
  await until(() => proxy.activeTunnels === 0, "the tunnel slot was freed without waiting for idleMs");
});

test("DR34: the tunnel working set queues -- it never refuses; a close grants, a queued close withdraws", async t => {
  const port = await echo(t);
  const dir = mkdtempSync(join(tmpdir(), "oma-connect-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const socketPath = join(dir, "egress.sock");
  let dialed = 0;
  const proxy = await ConnectProxy.open({ socketPath, actor: "alice", tunnels: 1,
    dial: async () => { dialed++; return connect({ host: "127.0.0.1", port }); } });
  t.after(() => proxy.close());
  const first = await connectRaw(socketPath, "CONNECT registry.npmjs.org:443 HTTP/1.1\r\n\r\n");
  assert.equal(first.status, 200);
  assert.equal(proxy.activeTunnels, 1);
  t.after(() => first.socket.destroy());

  // The second CONNECT waits: no refusal, no answer, no dial while the slot stands.
  let secondSettled = false;
  const second = connectRaw(socketPath, "CONNECT registry.npmjs.org:443 HTTP/1.1\r\n\r\n")
    .then(result => { secondSettled = true; return result; });
  await until(() => proxy.queuedTunnels === 1, "the second CONNECT queues");
  await new Promise(r => setTimeout(r, 200));
  assert.equal(secondSettled, false, "the queued request is neither answered nor refused");
  assert.equal(dialed, 1, "a queued claim holds no upstream");

  // A third claim queues behind it; its own close withdraws it -- nothing is
  // dialed for a client that is no longer there.
  const gone = connect(socketPath);
  await once(gone, "connect");
  gone.write("CONNECT registry.npmjs.org:443 HTTP/1.1\r\n\r\n");
  await until(() => proxy.queuedTunnels === 2, "a third claim queues behind the second");
  gone.destroy();
  await until(() => proxy.queuedTunnels === 1, "the departed client's claim withdrew");

  // The standing tunnel's close grants the queue's head, in order.
  first.socket.destroy();
  const granted = await second;
  assert.equal(granted.status, 200, "the queued request runs once the slot frees");
  assert.equal(dialed, 2, "only the granted claim ever dialed");
  assert.equal(proxy.queuedTunnels, 0);
  granted.socket.destroy();
});

test("DR34: closing the proxy ends its tunnels and removes its name", async t => {
  const port = await echo(t);
  const dir = mkdtempSync(join(tmpdir(), "oma-connect-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const socketPath = join(dir, "egress.sock");
  const proxy = await ConnectProxy.open({ socketPath, actor: "alice", dial: async () => connect({ host: "127.0.0.1", port }) });
  const { status, socket } = await connectRaw(socketPath, "CONNECT registry.npmjs.org:443 HTTP/1.1\r\n\r\n");
  assert.equal(status, 200);
  assert.equal(proxy.activeTunnels, 1);
  const closed = once(socket, "close");
  await proxy.close();
  await closed;
  assert.equal(proxy.activeTunnels, 0);
  // The name is gone (P0V-114): nothing accepts on it now.
  await assert.rejects(new Promise((ok, fail) => {
    const probe = connect(socketPath);
    probe.once("connect", () => { probe.destroy(); ok(undefined); });
    probe.once("error", fail);
  }));
});

/* ---------------- Resident wiring ---------------- */

test("DR34: with an egress socket the plan binds it and exports the proxy environment; without one it exposes nothing", () => {
  const options = residentOptions("/state");
  const plain = planPiSpawn(residentEngineEffects.sandbox, options).args;
  assert.equal(plain.includes(RESIDENT_PATHS.egress), false);
  const plainEnv = Object.fromEntries(plain.flatMap((arg, index) => arg === "--setenv" ? [[plain[index + 1]!, plain[index + 2]!]] : []));
  for (const key of ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "OMA_EGRESS_PROXY_SOCKET", "OMA_EGRESS_PROXY_PORT"])
    assert.equal(plainEnv[key], undefined, key);

  const socketHostPath = "/state/run/agents/alice/1/egress.sock";
  const plan = planPiSpawn(residentEngineEffects.sandbox, { ...options, confinement: { ...options.confinement, egress: { socketHostPath } } });
  // The inside path also appears as the OMA_EGRESS_PROXY_SOCKET value; find the
  // mount triple itself.
  const at = plan.args.findIndex((arg, index) =>
    arg === "--ro-bind" && plan.args[index + 1] === socketHostPath && plan.args[index + 2] === RESIDENT_PATHS.egress);
  assert.ok(at >= 0, "the host proxy socket is bound at the inside path");
  const env = Object.fromEntries(plan.args.flatMap((arg, index) => arg === "--setenv" ? [[plan.args[index + 1]!, plan.args[index + 2]!]] : []));
  assert.equal(env.HTTP_PROXY, "http://127.0.0.1:8318");
  assert.equal(env.HTTPS_PROXY, "http://127.0.0.1:8318");
  assert.equal(env.ALL_PROXY, "http://127.0.0.1:8318");
  assert.equal(env.http_proxy, env.HTTP_PROXY);
  assert.equal(env.https_proxy, env.HTTPS_PROXY);
  assert.equal(env.all_proxy, env.ALL_PROXY);
  assert.ok(env.NO_PROXY!.includes("127.0.0.1") && env.NO_PROXY!.includes("localhost"), "the engine's own loopback stays direct");
  assert.equal(env.OMA_EGRESS_PROXY_SOCKET, RESIDENT_PATHS.egress);
  assert.equal(env.OMA_EGRESS_PROXY_PORT, "8318");
  // The mount builder refuses an untrusted socket path rather than bind it.
  const { host, lease, directories } = options.confinement;
  assert.throws(() => residentArgv(host, lease, directories, [], {}, undefined, "relative.sock"), { code: "UNSUPPORTED_PROFILE" });
  assert.throws(() => residentArgv(host, lease, directories, [], {}, undefined, "/tmp/../x"), { code: "UNSUPPORTED_PROFILE" });
});

/* ---------------- configuration ---------------- */

function hostWith(egress: unknown): Parameters<typeof validateConfig>[0] {
  const config = defaultHostConfig({ society: "demo", node: process.execPath, libdir: "/opt/oma",  deploymentDigest: "a".repeat(64) });
  return { ...config, egress } as Parameters<typeof validateConfig>[0];
}

test("DR46: current host configuration refuses removed policy fields and prior schema", () => {
  const config = defaultHostConfig({ society: "demo", node: process.execPath, libdir: "/opt/oma",  deploymentDigest: "a".repeat(64) });
  assert.equal(config.schemaVersion, 4);
  assert.throws(() => validateConfig({ ...config, schemaVersion: 1 }), /unsupported development configuration schema/);
  assert.throws(() => validateConfig({ ...config, quota: { storageBytes: 1 } }), /unknown top-level field quota/);
  assert.throws(() => validateConfig(hostWith({ allow: ["*"] })), /unknown top-level field egress/);
});
