/** The owned-tree primitives must reach a directory that lost its owner
 * read/write/search bits -- a same-UID stray or an interrupted writer can
 * leave a mode-000 inside a tree oma owns. The walks pin each directory with
 * O_PATH (the pin needs no permission bits and follows no link), give the
 * pinned inode its owner bits back, and only then open it: a removal that
 * opened first and repaired second threw EACCES on exactly the directories
 * the repair existed for. */
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listOwnedDirectory, removeOwnedTree, removeUnusedTree } from "../src/storage/directory.js";

/** A failing case can strand mode-000 directories under the fixture root;
 * give the bits back best-effort before the recursive remove. */
function sweep(root: string): void {
  const repair = (dir: string): void => {
    try { chmodSync(dir, 0o700); } catch { return; }
    let names: string[];
    try { names = readdirSync(dir); } catch { return; }
    for (const name of names) {
      const path = join(dir, name);
      try { if (lstatSync(path).isDirectory()) repair(path); } catch { /* entry gone */ }
    }
  };
  repair(root);
  rmSync(root, { recursive: true, force: true });
}

function fixture(): { root: string } {
  return { root: mkdtempSync(join(tmpdir(), "oma-owned-dir-")) };
}

test("FS-005: an owned tree whose root lost every permission bit is still removed", () => {
  const f = fixture();
  try {
    const tree = join(f.root, "dead");
    mkdirSync(join(tree, "sub"), { recursive: true });
    writeFileSync(join(tree, "sub", "e.ts"), "x\n");
    // The O_RDONLY | O_DIRECTORY open threw EACCES before the in-walk fchmod
    // could ever run -- the dead copy stayed forever.
    chmodSync(tree, 0o000);
    removeOwnedTree(tree);
    assert.equal(existsSync(tree), false);
    removeOwnedTree(tree); // gone already: nothing to do
  } finally { sweep(f.root); }
});

test("FS-005: an owned tree holding owner-read-less subdirectories is removed whole", () => {
  const f = fixture();
  try {
    const tree = join(f.root, "dead");
    for (const mode of [0o000, 0o100, 0o300]) {
      const locked = join(tree, `locked-${mode.toString(8)}`);
      mkdirSync(join(locked, "deeper"), { recursive: true });
      writeFileSync(join(locked, "deeper", "e.ts"), "x\n");
      chmodSync(locked, mode);
    }
    // A read-only directory lists but its children cannot be removed without
    // the owner write bit; a link inside is an entry, never followed.
    const readonly = join(tree, "readonly");
    mkdirSync(readonly); writeFileSync(join(readonly, "x.ts"), "x\n"); chmodSync(readonly, 0o555);
    const outside = join(f.root, "outside"); mkdirSync(outside); writeFileSync(join(outside, "keep"), "kept");
    symlinkSync(outside, join(tree, "escape"));
    removeOwnedTree(tree);
    assert.equal(existsSync(tree), false, "the whole tree went, locked subdirectories and all");
    assert.equal(readFileSync(join(outside, "keep"), "utf8"), "kept", "the link was unlinked, never followed");
  } finally { sweep(f.root); }
});

test("FS-005: the owner-bits repair adds missing bits and keeps the mode's special bits", () => {
  const f = fixture();
  try {
    const dir = join(f.root, "setgid-dir");
    mkdirSync(dir); writeFileSync(join(dir, "e.ts"), "x\n");
    // setgid + owner r-x: the repair must give owner w back without clearing
    // the setgid bit -- the old `& 0o777` silently stripped it to 0o700.
    chmodSync(dir, 0o2500);
    const listed = listOwnedDirectory(dir);
    assert.equal(listed?.length, 1, "the directory lists after repair");
    assert.equal(statSync(dir).mode & 0o7777, 0o2700, "owner bits are added, setgid is kept");
    // A mode-000 directory lists too, ending with exactly the owner bits.
    chmodSync(dir, 0o000);
    assert.equal(listOwnedDirectory(dir)?.length, 1);
    assert.equal(statSync(dir).mode & 0o7777, 0o700);
    // And the same repair holds inside a tree being removed: a setgid
    // directory in the way of removal is removed, not preserved or refused.
    removeOwnedTree(dir);
    assert.equal(existsSync(dir), false);
  } finally { sweep(f.root); }
});

test("DR24: an unused session tree holding owner-read-less directories still goes whole", () => {
  const f = fixture();
  try {
    const session = join(f.root, "session");
    mkdirSync(join(session, "rootfs", "locked"), { recursive: true });
    writeFileSync(join(session, "rootfs", "locked", "x"), "x\n");
    writeFileSync(join(session, "config.json"), "{}");
    chmodSync(join(session, "rootfs", "locked"), 0o000);
    chmodSync(session, 0o500);
    removeUnusedTree(session);
    assert.equal(existsSync(session), false);
  } finally { sweep(f.root); }
});
