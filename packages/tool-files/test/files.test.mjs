import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

test("scoped snapshots contain only the selected file/subtree and ancestor ignore inputs", async t => {
  const root = workspace(t), outside = workspace(t);
  mkdirWithin(root, "branch/selected/deep");
  mkdirWithin(root, "unrelated");
  writeWithin(root, "root.txt", "root bytes");
  writeWithin(root, "branch/sibling.txt", "sibling bytes");
  writeWithin(root, "branch/selected/note.txt", "selected bytes");
  writeWithin(root, "branch/selected/deep/leaf.txt", "nested bytes");
  writeWithin(root, "unrelated/secret.txt", "unrelated bytes");
  mkdirWithin(root, ".git");
  writeWithin(root, ".git/config", "private repository configuration");
  for (const directory of ["", "branch"])
    for (const ignore of [".gitignore", ".ignore", ".rgignore", ".fdignore"])
      writeWithin(root, join(directory, ignore), `${directory || "root"}-${ignore}\n`);
  writeFileSync(join(outside, "secret.txt"), "outside bytes");
  symlinkSync(outside, join(root, "branch/selected/link"));
  linkSync(join(outside, "secret.txt"), join(root, "branch/selected/alias.txt"));
  chmodSync(join(root, "unrelated"), 0);
  const rootEntries = [".fdignore", ".git", ".gitignore", ".ignore", ".rgignore", "branch"];
  const branchIgnores = [".fdignore", ".gitignore", ".ignore", ".rgignore"];
  try {
    await withSearchSnapshot(root, "branch/selected/note.txt", undefined, async (snapshot, target) => {
      assert.equal(target, join(snapshot, "branch/selected/note.txt"));
      assert.equal(readFileSync(target, "utf8"), "selected bytes");
      assert.deepEqual(readdirSync(snapshot).sort(), rootEntries);
      assert.deepEqual(readdirSync(join(snapshot, "branch")).sort(), [...branchIgnores, "selected"]);
      assert.deepEqual(readdirSync(join(snapshot, "branch/selected")), ["note.txt"]);
      assert.equal(readFileSync(join(snapshot, ".gitignore"), "utf8"), "root-.gitignore\n");
      assert.equal(readFileSync(join(snapshot, "branch/.ignore"), "utf8"), "branch-.ignore\n");
      assert.deepEqual(readdirSync(join(snapshot, ".git")), []);
    });
    await withSearchSnapshot(root, "branch/selected", undefined, async (snapshot, target) => {
      assert.equal(target, join(snapshot, "branch/selected"));
      assert.deepEqual(readdirSync(snapshot).sort(), rootEntries);
      assert.deepEqual(readdirSync(join(snapshot, "branch")).sort(), [...branchIgnores, "selected"]);
      assert.deepEqual(readdirSync(target).sort(), ["deep", "note.txt"]);
      assert.equal(readFileSync(join(target, "deep/leaf.txt"), "utf8"), "nested bytes");
    });
    // Selecting an ignore file itself must not copy it twice.
    await withSearchSnapshot(root, "branch/.ignore", undefined, async (_snapshot, target) => {
      assert.equal(readFileSync(target, "utf8"), "branch-.ignore\n");
    });
  } finally { chmodSync(join(root, "unrelated"), 0o700); }
  await withSearchSnapshot(root, ".", undefined, async (snapshot, target) => {
    assert.equal(target, snapshot);
    assert.equal(readFileSync(join(snapshot, "root.txt"), "utf8"), "root bytes");
    assert.equal(readFileSync(join(snapshot, "branch/sibling.txt"), "utf8"), "sibling bytes");
    assert.equal(readFileSync(join(snapshot, "unrelated/secret.txt"), "utf8"), "unrelated bytes");
    assert.deepEqual(readdirSync(join(snapshot, ".git")), []);
    assert.equal(existsSync(join(snapshot, "branch/selected/alias.txt")), false);
    assert.equal(existsSync(join(snapshot, "branch/selected/link")), false);
  });
});

test("scoped snapshots keep the selected descriptors through an ancestor replacement", async t => {
  const root = workspace(t), outside = workspace(t);
  mkdirWithin(root, "branch");
  writeWithin(root, ".gitignore", "*.ignored\n");
  writeWithin(root, "branch/note.txt", "held selected bytes");
  writeFileSync(join(outside, "note.txt"), "outside bytes");
  let replaced = false;
  await withSearchSnapshot(root, "branch/note.txt", undefined, async (_snapshot, target) => {
    assert.equal(replaced, true);
    assert.equal(readFileSync(target, "utf8"), "held selected bytes");
  }, () => {
    if (replaced) return;
    replaced = true;
    renameSync(join(root, "branch"), join(root, "moved"));
    symlinkSync(outside, join(root, "branch"));
  });
  assert.equal(readFileSync(join(outside, "note.txt"), "utf8"), "outside bytes");
});

test("scoped snapshot refusals and aborts remove declared copies without exposing links or repository internals", async t => {
  const root = workspace(t), outside = workspace(t);
  mkdirWithin(root, "branch");
  writeWithin(root, "branch/note.txt", "selected bytes");
  mkdirWithin(root, ".git");
  writeWithin(root, ".git/config", "private repository configuration");
  writeFileSync(join(outside, "secret.txt"), "outside bytes");
  symlinkSync(outside, join(root, "linked"));
  symlinkSync(join(outside, "secret.txt"), join(root, "leaf-link"));
  linkSync(join(outside, "secret.txt"), join(root, "alias.txt"));
  const declared = [];
  const named = name => { declared.push(join(tmpdir(), name)); };
  for (const path of ["../escape", "linked/secret.txt", "leaf-link", "alias.txt", ".git", ".git/config"])
    await assert.rejects(withSearchSnapshot(root, path, undefined, async () => assert.fail("refused target reached consumer"), undefined, named), WorkspaceRefusal);
  for (const path of ["branch", "branch/note.txt"]) {
    const controller = new AbortController();
    await assert.rejects(withSearchSnapshot(root, path, controller.signal,
      async () => assert.fail("aborted target reached consumer"), () => controller.abort(), named), /search aborted/);
  }
  const alreadyAborted = new AbortController(); alreadyAborted.abort();
  await assert.rejects(withSearchSnapshot(root, ".", alreadyAborted.signal,
    async () => assert.fail("aborted root reached consumer"), undefined, named), /search aborted/);
  for (const path of declared) assert.equal(existsSync(path), false, `snapshot remained at ${path}`);
  assert.equal(readFileSync(join(outside, "secret.txt"), "utf8"), "outside bytes");
});
