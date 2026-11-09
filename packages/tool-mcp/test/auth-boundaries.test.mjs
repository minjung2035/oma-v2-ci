import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Server } from "node:net";
import { createOAuthFetch } from "../dist/vendor/pi-mcp-adapter/runtime/mcp-auth-fetch.js";
import { createRequestHeadersCommandFetch } from "../dist/vendor/pi-mcp-adapter/runtime/request-headers-command.js";

async function redirects(t, targetStatus = 200) {
  const received = [];
  const initial = [];
  let status = 307;
  const target = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received.push({ headers: request.headers, body: Buffer.concat(chunks).toString() });
    response.statusCode = targetStatus;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ access_token: "test-token", token_type: "Bearer" }));
  });
  const source = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    initial.push({ headers: request.headers, body: Buffer.concat(chunks).toString() });
    response.writeHead(status, { location: `http://127.0.0.1:${target.address().port}/token` }).end();
  });
  t.after(async () => {
    await Promise.all([source, target].map(server => new Promise(resolve => {
      server.closeAllConnections(); server.close(resolve);
    })));
  });
  await Promise.all([source, target].map(server => new Promise((resolve, reject) => {
    server.once("error", reject); server.listen(0, "127.0.0.1", resolve);
  })));
  return { received, initial, url: `http://127.0.0.1:${source.address().port}/token`,
    reset(nextStatus) { status = nextStatus; received.length = 0; initial.length = 0; } };
}

test("001. OAuth token forms cannot forward secrets through a 307 or 308 redirect", async t => {
  const endpoint = await redirects(t);
  // The normal OAuth path has no configured service headers. These are the
  // three form bodies sent by the SDK through the adapter's fetch wrapper.
  const bodies = [
    { grant_type: "refresh_token", refresh_token: "refresh-secret" },
    { grant_type: "client_credentials", client_id: "test-client", client_secret: "client-secret" },
    { grant_type: "authorization_code", code: "code-secret", code_verifier: "verifier-secret" },
  ];
  const fetchAuth = createOAuthFetch(endpoint.url);
  for (const status of [307, 308]) for (const body of bodies) {
    await t.test(`${status}: ${body.grant_type}`, async () => {
      endpoint.reset(status);
      await assert.rejects(() => fetchAuth(endpoint.url, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body),
      }), /fetch|redirect|OAuth HTTP request failed/i);
      assert.equal(endpoint.initial.length, 1);
      assert.equal(endpoint.initial[0].body, new URLSearchParams(body).toString());
      assert.deepEqual(endpoint.received, [], "a redirected origin must receive neither credentials nor token parameters");
    });
  }
});

test("002. Per-request credential commands cannot forward their headers on redirects", async t => {
  const endpoint = await redirects(t);
  const commandFetch = createRequestHeadersCommandFetch({
    command: process.execPath,
    args: ["-e", 'process.stdin.resume(); process.stdin.on("end", () => process.stdout.write(JSON.stringify({"X-Command-Credential":"command-secret"})));'],
  });
  for (const status of [307, 308]) await t.test(String(status), async () => {
    endpoint.reset(status);
    await assert.rejects(() => commandFetch(endpoint.url), /fetch|redirect/i);
    assert.equal(endpoint.initial.length, 1);
    assert.equal(endpoint.initial[0].headers["x-command-credential"], "command-secret");
    assert.deepEqual(endpoint.received, []);
  });
});

test("003. Malformed callback request targets and Host headers cannot escape the HTTP handler", async t => {
  const bound = [];
  const original = Server.prototype.listen;
  Server.prototype.listen = function (...args) { bound.push(this); return Reflect.apply(original, this, args); };
  t.after(() => { Server.prototype.listen = original; });
  const callback = await import("../dist/vendor/pi-mcp-adapter/runtime/mcp-callback-server.js");
  t.after(() => callback.stopCallbackServer());
  await callback.ensureCallbackServer({ strictPort: false });
  const server = bound.find(candidate => candidate.listening);
  assert.ok(server);
  const invoke = (url, host) => {
    const response = { status: undefined, body: undefined,
      writeHead(status) { this.status = status; return this; },
      end(body) { this.body = body; } };
    assert.doesNotThrow(() => server.emit("request", { url, headers: { host } }, response));
    return response;
  };
  for (const [url, host] of [["/callback", "[invalid"], ["http://[invalid", "127.0.0.1"]])
    assert.equal(invoke(url, host).status, 400);
  const completion = callback.waitForCallback("test-callback-state");
  assert.equal(invoke("/callback?state=test-callback-state&code=test-code", "127.0.0.1").status, 200);
  assert.deepEqual(await completion, { code: "test-code" });
});

test("004. Explicit non-OAuth server credentials cannot follow redirects through either HTTP transport", async t => {
  const endpoint = await redirects(t, 503);
  const { McpServerManager } = await import("../dist/vendor/pi-mcp-adapter/runtime/server-manager.js");
  const definitions = [
    ["auth false", { auth: false }],
    ["oauth false", { oauth: false }],
    ["bearer", { auth: "bearer", bearerToken: "bearer-secret" }],
  ];
  for (const httpTransport of ["streamable-http", "sse"]) {
    for (const status of [307, 308]) for (const [label, definition] of definitions) {
      await t.test(`${httpTransport}: ${status}: ${label}`, async () => {
        endpoint.reset(status);
        const manager = new McpServerManager();
        try {
          // The target's 503 makes both old and fixed clients finish without
          // a handshake timeout. The regression is whether secrets reached it.
          await assert.rejects(() => manager.connect("redirect-test", {
            ...definition, url: endpoint.url, httpTransport,
            headers: { "X-Service-Credential": "service-secret" },
          }, AbortSignal.timeout(5000)));
          const credentialed = endpoint.initial.filter(request => request.headers["x-service-credential"] !== undefined);
          assert.equal(credentialed.length, 1);
          assert.equal(credentialed[0].headers["x-service-credential"], "service-secret");
          assert.equal(credentialed[0].headers.authorization, definition.auth === "bearer" ? "Bearer bearer-secret" : undefined);
          // A blocked connection triggers an unauthenticated server/discover
          // diagnostic probe. That metadata request may follow the redirect;
          // neither configured credentials nor the MCP handshake may do so.
          for (const request of endpoint.received) {
            assert.equal(request.headers["x-service-credential"], undefined);
            assert.equal(request.headers.authorization, undefined);
            assert.deepEqual(JSON.parse(request.body), {
              jsonrpc: "2.0", id: 1, method: "server/discover", params: {},
            });
          }
        } finally { await manager.closeAll(); }
      });
    }
  }
});
