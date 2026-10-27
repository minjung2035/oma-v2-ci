import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorkspaceRefusal, componentsWithin, mkdirWithin, readWithin, readdirWithin, withFileWithin, withSearchSnapshot, writeWithin } from "@oma/tool-files";

function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), "oma-tool-files-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("file policy refuses escaping and malformed paths before any effect", () => {
  assert.deepEqual(componentsWithin("/workspace", "a/b"), ["a", "b"]);
  for (const path of ["../escape", "/elsewhere", "a\0b"])
    assert.throws(() => componentsWithin("/workspace", path), WorkspaceRefusal);
});

test("real held descriptors survive a root rename; links cannot carry a tool write", async t => {
  const root = workspace(t), selected = join(root, "selected"), outside = join(root, "outside");
  mkdirSync(selected); mkdirSync(outside);
  writeFileSync(join(selected, "note"), "held bytes");
  writeFileSync(join(outside, "note"), "outside bytes");
  await withFileWithin(selected, "note", async held => {
    renameSync(selected, join(root, "moved"));
    symlinkSync(outside, selected);
    assert.equal(readFileSync(held, "utf8"), "held bytes");
  });
  assert.throws(() => writeWithin(selected, "note", "changed"), WorkspaceRefusal);
  assert.equal(readFileSync(join(outside, "note"), "utf8"), "outside bytes");
  const moved = join(root, "moved");
  linkSync(join(outside, "note"), join(moved, "alias"));
  assert.throws(() => writeWithin(moved, "alias", "changed"), WorkspaceRefusal);
  assert.equal(readFileSync(join(outside, "note"), "utf8"), "outside bytes");
});

test("the actual snapshot is declared before creation and removed after callback failure", async t => {
  const root = workspace(t), primary = new Error("consumer failure"), declared = [];
  mkdirWithin(root, "nested"); writeWithin(root, "nested/note", "snapshot bytes");
  await assert.rejects(withSearchSnapshot(root, "nested/note", undefined, async (snapshot, target) => {
    assert.equal(readFileSync(target, "utf8"), "snapshot bytes");
    writeWithin(root, "nested/note", "later bytes");
    assert.equal(readFileSync(target, "utf8"), "snapshot bytes");
    throw primary;
  }, undefined, name => {
    const path = join(tmpdir(), name);
    assert.equal(existsSync(path), false);
    declared.push(path);
  }), error => error === primary);
  for (const path of declared) assert.equal(existsSync(path), false);
  assert.equal(readWithin(root, "nested/note").toString(), "later bytes");
});

test("snapshot walking excludes links and cleanup does not follow a planted directory link", async t => {
  const root = workspace(t), outside = workspace(t);
  mkdirWithin(root, "nested"); writeWithin(root, "nested/note", "approved bytes");
  writeFileSync(join(outside, "keep"), "outside bytes");
  symlinkSync(outside, join(root, "link"));
  assert.deepEqual(readdirWithin(root, "nested"), ["note"]);
  let copied;
  await withSearchSnapshot(root, ".", undefined, async snapshot => {
    copied = snapshot;
    assert.equal(existsSync(join(snapshot, "link")), false);
    assert.equal(readFileSync(join(snapshot, "nested", "note"), "utf8"), "approved bytes");
    symlinkSync(outside, join(snapshot, "planted"));
  });
  assert.equal(existsSync(copied), false);
  assert.equal(readFileSync(join(outside, "keep"), "utf8"), "outside bytes");
});
