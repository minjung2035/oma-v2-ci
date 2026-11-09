import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("001. Gemini credentials remain on same-origin redirects and leave cross-origin requests", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-gemini-redirect-"));
  const previous = { base: process.env.GOOGLE_GEMINI_BASE_URL, agent: process.env.PI_CODING_AGENT_DIR };
  const target = createServer((request, response) => response.end(JSON.stringify({ key: request.headers["x-goog-api-key"] ?? null })));
  const source = createServer((request, response) => {
    if (request.url === "/same") response.writeHead(302, { location: "/ok" }).end();
    else if (request.url === "/other") response.writeHead(302, { location: `http://127.0.0.1:${target.address().port}/ok` }).end();
    else response.end(JSON.stringify({ key: request.headers["x-goog-api-key"] ?? null }));
  });
  t.after(async () => {
    for (const [key, value] of [["GOOGLE_GEMINI_BASE_URL", previous.base], ["PI_CODING_AGENT_DIR", previous.agent]])
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    await Promise.all([source, target].map(server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })));
    rmSync(root, { recursive: true, force: true });
  });
  await Promise.all([source, target].map(server => new Promise(resolve => server.listen(0, "127.0.0.1", resolve))));
  const base = `http://127.0.0.1:${source.address().port}`;
  process.env.GOOGLE_GEMINI_BASE_URL = base;
  process.env.PI_CODING_AGENT_DIR = root;
  const { fetchGeminiApi } = await import("../dist/vendor/pi-web-access/runtime/gemini-api.js");
  assert.deepEqual(await (await fetchGeminiApi(`${base}/same`, {}, "test-key")).json(), { key: "test-key" });
  assert.deepEqual(await (await fetchGeminiApi(`${base}/other`, {}, "test-key")).json(), { key: null });
});
