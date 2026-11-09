import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { streamSearch } from "@oma/tool-runtime/contained-search";

for (const filename of ["mail-123-456-abc.md", "mail:123:456:.md", "한글-123-456-😀.md", "mail\n123-456.md"]) {
  for (const context of [0, 1]) test(`001. Search header: exact filename ${filename} and context ${context}, never digits from the path or payload`, async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-search-header-")), cwd = process.cwd();
    try {
      writeFileSync(join(root, filename), "before\nneedle :123: payload -456- 한글😀\nafter\n");
      process.chdir(root);
      const chunks: Buffer[] = [];
      const result = await streamSearch({ name: "grep", root, params: { path: filename, pattern: "needle", context }, heartbeat: 100 },
        filename, new AbortController().signal, bytes => chunks.push(Buffer.from(bytes)));
      assert.deepEqual(result, { complete: true, limitReached: false });
      assert.equal(Buffer.concat(chunks).toString("utf8"), context === 0
        ? `${filename}:2: needle :123: payload -456- 한글😀\n`
        : `${filename}-1- before\n${filename}:2: needle :123: payload -456- 한글😀\n${filename}-3- after\n`);
    } finally { process.chdir(cwd); rmSync(root, { recursive: true, force: true }); }
  });
}

test("002. Find preserves split UTF-8 path records and counts newline-containing filenames once", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-find-records-")), cwd = process.cwd(), oldPath = process.env.PATH;
  try {
    mkdirSync(join(root, "nested"));
    // Deliberately split a directory prefix and a multibyte character across
    // writes. Pipe chunks are byte transport, never filename boundaries.
    writeFileSync(join(root, "fd"), `#!${process.execPath}
const zero = process.argv.includes('--print0');
const bytes = Buffer.from('nested/한글\\nname.txt' + (zero ? '\\0' : '\\n') + 'nested/second.txt' + (zero ? '\\0' : '\\n'));
(async () => {
for (const [start, end] of [[0, 3], [3, 8], [8, bytes.length]]) {
  process.stdout.write(bytes.subarray(start, end));
  await new Promise(resolve => setTimeout(resolve, 20));
}
})();
`, { mode: 0o700 });
    process.env.PATH = root;
    process.chdir(root);
    const chunks: Buffer[] = [];
    const result = await streamSearch({ name: "find", root, params: { pattern: "*", limit: 2 }, heartbeat: 100 },
      "nested", new AbortController().signal, bytes => chunks.push(Buffer.from(bytes)));
    assert.equal(Buffer.concat(chunks).toString("utf8"), "한글\nname.txt\nsecond.txt\n");
    assert.deepEqual(result, { complete: true, limitReached: true });
  } finally {
    process.chdir(cwd);
    if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
    rmSync(root, { recursive: true, force: true });
  }
});

test("003. Find reports a failed walker instead of a successful empty search", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-find-failure-")), cwd = process.cwd(), oldPath = process.env.PATH;
  try {
    writeFileSync(join(root, "fd"), `#!${process.execPath}\nprocess.stderr.write('invalid glob'); process.exitCode = 1;\n`, { mode: 0o700 });
    process.env.PATH = root;
    process.chdir(root);
    const chunks: Buffer[] = [];
    const result = await streamSearch({ name: "find", root, params: { pattern: "[" }, heartbeat: 100 },
      ".", new AbortController().signal, bytes => chunks.push(Buffer.from(bytes)));
    assert.deepEqual(result, { complete: false, limitReached: false, reason: "invalid glob" });
    assert.equal(Buffer.concat(chunks).length, 0);
  } finally {
    process.chdir(cwd);
    if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
    rmSync(root, { recursive: true, force: true });
  }
});
