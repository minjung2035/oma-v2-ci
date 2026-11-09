import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const loadRuntime = {
  "brave.js": () => import("../dist/vendor/pi-web-access/runtime/brave.js"),
  "exa.js": () => import("../dist/vendor/pi-web-access/runtime/exa.js"),
  "perplexity.js": () => import("../dist/vendor/pi-web-access/runtime/perplexity.js"),
  "firecrawl.js": () => import("../dist/vendor/pi-web-access/runtime/firecrawl.js"),
  "extract.js": () => import("../dist/vendor/pi-web-access/runtime/extract.js"),
  "github-extract.js": () => import("../dist/vendor/pi-web-access/runtime/github-extract.js"),
  "github-issue-pr.js": () => import("../dist/vendor/pi-web-access/runtime/github-issue-pr.js"),
};

test("001. Invalid web config errors do not echo credential fragments", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-config-redaction-"));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  writeFileSync(join(root, "web-search.json"), "secret-marker-for-audit");
  t.after(() => {
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousDir;
    rmSync(root, { recursive: true, force: true });
  });
  const probes = [
    ["brave.js", "isBraveAvailable"],
    ["exa.js", "hasExaApiKey"],
    ["perplexity.js", "isPerplexityAvailable"],
    ["firecrawl.js", "isFirecrawlAvailable"],
    ["extract.js", "resolveFetchTimeoutMs"],
    ["github-extract.js", "extractGitHub", "https://github.com/example/project"],
    ["github-issue-pr.js", "extractGitHubIssuePr", "https://github.com/example/project/issues/1"],
  ];
  for (const [file, name, arg] of probes) {
    await t.test(file, async () => {
      const module = await loadRuntime[file]();
      await assert.rejects(async () => module[name](arg), error => {
        assert.match(error.message, /Failed to parse/);
        assert.ok(!error.message.includes("secret-mar"), `${file} echoed a credential fragment`);
        return true;
      });
    });
  }
});
