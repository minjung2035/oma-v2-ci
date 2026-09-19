/** INF-005/006/007: the relay a confined Resident reaches a provider through.
 *
 * These run real sockets against a real TLS server standing in for a provider.
 * Nothing is stubbed: a pass means bytes crossed a unix socket, gained the
 * host's credential, and came back streamed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer as createTlsServer } from "node:tls";
import { request as httpRequest } from "node:http";
import { connect as netConnect, createServer as createNetServer, type Server } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { X509Certificate, generateKeyPairSync } from "node:crypto";
import { InferenceRelay } from "../src/runtime/inference-relay.js";

/** A throwaway TLS server that records what a provider would have received. */
interface Provider {
  readonly origin: string;
  readonly seen: { authorization: string | undefined; path: string | undefined; body: string; headers: Record<string, unknown> }[];
  close(): Promise<void>;
  reply: { status: number; chunks: string[]; delayMs: number };
}

async function fakeProvider(): Promise<Provider> {
  // A self-signed certificate, generated here so no fixture key is committed.
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  void publicKey; void X509Certificate;
  const selfSigned = await import("node:child_process");
  const dir = mkdtempSync(join(tmpdir(), "oma-relay-cert-"));
  const keyPath = join(dir, "key.pem");
  const certPath = join(dir, "cert.pem");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }));
  selfSigned.execFileSync("openssl", ["req", "-new", "-x509", "-key", keyPath,
    "-out", certPath, "-days", "1", "-subj", "/CN=localhost",
    "-addext", "subjectAltName=DNS:localhost"], { stdio: "ignore" });
  const { readFileSync } = await import("node:fs");
  const seen: Provider["seen"] = [];
  const state = { reply: { status: 200, chunks: ["a", "b"], delayMs: 0 } };
  const server = createTlsServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) });
  // A minimal HTTP/1.1 responder: the relay must not depend on anything richer.
  server.on("secureConnection", socket => {
    let buffer = "";
    socket.on("data", chunk => {
      buffer += String(chunk);
      const end = buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      const head = buffer.slice(0, end).split("\r\n");
      const headers: Record<string, unknown> = {};
      for (const line of head.slice(1)) {
        const at = line.indexOf(":");
        if (at > 0) headers[line.slice(0, at).toLowerCase().trim()] = line.slice(at + 1).trim();
      }
      const record = {
        path: head[0]!.split(" ")[1],
        authorization: headers.authorization as string | undefined,
        body: buffer.slice(end + 4),
        headers,
      };
      if (seen.some(entry => entry === record)) return;
      seen.push(record);
      buffer = "";
      const send = (): void => {
        const body = state.reply.chunks.join("");
        socket.write(`HTTP/1.1 ${state.reply.status} OK\r\ncontent-type: text/event-stream\r\ncontent-length: ${Buffer.byteLength(body)}\r\nconnection: close\r\n\r\n`);
        for (const piece of state.reply.chunks) socket.write(piece);
        socket.end();
      };
      if (state.reply.delayMs > 0) setTimeout(send, state.reply.delayMs).unref();
      else send();
    });
    socket.on("error", () => {});
  });
  await new Promise<void>(resolve => { server.listen(0, "127.0.0.1", () => { resolve(); }); });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    origin: `https://localhost:${port}`,
    seen,
    get reply() { return state.reply; },
    set reply(value) { state.reply = value; },
    close: () => new Promise<void>(resolve => {
      server.close(() => { rmSync(dir, { recursive: true, force: true }); resolve(); });
    }),
  } as Provider;
}

/** Speaks to the relay the way the sandbox bridge does: plain HTTP over a
 * loopback port that forwards, unread, into the relay's unix socket. */
async function throughBridge(
  socketPath: string, path: string, body: string, headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  const bridge: Server = createNetServer(client => {
    const upstream = netConnect(socketPath);
    const drop = (): void => { client.destroy(); upstream.destroy(); };
    client.on("error", drop); upstream.on("error", drop);
    client.pipe(upstream); upstream.pipe(client);
  });
  await new Promise<void>(resolve => { bridge.listen(0, "127.0.0.1", () => { resolve(); }); });
  const address = bridge.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    return await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const outgoing = httpRequest({
        host: "127.0.0.1", port, path, method: "POST",
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
  } finally {
    bridge.close();
  }
}

function scratchSocket(): { path: string; clean(): void } {
  const dir = mkdtempSync(join(tmpdir(), "oma-relay-"));
  return { path: join(dir, "inference.sock"), clean: () => { rmSync(dir, { recursive: true, force: true }); } };
}

// The fake provider is self-signed, so the relay's TLS client must be told to
// trust it for the duration of these tests. Nothing in production does this.
const previousTlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;

test("T114 the relay carries a request to the provider and attaches the host credential", async () => {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const provider = await fakeProvider();
  const socket = scratchSocket();
  const relay = await InferenceRelay.open(socket.path,
    { origin: provider.origin, headers: { authorization: "Bearer real-secret" } },
    { concurrent: 4, timeoutMs: 5000 });
  try {
    const answer = await throughBridge(socket.path, "/v1/messages", '{"hello":true}',
      // What the sandbox sends for authorization is a placeholder. It must not
      // reach the provider, and it must not be able to shadow the real one.
      { authorization: "Bearer placeholder-from-sandbox", "x-api-key": "also-fake" });
    assert.equal(answer.status, 200);
    assert.equal(answer.body, "ab", "the provider's bytes must arrive unchanged");
    assert.equal(provider.seen.length, 1);
    const request = provider.seen[0]!;
    assert.equal(request.path, "/v1/messages");
    assert.equal(request.authorization, "Bearer real-secret", "the host credential replaces the caller's");
    assert.equal(request.headers["x-api-key"], undefined, "a caller-supplied key must be dropped");
    assert.equal(request.body, '{"hello":true}', "the body is forwarded verbatim");
    // The relay counts what it carried without reading it.
    assert.deepEqual(relay.observe(), { accepted: 1, refused: 0, failed: 0, inFlight: 0 });
  } finally {
    await relay.close(); await provider.close(); socket.clean();
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTlsSetting ?? "1";
  }
});

test("T114 the relay refuses a path that leaves the declared provider endpoint", async () => {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const provider = await fakeProvider();
  const socket = scratchSocket();
  const relay = await InferenceRelay.open(socket.path,
    { origin: `${provider.origin}/v1`, headers: { authorization: "Bearer real-secret" } },
    { concurrent: 4, timeoutMs: 5000 });
  try {
    // The destination is the host's decision (INF-002). A request may extend
    // the declared path, never climb out of it.
    for (const path of ["/../admin", "/v1/..%2F..%2Fadmin", "//evil.example.com/v1"]) {
      const answer = await throughBridge(socket.path, path, "{}");
      assert.equal(answer.status, 403, `${path} must be refused`);
    }
    assert.equal(provider.seen.length, 0, "no refused request may reach the provider");
    const allowed = await throughBridge(socket.path, "/messages", "{}");
    assert.equal(allowed.status, 200);
    assert.equal(provider.seen[0]!.path, "/v1/messages", "the declared prefix is kept");
    assert.equal(relay.observe().refused, 3);
  } finally {
    await relay.close(); await provider.close(); socket.clean();
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTlsSetting ?? "1";
  }
});

test("T114 a provider that never answers is reported, not retried", async () => {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const provider = await fakeProvider();
  provider.reply = { status: 200, chunks: ["x"], delayMs: 3000 };
  const socket = scratchSocket();
  const relay = await InferenceRelay.open(socket.path,
    { origin: provider.origin, headers: { authorization: "Bearer real-secret" } },
    { concurrent: 4, timeoutMs: 250 });
  try {
    const answer = await throughBridge(socket.path, "/v1/messages", "{}");
    assert.equal(answer.status, 504);
    // INF-004: an unclear outcome is never resent by the relay on its own.
    assert.equal(provider.seen.length, 1, "the relay resent an abandoned request");
    assert.equal(relay.observe().failed, 1);
    assert.equal(relay.observe().inFlight, 0, "an abandoned request must be released");
  } finally {
    await relay.close(); await provider.close(); socket.clean();
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTlsSetting ?? "1";
  }
});

test("T114 the relay refuses beyond its concurrency limit instead of queueing", async () => {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const provider = await fakeProvider();
  provider.reply = { status: 200, chunks: ["x"], delayMs: 400 };
  const socket = scratchSocket();
  const relay = await InferenceRelay.open(socket.path,
    { origin: provider.origin, headers: { authorization: "Bearer real-secret" } },
    { concurrent: 1, timeoutMs: 5000 });
  try {
    const [first, second] = await Promise.all([
      throughBridge(socket.path, "/v1/messages", "{}"),
      // Started while the first is still in flight at the provider.
      new Promise<{ status: number; body: string }>(resolve => {
        setTimeout(() => { void throughBridge(socket.path, "/v1/messages", "{}").then(resolve); }, 80).unref();
      }),
    ]);
    const statuses = [first.status, second.status].sort();
    assert.deepEqual(statuses, [200, 503], `expected one carried and one refused, got ${statuses.join(",")}`);
    assert.equal(relay.observe().refused, 1);
  } finally {
    await relay.close(); await provider.close(); socket.clean();
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTlsSetting ?? "1";
  }
});

test("T114 a relay is refused rather than opened on an untrusted path or plain origin", async () => {
  const socket = scratchSocket();
  const code = (value: unknown): string | undefined => (value as { code?: string }).code;
  try {
    await assert.rejects(
      () => InferenceRelay.open("relative/inference.sock",
        { origin: "https://example.com", headers: {} }, { concurrent: 1, timeoutMs: 1000 }),
      (error: unknown) => code(error) === "UNSUPPORTED_PROFILE");
    // Plain HTTP to a provider would put the credential on the wire in clear.
    await assert.rejects(
      () => InferenceRelay.open(socket.path,
        { origin: "http://example.com", headers: {} }, { concurrent: 1, timeoutMs: 1000 }),
      (error: unknown) => code(error) === "UNSUPPORTED_PROFILE");
    // A header value carrying CRLF would inject a second header downstream.
    await assert.rejects(
      () => InferenceRelay.open(socket.path,
        { origin: "https://example.com", headers: { authorization: "a\r\nx-evil: 1" } },
        { concurrent: 1, timeoutMs: 1000 }),
      (error: unknown) => code(error) === "UNSUPPORTED_PROFILE");
  } finally { socket.clean(); }
});
