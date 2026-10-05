/** UX-08/DR34: the CONNECT egress proxy -- its policy grammar, SSRF screen,
 * pinned dial, socket protocol and lifecycle, and the Resident wiring that
 * exposes it. The adversarial cases the task names -- private/loopback/
 * link-local/CGNAT destinations, non-allowlisted names, smuggled or oversized
 * heads, and DNS answers that land in private space -- are all first-class
 * subjects here.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { connect, createServer, Socket } from "node:net";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import {
  allowsEgressEndpoint, connectHostProblem, egressEntryMatches, egressEntryProblem, egressPolicyFor,
  normalizeEgressHost, parseConnectTarget, type EgressPolicy,
} from "../src/domain/egress.js";
import {
  ConnectProxy, isPublicConnectAddress, makePublicDial, type ConnectDial, type EgressAudit,
} from "../src/runtime/connect-proxy.js";
import { StoreError } from "../src/domain/errors.js";
import { validateConfig } from "../src/config.js";
import { defaultHostConfig } from "../src/config/defaults.js";
import { planPiSpawn } from "../src/runtime/pi-spawn-plan.js";
import { residentArgv, RESIDENT_PATHS } from "../src/sandbox.js";
import { residentOptions } from "./fixtures/resident.js";

const POLICY: EgressPolicy = Object.freeze({ role: "worker", allow: Object.freeze(["registry.npmjs.org", "*.github.com", "deb.debian.org"]) });

/* ---------------- policy grammar ---------------- */

test("DR34: egress entries are DNS names and *.suffix wildcards, nothing else", () => {
  for (const entry of ["registry.npmjs.org", "*.github.com", "a.b.c.example.org", "deb.debian.org", "xn--nxasmq6b.example"])
    assert.equal(egressEntryProblem(entry), null, entry);
  assert.notEqual(egressEntryProblem(42), null, "a non-string entry is refused");
  for (const entry of [
    "",                                                                         // empty
    "10.0.0.1", "127.0.0.1", "169.254.169.254", "192.168.1.1", "100.64.0.1",      // IPv4 literals
    "1.2.3", "2130706433", "0",                                                 // partial/bare-number encodings
    "[::1]", "::1", "fe80::1",                                                  // IPv6 spellings
    "*", "*.", "*.com", "*.org", "x.*.com", "**.example.com",                   // wildcards out of place or TLD-wide
    "registry.npmjs.org:443", "https://registry.npmjs.org",                     // ports/schemes are not entries
    "registry.npmjs.org/path", "registry npmjs.org", "registry..npmjs..org",
    `${"x".repeat(64)}.com`,                                                    // a label past 63
    `${"a.".repeat(126)}x.com`,                                                 // past 253 bytes
    "NPMJS.ORG",                                                                // entries are normalized spelling
  ]) assert.notEqual(egressEntryProblem(entry), null, entry);
});

test("DR34: the allowlist matches normalized names; a wildcard is subdomains only, never the apex", () => {
  assert.equal(normalizeEgressHost("Registry.NPMJS.Org."), "registry.npmjs.org");
  assert.equal(normalizeEgressHost("a..b"), "a..b");
  const host = normalizeEgressHost;
  assert.ok(egressEntryMatches("*.github.com", "api.github.com"));
  assert.ok(!egressEntryMatches("*.github.com", "github.com"));
  assert.ok(!egressEntryMatches("registry.npmjs.org", "a.registry.npmjs.org"), "a plain entry is exact, not a suffix");
  assert.ok(allowsEgressEndpoint(POLICY, host("registry.npmjs.org")));
  assert.ok(allowsEgressEndpoint(POLICY, host("Registry.Npmjs.ORG.")));
  assert.ok(allowsEgressEndpoint(POLICY, host("api.github.com")), "*.github.com covers a subdomain");
  assert.ok(allowsEgressEndpoint(POLICY, host("a.b.github.com")), "and a deeper one");
  assert.equal(allowsEgressEndpoint(POLICY, host("github.com")), false, "the apex itself is not under *.");
  assert.equal(allowsEgressEndpoint(POLICY, host("evilgithub.com")), false, "a suffix without the dot is not under it");
  assert.equal(allowsEgressEndpoint(POLICY, host("github.com.evil.org")), false);
  assert.equal(allowsEgressEndpoint(POLICY, host("pypi.org")), false, "unlisted name");
  assert.equal(allowsEgressEndpoint(POLICY, host("10.0.0.1")), false);
  assert.equal(allowsEgressEndpoint(POLICY, host("")), false);
});

test("DR34: per-role resolution unions the baseline with the role's own entries; empty means no proxy", () => {
  const config = { allow: ["registry.npmjs.org"], roles: { worker: ["deb.debian.org"], principal: [] } };
  const worker = egressPolicyFor(config, "worker");
  const principal = egressPolicyFor(config, "principal");
  const nobody = egressPolicyFor(config, "nobody");
  assert.ok(worker && allowsEgressEndpoint(worker, "deb.debian.org") && allowsEgressEndpoint(worker, "registry.npmjs.org"));
  assert.ok(principal && allowsEgressEndpoint(principal, "registry.npmjs.org") && !allowsEgressEndpoint(principal, "deb.debian.org"));
  assert.ok(nobody && allowsEgressEndpoint(nobody, "registry.npmjs.org"), "an unlisted role still reaches the baseline");
  assert.equal(egressPolicyFor(undefined, "worker"), null, "no clause, no proxy");
  assert.equal(egressPolicyFor({ allow: [], roles: { worker: [] } }, "worker"), null, "an empty set is no socket at all");
  assert.equal(egressPolicyFor({ allow: [], roles: { other: ["x.example"] } }, "worker"), null);
});

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
  assert.equal(connectHostProblem("registry.npmjs.org"), null);
  assert.equal(connectHostProblem("[::1]"), null);
  for (const host of ["", "a b", "a/b", "@x", "a:443", 42, null]) assert.notEqual(connectHostProblem(host), null, String(host));
});

/* ---------------- the SSRF screen ---------------- */

test("DR34: no private, loopback, link-local, CGNAT, reserved or special-use address is a public destination", () => {
  const refused = [
    "0.0.0.0", "0.1.2.3", "10.0.0.1", "10.255.255.255", "100.64.0.1", "100.127.255.255",
    "127.0.0.1", "127.53.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255",
    "192.0.0.9", "192.0.2.1", "192.31.196.1", "192.52.193.1", "192.88.99.1", "192.168.0.1", "192.168.255.255",
    "192.175.48.1", "198.18.0.1", "198.19.255.255", "198.51.100.1", "203.0.113.1",
    "224.0.0.1", "239.255.255.255", "240.0.0.1", "255.255.255.255",
    // IPv6: loopback, unspecified, link-local, ULA, multicast, discard, docs.
    "::", "::1", "0:0:0:0:0:0:0:1", "fe80::1", "fe80::ffff:ffff:ffff:ffff", "fec0::1", "fc00::1", "fd12:3456::1",
    "ff02::1", "ff05::1", "100::1", "2001:db8::1",
    // Encoded private space: v4-mapped, NAT64, Teredo, 6to4.
    "::ffff:127.0.0.1", "::ffff:0a00:0001", "64:ff9b::10.0.0.1", "2001:0000:4136:e378:8000:63bf:3fff:fdd2",
    "2002:0a00:0001::1", "2002:7f00:0001::",
    // Not an address at all.
    "not-an-address", "", "999.999.999.999",
  ];
  for (const address of refused) assert.equal(isPublicConnectAddress(address), false, address);
  for (const address of ["8.8.8.8", "1.1.1.1", "104.16.0.1", "9.9.9.9",
    "2001:4860:4860::8888", "2606:4700:4700::1111",
    "::ffff:8.8.8.8", "64:ff9b::8.8.8.8", "2002:0808:0808::"])
    assert.equal(isPublicConnectAddress(address), true, address);
  // Teredo/6to4 wrapping a *public* IPv4 is not refused by the embedded
  // address; the spelling itself is still carrier space the dialer may use.
});

test("DR34: the v6 screen fails closed -- global unicast minus its special-purpose ranges, nothing else", () => {
  const refused = [
    // ::/8 remnants beyond the unwrapped forms: unspecified, loopback,
    // deprecated v4-compatible and never-assigned early space.
    "::", "::1", "::2", "::0a00:0001", "::ffff", "0:0:0:0:0:0:0:2",
    // RFC 8215 local-use NAT64: its whole purpose is translating non-global
    // answers, so the range can never name a public destination -- refused
    // outright rather than by embedded address.
    "64:ff9b:1::1", "64:ff9b:1:0a00:0001::1", "64:ff9b:1:ffff:ffff:ffff:ffff:ffff",
    // 2001::/23 IETF protocol assignments other than Teredo: ORCHID v1/v2,
    // benchmarking, AMT, AS112-v6, DECT-ULE, anycast stubs and the rest.
    "2001:1::1", "2001:2::1", "2001:3::1", "2001:4:112::1", "2001:10::1",
    "2001:20::1", "2001:30::1", "2001:1ff::1",
    // Documentation space in both spellings, AS112, SRv6 SIDs.
    "2001:db8::1", "3fff::1", "3fff:fff0::1", "2620:4f:8000::1", "5f00::1", "5f00:ffff::1",
    // NAT64 well-known prefix and mapped forms carrying private answers.
    "64:ff9b::10.0.0.1", "64:ff9b::7f00:1", "::ffff:ac10:0001",
    // Everything outside 2000::/3 is not global unicast at all.
    "100::1", "fc00::1", "fd12:3456::1", "fe80::1", "fec0::1", "ff02::1",
  ];
  for (const address of refused) assert.equal(isPublicConnectAddress(address), false, address);
  for (const address of [
    "2001:4860:4860::8888", "2606:4700:4700::1111",
    "2001:200::1",              // ordinary global unicast just past 2001::/23
    "2001:db7::1",              // just past 2001:db8::/32's documentation boundary
    "3fe0::1",                  // just outside documentation 3fff::/20
    "2002:0808:0808::", "::ffff:8.8.8.8", "64:ff9b::8.8.8.8",
    // Teredo: the embedded client IPv4 (bits-inverted tail) decides -- f7f7:f7f7 is 8.8.8.8.
    "2001:0000:0808:0808:8000:63bf:f7f7:f7f7",
  ]) assert.equal(isPublicConnectAddress(address), true, address);
  // Teredo/6to4 wrapping a private answer still refuse on the embedded value:
  // f5ff:fffe embeds 10.0.0.1, 80ff:fffe embeds 127.0.0.1.
  for (const address of ["2001:0000:0808:0808:8000:63bf:f5ff:fffe", "2001:0000:0808:0808:8000:63bf:80ff:fffe"])
    assert.equal(isPublicConnectAddress(address), false, address);
});

/* ---------------- the pinned dial ---------------- */

test("DR34: the dial resolves once, screens every answer, and pins the chosen address", async () => {
  const dialed: string[] = [];
  const connect = async (address: string, _port: number): Promise<Socket> => {
    dialed.push(address);
    const socket = new Socket();
    return socket;
  };
  const dial = makePublicDial({ connect, lookup: async () => [{ address: "10.0.0.9", family: 4 }, { address: "104.16.1.1", family: 4 }] });
  await dial("registry.npmjs.org", 443);
  assert.deepEqual(dialed, ["104.16.1.1"], "the private answer was screened and the public one was dialed literally -- no name re-resolution");
});

test("DR34: a name resolving only to private space is refused, and connect() is never attempted", async () => {
  let connects = 0;
  const dial = makePublicDial({ lookup: async () => [{ address: "169.254.169.254", family: 4 }], connect: async () => { connects += 1; return new Socket(); } });
  await assert.rejects(dial("metadata.internal", 443), (error: unknown) =>
    error instanceof StoreError && error.code === "INVALID_REQUEST" && /private/.test(error.message));
  assert.equal(connects, 0);
});

test("DR34: rebinding is screened per answer set, and a public answer's literal is what gets dialed", async () => {
  // The answer a hostile resolver flips to after the allowlist name was
  // checked: the name is judged, but the address is what is screened and
  // pinned -- an answer flipped to loopback refuses, not connects.
  const dial = makePublicDial({ lookup: async () => [{ address: "127.0.0.1", family: 4 }, { address: "::1", family: 6 }] });
  await assert.rejects(dial("registry.npmjs.org", 443), (e: unknown) => e instanceof StoreError && (e as StoreError).code === "INVALID_REQUEST");
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
  const proxy = await ConnectProxy.open({ socketPath, policy: POLICY, actor: "alice", dial, ...(audit === undefined ? {} : { audit }) });
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
  assert.deepEqual([audits[0]!.actor, audits[0]!.role, audits[0]!.target, audits[0]!.decision], ["alice", "worker", "registry.npmjs.org:443", "allow"]);
});

test("DR34: refused CONNECTs -- unlisted names, literals, other ports -- answer 403 and nothing is dialed", async t => {
  let dialed = 0;
  const audits: EgressAudit[] = [];
  const { socketPath } = await proxyWorld(t, async () => { dialed += 1; return new Socket(); }, e => audits.push(e));
  for (const target of ["pypi.org:443", "github.com:443", "[::1]:443", "127.0.0.1:443", "registry.npmjs.org:22", "registry.npmjs.org:80"]) {
    const { status } = await connectRaw(socketPath, `CONNECT ${target} HTTP/1.1\r\n\r\n`);
    assert.equal(status, 403, target);
  }
  assert.equal(dialed, 0);
  assert.equal(audits.filter(e => e.decision === "refuse").length, 6);
  assert.ok(audits.every(e => e.reason.length > 0));
});

test("DR34: a dial refusal answers 502/403 and the error stays a refusal, never a tunnel", async t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-connect-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const refused = await ConnectProxy.open({ socketPath: join(dir, "a.sock"), policy: POLICY, actor: "alice",
    dial: async () => { throw new StoreError("INVALID_REQUEST", "egress destination resolves only to private or special-use addresses"); } });
  const broken = await ConnectProxy.open({ socketPath: join(dir, "b.sock"), policy: POLICY, actor: "alice",
    dial: async () => { throw new Error("ECONNREFUSED"); } });
  t.after(async () => { await refused.close(); await broken.close(); });
  assert.equal((await connectRaw(join(dir, "a.sock"), "CONNECT registry.npmjs.org:443 HTTP/1.1\r\n\r\n")).status, 403);
  assert.equal((await connectRaw(join(dir, "b.sock"), "CONNECT registry.npmjs.org:443 HTTP/1.1\r\n\r\n")).status, 502);
});

test("DR34: malformed requests -- non-CONNECT, garbage, oversized heads -- are refused or destroyed", async t => {
  const { socketPath } = await proxyWorld(t, async () => new Socket());
  // A plain GET is not a tunnel: refused with a status.
  const get = await connectRaw(socketPath, "GET http://registry.npmjs.org/ HTTP/1.1\r\nHost: registry.npmjs.org\r\n\r\n");
  assert.equal(get.status, 405);
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
  // keep-alive holding a maxConnections slot (the refusal says close, and the
  // proxy enforces it rather than trusting the peer to leave).
  const get = connect(socketPath);
  await once(get, "connect");
  get.write("GET http://registry.npmjs.org/?api_key=SECRET HTTP/1.1\r\nHost: registry.npmjs.org\r\n\r\n");
  let getBytes = Buffer.alloc(0);
  get.on("data", (chunk: Buffer) => { getBytes = Buffer.concat([getBytes, chunk]); });
  const [getClosed] = await Promise.race([once(get, "close").then(() => [true]), new Promise<boolean[]>(r => setTimeout(() => r([false]), 2000))]);
  assert.equal(getClosed, true, "the 405 connection must close, not linger");
  assert.match(getBytes.toString("latin1"), /^HTTP\/1\.1 405 .*\r\n(.*\r\n)*?[Cc]onnection: close\r\n/s,
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
  both.write("GET / HTTP/1.1\r\nHost: registry.npmjs.org\r\n\r\nCONNECT registry.npmjs.org:443 HTTP/1.1\r\nHost: registry.npmjs.org:443\r\n\r\n");
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
  const withQuery = await connectRaw(socketPath, "GET http://registry.npmjs.org/x?api_key=SECRET HTTP/1.1\r\nHost: registry.npmjs.org\r\n\r\n");
  assert.equal(withQuery.status, 405);
  // A policy refusal still names its normalized target.
  const offList = await connectRaw(socketPath, "CONNECT pypi.org:443 HTTP/1.1\r\n\r\n");
  assert.equal(offList.status, 403);
  const journal = JSON.stringify(audits);
  assert.ok(!journal.includes("passw0rd") && !journal.includes("SECRET") && !journal.includes("api_key"),
    `request bytes must never reach the journal: ${journal}`);
  assert.equal(audits.find(e => e.reason === "not on the egress allowlist")!.target, "pypi.org:443",
    "a parsed refusal still records the normalized host:port");
  assert.ok(audits.filter(e => e.decision === "refuse").every(e => e.target.length > 0 && e.target.length < 300));
});

test("DR34: the proxy socket obeys the same 0600 ownership discipline as every sibling listener", async t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-connect-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const socketPath = join(dir, "egress.sock");
  const proxy = await ConnectProxy.open({ socketPath, policy: POLICY, actor: "alice", dial: async () => new Socket() });
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

test("DR34: closing the proxy ends its tunnels and removes its name", async t => {
  const port = await echo(t);
  const dir = mkdtempSync(join(tmpdir(), "oma-connect-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const socketPath = join(dir, "egress.sock");
  const proxy = await ConnectProxy.open({ socketPath, policy: POLICY, actor: "alice", dial: async () => connect({ host: "127.0.0.1", port }) });
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
  const plain = planPiSpawn(options).args;
  assert.equal(plain.includes(RESIDENT_PATHS.egress), false);
  const plainEnv = Object.fromEntries(plain.flatMap((arg, index) => arg === "--setenv" ? [[plain[index + 1]!, plain[index + 2]!]] : []));
  for (const key of ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "OMA_EGRESS_PROXY_SOCKET", "OMA_EGRESS_PROXY_PORT"])
    assert.equal(plainEnv[key], undefined, key);

  const socketHostPath = "/state/run/agents/alice/1/egress.sock";
  const plan = planPiSpawn({ ...options, confinement: { ...options.confinement, egress: { socketHostPath } } });
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
  assert.throws(() => residentArgv(host, lease, directories, {}, undefined, "relative.sock"), { code: "UNSUPPORTED_PROFILE" });
  assert.throws(() => residentArgv(host, lease, directories, {}, undefined, "/tmp/../x"), { code: "UNSUPPORTED_PROFILE" });
});

/* ---------------- configuration ---------------- */

function hostWith(egress: unknown): Parameters<typeof validateConfig>[0] {
  const config = defaultHostConfig({ society: "demo", node: process.execPath, libdir: "/opt/oma", rootfs: "/rootfs", deploymentDigest: "a".repeat(64) });
  return { ...config, egress } as Parameters<typeof validateConfig>[0];
}

test("DR34: the egress clause is Human configuration -- closed, checked whole at commit", () => {
  const role = Object.keys(defaultHostConfig({ society: "demo", node: process.execPath, libdir: "/opt/oma", rootfs: "/rootfs", deploymentDigest: "a".repeat(64) }).agentProfiles)[0]!;
  const valid = validateConfig(hostWith({ allow: ["registry.npmjs.org", "*.github.com"], roles: { [role]: ["deb.debian.org"] } }));
  assert.deepEqual(valid.egress!.allow, ["registry.npmjs.org", "*.github.com"]);
  assert.equal(Object.isFrozen(valid.egress), true);
  // A present-but-empty clause admits nothing and is refused instead.
  assert.throws(() => validateConfig(hostWith({ allow: [] })), /no endpoint/);
  assert.throws(() => validateConfig(hostWith({ allow: [], roles: { [role]: [] } })), /no endpoint/);
  // Unknown fields, bad entries, a role that is no profile: all refused.
  assert.throws(() => validateConfig(hostWith({ allow: ["x.com"], extra: 1 })), /egress\.extra unknown/);
  assert.throws(() => validateConfig(hostWith({ allow: ["10.0.0.1"] })), /address literal/);
  assert.throws(() => validateConfig(hostWith({ allow: ["x.com"], roles: { ghost: ["y.com"] } })), /not a configured profile/);
  assert.throws(() => validateConfig(hostWith({ allow: ["x.com"], roles: { [role]: "notalist" } })), /egress\.roles/);
  assert.throws(() => validateConfig(hostWith({ allow: "registry.npmjs.org" })), /egress\.allow/);
});

test("DR34: the wire's 256-entry bound holds at commit -- the resolved list is what egress.connect carries", () => {
  const role = Object.keys(defaultHostConfig({ society: "demo", node: process.execPath, libdir: "/opt/oma", rootfs: "/rootfs", deploymentDigest: "a".repeat(64) }).agentProfiles)[0]!;
  // One baseline past the wire bound is refused at commit -- on macOS the
  // resolved list rides egress.connect, which refuses a longer list, so a
  // config Linux would run must not be committable.
  assert.throws(() => validateConfig(hostWith({ allow: Array(257).fill("a.example") })), /256/);
  // The bound counts the resolved list: baseline + this role's own entries.
  assert.throws(() => validateConfig(hostWith({ allow: Array(200).fill("a.example"), roles: { [role]: Array(57).fill("b.example") } })), /256/);
  const atBound = validateConfig(hostWith({ allow: Array(200).fill("a.example"), roles: { [role]: Array(56).fill("b.example") } }));
  assert.equal(atBound.egress!.allow.length + atBound.egress!.roles![role]!.length, 256);
});
