import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const lookup = async () => [{ address: "93.184.216.34", family: 4 }];
function streamingResponse(init, cancelled, cancelResult) {
  return new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode("body still arriving")); },
    cancel() { cancelled.push(true); return cancelResult?.(); },
  }), init);
}

test("001. HTTP extraction cancels unread bodies on every early refusal", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-fetch-cleanup-"));
  const previousDir = process.env.PI_CODING_AGENT_DIR, originalFetch = globalThis.fetch;
  process.env.PI_CODING_AGENT_DIR = root;
  writeFileSync(join(root, "web-search.json"), JSON.stringify({ fetchRouting: { providers: ["http"] }, pdf: { enabled: false }, image: { enabled: false } }));
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousDir;
    rmSync(root, { recursive: true, force: true });
  });
  const { extractContent } = await import("../dist/vendor/pi-web-access/runtime/extract.js");
  for (const [label, init, options] of [
    ["HTTP error", { status: 403 }, {}],
    ["disabled PDF", { headers: { "content-type": "application/pdf" } }, {}],
    ["declared size", { headers: { "content-type": "text/plain", "content-length": "9000000" } }, { mode: "raw" }],
    ["raw binary", { headers: { "content-type": "application/octet-stream" } }, { mode: "raw" }],
    ["disabled image", { headers: { "content-type": "image/png" } }, {}],
    ["unsupported type", { headers: { "content-type": "audio/mpeg" } }, {}],
  ]) {
    await t.test(label, async () => {
      const cancelled = [];
      globalThis.fetch = async () => streamingResponse(init, cancelled);
      const result = await extractContent("https://example.org/resource", undefined, { lookup, ...options });
      assert.ok(result.error);
      assert.equal(cancelled.length, 1, `${label} retained an unread response body`);
    });
  }
  for (const [label, cancelResult] of [["pending", () => new Promise(() => {})], ["rejected", () => Promise.reject(new Error("cleanup failure"))]]) {
    await t.test(`${label} cancellation preserves the HTTP refusal`, { timeout: 1000 }, async () => {
      const cancelled = [];
      globalThis.fetch = async () => streamingResponse({ status: 403 }, cancelled, cancelResult);
      const result = await extractContent("https://example.org/resource", undefined, { lookup });
      assert.match(result.error, /HTTP 403/);
      assert.equal(cancelled.length, 1);
    });
  }
});

test("003. GitHub REST refusals cancel unread bodies", async () => {
  const originalFetch = globalThis.fetch;
  const { extractGitHubIssuePr } = await import("../dist/vendor/pi-web-access/runtime/github-issue-pr.js");
  const cancelled = [];
  globalThis.fetch = async () => streamingResponse({ status: 403, headers: { "x-ratelimit-remaining": "0" } }, cancelled);
  try {
    const result = await extractGitHubIssuePr("https://github.com/example/project/issues/1", undefined, { lookup });
    assert.match(result.error, /rate limit/);
    assert.equal(cancelled.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("002. Following or rejecting a redirect cancels its abandoned response", async t => {
  const { fetchRemoteUrl } = await import("../dist/vendor/pi-web-access/runtime/ssrf-protection.js");
  for (const [label, location, maximum] of [["follow", "/next", 5], ["blocked target", "http://127.0.0.1/private", 5], ["redirect bound", "/next", 0]]) {
    await t.test(label, async () => {
      const cancelled = [];
      let calls = 0;
      const result = fetchRemoteUrl("https://example.org/start", {}, { lookup, maxRedirects: maximum,
        fetch: async () => ++calls === 1 ? streamingResponse({ status: 302, headers: { location } }, cancelled) : new Response("done") });
      if (label === "follow") assert.equal(await (await result).text(), "done");
      else await assert.rejects(result);
      assert.equal(cancelled.length, 1, `${label} retained the redirect body`);
    });
  }
});

test("004. Credential redirects release every abandoned response without waiting for cleanup", async t => {
  const { fetchWithCredentialRedirects } = await import("../dist/vendor/pi-web-access/runtime/utils.js");
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  for (const [label, location, error] of [
    ["follow", "/next", undefined],
    ["unsupported protocol", "file:///tmp/private", /must use HTTP\(S\)/],
    ["invalid location", "http://[", /Invalid URL/],
    ["redirect bound", "/next", /Too many API redirects/],
  ]) {
    await t.test(label, { timeout: 1000 }, async () => {
      const cancelled = [];
      const finalCancelled = [];
      let calls = 0;
      globalThis.fetch = async () => ++calls === 1 || label === "redirect bound"
        ? streamingResponse({ status: 307, headers: { location } }, cancelled)
        : streamingResponse({ status: 200 }, finalCancelled);
      const result = fetchWithCredentialRedirects("https://example.org/start", {
        method: "POST", headers: { "x-api-key": "secret" }, body: "query",
      }, ["x-api-key"]);
      if (error) await assert.rejects(result, error);
      else {
        const response = await result;
        assert.equal(response.status, 200);
        assert.equal(finalCancelled.length, 0, "the caller still owns the final response");
        await response.body.cancel();
      }
      assert.equal(cancelled.length, label === "redirect bound" ? 6 : 1,
        `${label} retained an unread redirect body`);
    });
  }
  for (const [label, cancelResult] of [
    ["pending", () => new Promise(() => {})],
    ["rejected", () => Promise.reject(new Error("cleanup failure"))],
  ]) {
    await t.test(`${label} cancellation preserves the final result`, { timeout: 1000 }, async () => {
      const cancelled = [];
      let calls = 0;
      globalThis.fetch = async () => ++calls === 1
        ? streamingResponse({ status: 302, headers: { location: "/next" } }, cancelled, cancelResult)
        : new Response("complete");
      const response = await fetchWithCredentialRedirects("https://example.org/start", {}, ["x-api-key"]);
      assert.equal(await response.text(), "complete");
      assert.equal(cancelled.length, 1);
    });
  }
});
