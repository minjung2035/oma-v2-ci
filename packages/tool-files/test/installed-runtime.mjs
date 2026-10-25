import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { WorkspaceRefusal, readWithin, writeWithin } from "@oma/tool-files";

const root = join(process.cwd(), "tool-files-workspace");
mkdirSync(root);
try {
  if (process.platform === "linux") {
    writeWithin(root, "note", "installed contained bytes");
    assert.equal(readWithin(root, "note").toString(), "installed contained bytes");
  } else {
    assert.throws(() => writeWithin(root, "note", "effect"), WorkspaceRefusal);
    assert.equal(existsSync(join(root, "note")), false);
  }
} finally { rmSync(root, { recursive: true, force: true }); }
