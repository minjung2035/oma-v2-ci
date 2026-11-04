import test from "node:test";
import assert from "node:assert/strict";
import { constants } from "node:buffer";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLocalTestSummary } from "../scripts/local-test-summary.mjs";
import { unrunDirectives, unrunTests } from "../scripts/verification-lanes.mjs";

const healthy = "TAP version 13\nok 1 - exercised oracle\n1..1\n# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n";
async function withSummary(body) {
  const root = mkdtempSync(join(tmpdir(), "oma-summary-regression-"));
  try { await body(join(root, "raw.tap")); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test("001. Local summary: complete, absent and nonzero counts preserve the original unrun oracle", async () => {
  await withSummary(async path => {
    for (const raw of [healthy, healthy.replaceAll("\n", "\r\n"), "", "# skipped 0\n", healthy.replace("# skipped 0", "# skipped 3"),
      healthy.replace("# todo 0", "# todo 2"), healthy.replace("# cancelled 0", "# cancelled 1"),
      healthy.trimEnd(), healthy.replace("ok 1 - exercised oracle", "ok 1 - # skipped 99 inside a name")]) {
      writeFileSync(path, raw);
      const summary = await readLocalTestSummary(path);
      assert.deepEqual(summary.unrun, unrunTests(raw));
      assert.deepEqual(summary.directives, unrunDirectives(raw));
      assert.equal(summary.omittedDirectives, 0);
    }
    await assert.rejects(readLocalTestSummary(`${path}.absent`), { code: "ENOENT" });
  });
});

test("002. Local summary: directives beyond previews and across chunk edges cannot disappear or become false SKIPs", async () => {
  await withSummary(async path => {
    for (const token of [" # SKIP", " # TODO"]) {
      // The token ends exactly at the first UTF-8 chunk edge. It is not a
      // directive if a word character follows, even in the next chunk.
      const prefix = "ok 1 - ";
      const line = prefix + "x".repeat(65536 - prefix.length - token.length) + token;
      writeFileSync(path, line + "PER is a name\n" + healthy);
      assert.deepEqual((await readLocalTestSummary(path)).unrun, []);
      writeFileSync(path, line + " unavailable\n" + healthy);
      const seen = await readLocalTestSummary(path);
      assert.deepEqual(seen.unrun, ["unrun directives: 1"], "a zero summary cannot hide a directive");
      assert.equal(seen.directives.length, 1);
      assert.match(seen.directives[0], /\[truncated; raw line \d+ characters\]$/);
      // Split inside the directive and inside a multi-byte test name too.
      writeFileSync(path, "x".repeat(65534) + "한글" + token + " unavailable\n" + healthy);
      assert.deepEqual((await readLocalTestSummary(path)).unrun, ["unrun directives: 1"]);
      writeFileSync(path, "x".repeat(65532) + token + " unavailable\n" + healthy);
      assert.deepEqual((await readLocalTestSummary(path)).unrun, ["unrun directives: 1"]);
    }
  });
});

test("003. Local summary: diagnostic previews are bounded but every unrun directive is counted and raw bytes stay intact", async () => {
  await withSummary(async path => {
    const raw = Array.from({ length: 205 }, (_, index) => `ok ${index + 1} - case ${index} # TODO not executed`).join("\n") + "\n" + healthy;
    writeFileSync(path, raw);
    const before = statSync(path);
    const summary = await readLocalTestSummary(path);
    assert.deepEqual(summary.unrun, ["unrun directives: 205"]);
    assert.equal(summary.directives.length, 200);
    assert.equal(summary.omittedDirectives, 5);
    assert.match(summary.directives[199], /case 199 # TODO/);
    assert.equal(statSync(path).size, Buffer.byteLength(raw));
    assert.equal(statSync(path).mtimeMs, before.mtimeMs);
    assert.equal(readFileSync(path, "utf8"), raw, "the reporting projection cannot replace or rewrite raw evidence");
  });
});

test("004. Local summary: a raw line larger than the V8 string limit is scanned under a 32 MiB heap, without a false PASS", { timeout: 30000 }, async () => {
  await withSummary(async path => {
    // A sparse diagnostic body exercises the real file/string size boundary
    // without allocating half a GiB of fixture storage. This is a scanner
    // stress fixture, not a claim that NUL-filled diagnostics are valid TAP.
    const offset = constants.MAX_STRING_LENGTH + 1024;
    const fd = openSync(path, "wx");
    try {
      writeSync(fd, Buffer.from("# diagnostic: "), 0, 14, 0);
      const ending = Buffer.from(" # SKIP unavailable\n" + healthy);
      writeSync(fd, ending, 0, ending.length, offset);
    } finally { closeSync(fd); }
    assert.ok(statSync(path).size > constants.MAX_STRING_LENGTH);
    const helper = new URL("../scripts/local-test-summary.mjs", import.meta.url).href;
    const source = `import assert from 'node:assert/strict';
      import { readFileSync } from 'node:fs';
      import { readLocalTestSummary } from ${JSON.stringify(helper)};
      const path = process.argv[1];
      assert.throws(() => readFileSync(path, 'utf8'), /Cannot create a string longer/);
      const summary = await readLocalTestSummary(path);
      assert.deepEqual(summary.unrun, ['unrun directives: 1']);
      assert.equal(summary.directives.length, 1);
      assert.match(summary.directives[0], /truncated; raw line/);
      assert.equal(summary.omittedDirectives, 0);`;
    const before = statSync(path);
    const child = spawnSync(process.execPath, ["--max-old-space-size=32", "--input-type=module", "-e", source, path],
      { encoding: "utf8", timeout: 25000, maxBuffer: 65536 });
    assert.equal(child.error, undefined);
    assert.equal(child.signal, null, child.stderr);
    assert.equal(child.status, 0, child.stderr);
    assert.equal(statSync(path).size, before.size);
    assert.equal(statSync(path).mtimeMs, before.mtimeMs);
  });
});
