import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { mkdirWithin, readWithin, readdirWithin, withSearchSnapshot, writeWithin } from "@oma/tool-files";
import { ensurePrivateStateDirectory, privateStateKey, removePrivateStateTree } from "@oma/tool-files/private-state";

const root = join(process.cwd(), "tool-files-workspace");
mkdirSync(root);
try {
  mkdirWithin(root, "nested");
  writeWithin(root, "nested/note", "installed contained bytes");
  assert.equal(readWithin(root, "nested/note").toString(), "installed contained bytes");
  assert.deepEqual(readdirWithin(root, "nested"), ["note"]);
  const state = join(root, "private-state");
  ensurePrivateStateDirectory(state);
  const key = privateStateKey(state, "key");
  assert.equal(Buffer.from(key, "base64").length, 32);
  assert.equal(privateStateKey(state, "key"), key);
  removePrivateStateTree(state);
  await withSearchSnapshot(root, "nested/note", undefined, async (snapshot, target) => {
    const { readFileSync } = await import("node:fs");
    assert.equal(readFileSync(target, "utf8"), "installed contained bytes");
  });
} finally { rmSync(root, { recursive: true, force: true }); }
