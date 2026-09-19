/** INF-005/006/007/008: the relay a confined Resident reaches a provider through.
 *
 * These run real sockets against a real TLS server standing in for a provider.
 * Nothing is stubbed: a pass means bytes crossed a unix socket, gained the
 * host's credential, and came back.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { connect as netConnect, createServer as createNetServer, type Server } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InferenceRelay } from "../src/runtime/inference-relay.js";
import { tlsProvider } from "./fixtures/tls-provider.js";

/** The sandbox bridge, as the core extension runs it: a loopback port whose
 * bytes are forwarded, unread, into the relay's unix socket. */
async function bridge(socketPath: string): Promise<{ port: number; close(): void }> {
  const server: Server = createNetServer(client => {
    const upstream = netConnect(socketPath);
    const drop = (): void => { client.destroy(); upstream.destroy(); };
    client.on("error", drop); upstream.on("error", drop);
    client.pipe(upstream); upstream.pipe(client);
  });
  await new Promise<void>(resolve => { server.listen(0, "127.0.0.1", () => { resolve(); }); });
  const address = server.address();
  return { port: typeof address === "object" && address ? address.port : 0, close: () => { server.close(); } };
}

async function throughBridge(
  socketPath: string, path: string, body: string, headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  const bridged = await bridge(socketPath);
  try {
    return await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const outgoing = httpRequest({
        host: "127.0.0.1", port: bridged.port, path, method: "POST",
        headers: { "content-type": "application/json", ...headers },
      }, response => {
        let received = "";
        response.setEncoding("utf8");
        response.on("data", chunk => { received += chunk; });
        response.on("end", () => { resolve({ status: response.statusCode ?? 0, body: received }); });
      });
      outgoing.on("error", reject);
      outgoing.end(body);
    });
  } finally { bridged.close(); }
}

function scratchSocket(): { path: string; clean(): void } {
  const dir = mkdtempSync(join(tmpdir(), "oma-relay-"));
  return { path: join(dir, "inference.sock"), clean: () => { rmSync(dir, { recursive: true, force: true }); } };
}

const code = (value: unknown): string | undefined => (value as { code?: string }).code;

// The stand-in provider is self-signed, so the relay's TLS client is told to
// trust it for the duration of these tests. Nothing in production does this.
const previousTlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
test.beforeEach(() => { process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; });
test.afterEach(() => {
  if (previousTlsSetting === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTlsSetting;
});

test("T114 the relay carries a request to the provider and attaches the host credential", async () => {
  const provider = await tlsProvider();
  const socket = scratchSocket();
  const relay = await InferenceRelay.open(socket.path,
    { origin: provider.origin, headers: { authorization: "Bearer real-secret" } },
    { concurrent: 4, timeoutMs: 5000 });
  try {
    const answer = await throughBridge(socket.path, "/v1/messages", '{"hello":true}',
      // A key the sandbox chose must not reach the provider or shadow the host's.
      { authorization: "Bearer chosen-inside", "x-api-key": "also-chosen-inside" });
    assert.equal(answer.status, 200);
    assert.equal(answer.body, "ab", "the provider's bytes must arrive unchanged");
    assert.equal(provider.seen.length, 1);
    const request = provider.seen[0]!;
    assert.equal(request.path, "/v1/messages");
    assert.equal(request.headers.authorization, "Bearer real-secret", "the host credential replaces the caller's");
    assert.equal(request.headers["x-api-key"], undefined, "a caller-chosen key must be dropped");
    assert.equal(request.body, '{"hello":true}', "the body is forwarded verbatim");
    assert.deepEqual(relay.observe(), { accepted: 1, refused: 0, failed: 0, inFlight: 0 });
  } finally { await relay.close(); await provider.close(); socket.clean(); }
});

test("T114 the placeholder the sandbox holds is swapped for the real key, and only it", async () => {
  const provider = await tlsProvider();
  const socket = scratchSocket();
  const placeholder = "sk-ant-api03-PLACEHOLDERxxxxxxxxxxxxxxxxxxxx";
  const secret = "sk-ant-api03-REALSECRETyyyyyyyyyyyyyyyyyyyyy";
  const relay = await InferenceRelay.open(socket.path,
    { origin: `${provider.origin}/v1`, headers: {}, substitute: { placeholder, secret } },
    { concurrent: 4, timeoutMs: 5000 });
  try {
    // The engine built its headers with the placeholder, in whatever scheme the
    // provider uses; some providers also carry the key in the query string.
    await throughBridge(socket.path, `/messages?key=${placeholder}`, `{"note":"${placeholder}"}`,
      { "x-api-key": placeholder, authorization: `Bearer ${placeholder}` });
    const request = provider.seen[0]!;
    assert.equal(request.headers["x-api-key"], secret);
    assert.equal(request.headers.authorization, `Bearer ${secret}`);
    assert.equal(request.path, `/v1/messages?key=${secret}`);
    // The body is the model's content, not a credential slot: it is not read,
    // so it is not rewritten either.
    assert.equal(request.body, `{"note":"${placeholder}"}`);
  } finally { await relay.close(); await provider.close(); socket.clean(); }
});

test("T114 a WebSocket upgrade is tunnelled with the key swapped, then carried as bytes", async () => {
  const provider = await tlsProvider();
  const socket = scratchSocket();
  const placeholder = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.PLACEHOLDERsignature00";
  const secret = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.REALsignature111111111";
  const relay = await InferenceRelay.open(socket.path,
    { origin: `${provider.origin}/backend-api`, headers: {}, substitute: { placeholder, secret } },
    { concurrent: 4, timeoutMs: 5000 });
  const bridged = await bridge(socket.path);
  try {
    const echoed = await new Promise<string>((resolve, reject) => {
      const outgoing = httpRequest({
        host: "127.0.0.1", port: bridged.port, path: "/codex/responses", method: "GET",
        headers: { connection: "Upgrade", upgrade: "websocket", authorization: `Bearer ${placeholder}`,
          "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" },
      });
      outgoing.on("upgrade", (response, tunnel) => {
        assert.equal(response.statusCode, 101);
        tunnel.once("data", chunk => { resolve(String(chunk)); tunnel.destroy(); });
        tunnel.write("frame-bytes");
      });
      outgoing.on("response", response => { reject(new Error(`no upgrade: ${response.statusCode}`)); });
      outgoing.on("error", reject);
      outgoing.end();
    });
    assert.equal(echoed, "echo:frame-bytes", "bytes must travel both ways through the tunnel");
    const handshake = provider.seen.find(entry => entry.upgrade)!;
    assert.equal(handshake.path, "/backend-api/codex/responses");
    assert.equal(handshake.headers.authorization, `Bearer ${secret}`);
  } finally { bridged.close(); await relay.close(); await provider.close(); socket.clean(); }
});

test("T114 the relay refuses a path that leaves the declared provider endpoint", async () => {
  const provider = await tlsProvider();
  const socket = scratchSocket();
  const relay = await InferenceRelay.open(socket.path,
    { origin: `${provider.origin}/v1`, headers: { authorization: "Bearer real-secret" } },
    { concurrent: 4, timeoutMs: 5000 });
  try {
    for (const path of ["/../admin", "/v1/..%2F..%2Fadmin", "//evil.example.com/v1"]) {
      const answer = await throughBridge(socket.path, path, "{}");
      assert.equal(answer.status, 403, `${path} must be refused`);
    }
    assert.equal(provider.seen.length, 0, "no refused request may reach the provider");
    const allowed = await throughBridge(socket.path, "/messages", "{}");
    assert.equal(allowed.status, 200);
    assert.equal(provider.seen[0]!.path, "/v1/messages", "the declared prefix is kept");
    assert.equal(relay.observe().refused, 3);
  } finally { await relay.close(); await provider.close(); socket.clean(); }
});

test("T114 a provider that never answers is reported, not retried", async () => {
  const provider = await tlsProvider();
  provider.reply = { status: 200, chunks: ["x"], delayMs: 3000 };
  const socket = scratchSocket();
  const relay = await InferenceRelay.open(socket.path,
    { origin: provider.origin, headers: { authorization: "Bearer real-secret" } },
    { concurrent: 4, timeoutMs: 250 });
  try {
    const answer = await throughBridge(socket.path, "/v1/messages", "{}");
    assert.equal(answer.status, 504);
    assert.equal(provider.seen.length, 1, "the relay resent an abandoned request");
    assert.equal(relay.observe().failed, 1);
    assert.equal(relay.observe().inFlight, 0, "an abandoned request must be released");
  } finally { await relay.close(); await provider.close(); socket.clean(); }
});

test("T114 the relay refuses beyond its concurrency limit instead of queueing", async () => {
  const provider = await tlsProvider();
  provider.reply = { status: 200, chunks: ["x"], delayMs: 400 };
  const socket = scratchSocket();
  const relay = await InferenceRelay.open(socket.path,
    { origin: provider.origin, headers: { authorization: "Bearer real-secret" } },
    { concurrent: 1, timeoutMs: 5000 });
  try {
    const [first, second] = await Promise.all([
      throughBridge(socket.path, "/v1/messages", "{}"),
      new Promise<{ status: number; body: string }>(resolve => {
        setTimeout(() => { void throughBridge(socket.path, "/v1/messages", "{}").then(resolve); }, 80).unref();
      }),
    ]);
    const statuses = [first.status, second.status].sort();
    assert.deepEqual(statuses, [200, 503], `expected one carried and one refused, got ${statuses.join(",")}`);
    assert.equal(relay.observe().refused, 1);
  } finally { await relay.close(); await provider.close(); socket.clean(); }
});

test("T114 a relay is refused rather than opened on an unsafe configuration", async () => {
  const socket = scratchSocket();
  try {
    const open = (origin: string, headers: Record<string, string>, substitute?: { placeholder: string; secret: string }) =>
      InferenceRelay.open(socket.path, { origin, headers, substitute }, { concurrent: 1, timeoutMs: 1000 });
    await assert.rejects(() => InferenceRelay.open("relative/inference.sock",
      { origin: "https://example.com", headers: {} }, { concurrent: 1, timeoutMs: 1000 }),
      (error: unknown) => code(error) === "UNSUPPORTED_PROFILE");
    // Plain HTTP to a provider would put the credential on the wire in clear.
    await assert.rejects(() => open("http://example.com", {}), (error: unknown) => code(error) === "UNSUPPORTED_PROFILE");
    // A header value carrying CRLF would inject a second header downstream.
    await assert.rejects(() => open("https://example.com", { authorization: "a\r\nx-evil: 1" }),
      (error: unknown) => code(error) === "UNSUPPORTED_PROFILE");
    // A placeholder short enough to occur by accident would rewrite unrelated text.
    await assert.rejects(() => open("https://example.com", {}, { placeholder: "short", secret: "x".repeat(40) }),
      (error: unknown) => code(error) === "UNSUPPORTED_PROFILE");
  } finally { socket.clean(); }
});
