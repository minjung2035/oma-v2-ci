import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("001. Firecrawl redacts credentials before truncating errors and handles invalid JSON safely", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-firecrawl-redaction-"));
  const saved = new Map(["PI_CODING_AGENT_DIR", "FIRECRAWL_BASE_URL", "FIRECRAWL_API_KEY"].map(name => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  process.env.PI_CODING_AGENT_DIR = root;
  process.env.FIRECRAWL_BASE_URL = "https://firecrawl.example.org";
  process.env.FIRECRAWL_API_KEY = "fake-audit-secret-key";
  writeFileSync(join(root, "web-search.json"), "{}");
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    rmSync(root, { recursive: true, force: true });
  });
  const { searchWithFirecrawl } = await import("../dist/vendor/pi-web-access/runtime/firecrawl.js");
  const lookup = async () => [{ address: "93.184.216.34", family: 4 }];
  for (const [label, response] of [
    ["truncation", new Response("x".repeat(292) + process.env.FIRECRAWL_API_KEY, { status: 500 })],
    ["invalid JSON", new Response(process.env.FIRECRAWL_API_KEY)],
  ]) {
    await t.test(label, async () => {
      globalThis.fetch = async () => response;
      await assert.rejects(() => searchWithFirecrawl("query", { lookup }), error => {
        assert.match(error.message, /Firecrawl/);
        assert.ok(!error.message.includes("fake-aud"), `${label} exposed a credential fragment`);
        return true;
      });
    });
  }
});
