import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const providerModules = {
  parallel: () => import("../dist/vendor/pi-web-access/runtime/parallel.js"),
  serper: () => import("../dist/vendor/pi-web-access/runtime/serper.js"),
  tinyfish: () => import("../dist/vendor/pi-web-access/runtime/tinyfish.js"),
  valyu: () => import("../dist/vendor/pi-web-access/runtime/valyu.js"),
  "xai-search": () => import("../dist/vendor/pi-web-access/runtime/xai-search.js"),
  "kimi-search": () => import("../dist/vendor/pi-web-access/runtime/kimi-search.js"),
};

test("001. Provider credentials stay on same-origin redirects and leave cross-origin requests", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-provider-redirect-"));
  const originalFetch = globalThis.fetch;
  const saved = new Map();
  for (const name of ["PI_CODING_AGENT_DIR", "PARALLEL_API_KEY", "SERPER_API_KEY", "TINYFISH_API_KEY", "VALYU_API_KEY"])
    saved.set(name, process.env[name]);
  process.env.PI_CODING_AGENT_DIR = root;
  for (const name of [...saved.keys()].slice(1)) process.env[name] = "provider-test-secret";
  const received = [];
  const first = [];
  let crossOrigin = false;
  const complete = (request, response) => {
    received.push(request.headers);
    request.resume();
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ success: true, results: [], organic: [],
      search_results: [{ url: "https://example.com/probe", title: "Redirect probe", snippet: "complete" }],
      output: [{ type: "message", content: [{ type: "output_text", text: "Redirect probe complete." }] }] }));
  };
  const target = createServer(complete);
  const source = createServer((request, response) => {
    if (request.url === "/oma-redirect-end") return complete(request, response);
    first.push(request.headers);
    request.resume();
    response.writeHead(307, { location: crossOrigin
      ? `http://127.0.0.1:${target.address().port}/oma-redirect-end` : "/oma-redirect-end" }).end();
  });
  t.after(async () => {
    globalThis.fetch = originalFetch;
    for (const [name, value] of saved)
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    await Promise.all([source, target].map(server => new Promise(resolve => {
      server.closeAllConnections(); server.close(resolve);
    })));
    rmSync(root, { recursive: true, force: true });
  });
  await Promise.all([source, target].map(server => new Promise(resolve => server.listen(0, "127.0.0.1", resolve))));
  // Route each fixed provider endpoint into a real local redirect server.
  // Native fetch still owns actual redirect behavior; no response is mocked.
  globalThis.fetch = (input, init) => {
    const url = new URL(input);
    return originalFetch(url.hostname === "127.0.0.1" ? url
      : `http://127.0.0.1:${source.address().port}${url.pathname === "/oma-redirect-end" ? url.pathname : "/start"}`, init);
  };
  const registry = {
    find: () => ({ provider: "xai", id: "test-model" }),
    getAll: () => [{ provider: "kimi-coding", id: "test-model" }],
    getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "provider-test-secret", headers: { "X-Custom-Credential": "registry-secret" } }),
  };
  const cases = [
    ["parallel", "searchWithParallel", "x-api-key", "provider-test-secret"],
    ["serper", "searchWithSerper", "x-api-key", "provider-test-secret"],
    ["tinyfish", "searchWithTinyFish", "x-api-key", "provider-test-secret"],
    ["valyu", "searchWithValyu", "x-api-key", "provider-test-secret"],
    ["xai-search", "searchWithXai", "x-custom-credential", "registry-secret"],
    ["kimi-search", "searchWithKimi", "x-custom-credential", "registry-secret"],
  ];
  for (const [module, operation, header, secret] of cases) {
    const provider = await providerModules[module]();
    for (const cross of [false, true]) await t.test(`${module}: ${cross ? "cross" : "same"} origin`, async () => {
      crossOrigin = cross; received.length = 0; first.length = 0;
      await provider[operation]("redirect probe", {}, { modelRegistry: registry });
      assert.equal(first.length, 1);
      assert.equal(first[0][header], secret);
      assert.equal(received.length, 1);
      assert.equal(received[0][header], cross ? undefined : secret);
      if (module === "xai-search" || module === "kimi-search")
        assert.equal(received[0].authorization, cross ? undefined : "Bearer provider-test-secret");
    });
  }
});
