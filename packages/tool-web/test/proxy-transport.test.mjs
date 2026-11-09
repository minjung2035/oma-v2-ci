import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWithProxy } from "../dist/vendor/pi-web-access/runtime/utils.js";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oma-curl-boundary-"));
  const originalFetch = globalThis.fetch, path = process.env.PATH, noProxy = process.env.NO_PROXY;
  writeFileSync(join(root, "curl"), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const head = args.includes('--head');
fs.writeFileSync(args[args.indexOf('-D') + 1], 'HTTP/1.1 200 OK\\r\\nX-Method: ' + (head ? 'HEAD' : 'GET') + '\\r\\n\\r\\n');
fs.writeFileSync(args[args.indexOf('--output') + 1], head ? '' : 'partial');
process.stdout.write(JSON.stringify({ http_code: 200 }));
process.exit(args.at(-1).includes('/partial') ? 18 : 0);
`, { mode: 0o700 });
  process.env.PATH = root;
  process.env.NO_PROXY = "";
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (path === undefined) delete process.env.PATH; else process.env.PATH = path;
    if (noProxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = noProxy;
    rmSync(root, { recursive: true, force: true });
  });
  return (path, init) => runWithProxy("http://proxy.example:8080", () => fetch(`https://remote.example${path}`, init));
}

test("001. A failed curl transfer with HTTP status and metadata cannot return partial success", async t => {
  const request = fixture(t);
  await assert.rejects(request("/partial"), /curl exited with code 18/);
});

test("002. Proxy HEAD requests reach curl as HEAD and return no response body", async t => {
  const response = await fixture(t)("/healthy", { method: "HEAD" });
  assert.equal(response.headers.get("x-method"), "HEAD");
  assert.equal(response.body, null);
  assert.equal(await response.text(), "");
});
