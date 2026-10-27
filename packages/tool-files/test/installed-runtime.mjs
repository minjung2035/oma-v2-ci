import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { mkdirWithin, readWithin, readdirWithin, withSearchSnapshot, writeWithin } from "@oma/tool-files";

const root = join(process.cwd(), "tool-files-workspace");
mkdirSync(root);
try {
  mkdirWithin(root, "nested");
  writeWithin(root, "nested/note", "installed contained bytes");
  assert.equal(readWithin(root, "nested/note").toString(), "installed contained bytes");
  assert.deepEqual(readdirWithin(root, "nested"), ["note"]);
  await withSearchSnapshot(root, "nested/note", undefined, async (snapshot, target) => {
    const { readFileSync } = await import("node:fs");
    assert.equal(readFileSync(target, "utf8"), "installed contained bytes");
  });
} finally { rmSync(root, { recursive: true, force: true }); }
