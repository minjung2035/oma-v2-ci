import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
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
