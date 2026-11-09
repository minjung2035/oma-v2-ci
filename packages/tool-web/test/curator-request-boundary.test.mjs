import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

test("001. Curator HTTP requests preserve UTF-8, reject primitive JSON, and accept configured SerpApi", async t => {
  let requestHandler;
  const server = new EventEmitter();
  server.listen = (_port, _host, callback) => { callback(); return server; };
  server.address = () => ({ port: 12345 });
  server.close = () => server;
  t.mock.method(http, "createServer", handler => { requestHandler = handler; return server; });
  const { startCuratorServer } = await import("../dist/vendor/pi-web-access/runtime/curator-server.js");
  const received = [];
  const handle = await startCuratorServer({ queries: [], sessionToken: "fixture-token", timeout: 60, availableProviders: { brave: true, serpapi: true }, defaultProvider: "brave", summaryModels: [] }, {
    onCancel() {}, onAddSearchResults() {}, onProviderChange() {},
    async onAddSearch(query, provider) { received.push({ query, provider }); return [{ answer: "answer", results: [], provider }]; },
  });
  t.after(() => handle.close());
  async function request(path, chunks) {
    const req = new PassThrough();
    req.method = "POST"; req.url = path; req.headers = { host: "127.0.0.1" };
    const response = { status: undefined, ended: false, body: "", writeHead(status) { this.status = status; }, end(body) { this.ended = true; this.body = body; } };
    const handling = requestHandler(req, response);
    for (const chunk of chunks) req.write(chunk);
    req.end();
    await handling;
    return response;
  }
  await t.test("split UTF-8 search query", async () => {
    const query = "한국어 검색";
    const body = Buffer.from(JSON.stringify({ token: "fixture-token", provider: "brave", query }));
    const split = body.indexOf(Buffer.from("한")) + 1;
    const response = await request("/search", [body.subarray(0, split), body.subarray(split)]);
    assert.equal(response.status, 200);
    assert.equal(received.at(-1).query, query);
  });
  await t.test("primitive JSON receives an error response", async () => {
    for (const body of ["null", "false", "0", '""']) {
      const response = await request("/heartbeat", [Buffer.from(body)]);
      assert.equal(response.ended, true, `${body} left the HTTP request hanging`);
      assert.equal(response.status, 400);
    }
  });
  await t.test("SerpApi is available through the same curator route as its button", async () => {
    const response = await request("/search", [Buffer.from(JSON.stringify({ token: "fixture-token", provider: "serpapi", query: "query" }))]);
    assert.equal(response.status, 200, response.body);
    assert.equal(received.at(-1).provider, "serpapi");
  });
});
