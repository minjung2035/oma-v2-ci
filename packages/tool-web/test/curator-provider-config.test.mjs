import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("001. Curator provider selection persists over an existing searchProvider setting", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-curator-provider-")), configPath = join(root, "web-search.json");
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  writeFileSync(configPath, JSON.stringify({ searchProvider: "exa", braveApiKey: "fake-audit-key", webSearch: { allowedProviders: ["exa", "brave"] }, toolActivation: "eager", autoOpenBrowser: false }));
  const hooks = new Map();
  t.after(() => {
    for (const callback of hooks.get("session_shutdown") ?? []) callback();
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousDir;
    rmSync(root, { recursive: true, force: true });
  });
  let requestHandler;
  const server = new EventEmitter();
  server.listen = (_port, _host, callback) => { callback(); return server; };
  server.address = () => ({ port: 12345 });
  server.close = () => server;
  t.mock.method(http, "createServer", handler => { requestHandler = handler; return server; });
  const commands = new Map();
  const { default: register } = await import("../dist/vendor/pi-web-access/runtime/index.js");
  register({ registerTool() {}, registerShortcut() {}, registerCommand: (name, command) => commands.set(name, command), on: (event, callback) => hooks.set(event, [...hooks.get(event) ?? [], callback]), appendEntry() {}, sendMessage() {} });
  // Use the public curator URL to obtain the token a browser would send.
  let curatorUrl;
  const ctx = { scopedModels: [], modelRegistry: { getAvailable: () => [], find: () => undefined }, ui: { notify(message) { curatorUrl = message.match(/http:\/\/\S+/)?.[0] ?? curatorUrl; } } };
  await commands.get("websearch").handler("", ctx);
  const token = new URL(curatorUrl).searchParams.get("session");
  const req = new PassThrough();
  req.method = "POST"; req.url = "/provider"; req.headers = { host: "localhost" };
  const response = { status: undefined, body: "", writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
  const handling = requestHandler(req, response);
  req.end(JSON.stringify({ token, provider: "brave" }));
  await handling;
  assert.equal(response.status, 200, response.body);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(JSON.parse(readFileSync(configPath, "utf8")).searchProvider, "brave");
});
