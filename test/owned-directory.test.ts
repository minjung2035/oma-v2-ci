/** The owned-tree primitives must reach a directory that lost its owner
 * read/write/search bits -- a same-UID stray or an interrupted writer can
 * leave a mode-000 inside a tree oma owns. The walks pin each directory with
 * O_PATH (the pin needs no permission bits and follows no link), give the
 * pinned inode its owner bits back, and only then open it: a removal that
 * opened first and repaired second threw EACCES on exactly the directories
 * the repair existed for. */
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureOwnedDirectory, listOwnedDirectory, openOwnedDirectoryPath, removeOwnedTree, removeUnusedTree } from "@oma/storage/directory";

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

test("FS-005: an owned directory opens by path even at mode-000 -- the leaf is pinned and repaired", () => {
  const f = fixture();
  try {
    const dir = join(f.root, "store");
    mkdirSync(dir); writeFileSync(join(dir, "e.ts"), "x\n");
    chmodSync(dir, 0o000);
    // The `oma pi` open path used to throw EACCES out of the O_RDONLY |
    // O_DIRECTORY walk before any repair could run -- a mode-000 store root
    // or `local/` wedged every install. The pin needs no bits; the repair is
    // made on the one pinned inode; the open follows it.
    const held = openOwnedDirectoryPath(dir);
    closeSync(held);
    assert.equal(statSync(dir).mode & 0o777, 0o700, "the open repaired the owner bits");
  } finally { sweep(f.root); }
});

test("FS-005: an owned ensure repairs every component at and below its boundary -- and never above it", () => {
  const f = fixture();
  const oma = join(f.root, "oma");
  const store = join(oma, ".packages");
  try {
    // The `oma pi` startup ensure is this shape: the data root and the store
    // are oma's own tail, everything above the data root is the user's.
    mkdirSync(join(store, "local"), { recursive: true });
    // Leaf first: once `oma` itself is mode-000 nothing beneath it can be
    // touched to take its bits away.
    chmodSync(join(store, "local"), 0o000); chmodSync(store, 0o000); chmodSync(oma, 0o000);
    assert.throws(() => statSync(join(store, "local")), /EACCES/, "sanity: mode-000 ancestors really do hide the path");
    ensureOwnedDirectory(store, oma, 0o700);
    assert.equal(statSync(oma).mode & 0o777, 0o700, "the boundary component itself is repaired");
    assert.equal(statSync(store).mode & 0o777, 0o700, "the leaf is repaired");
    // `local` lies beneath the ensured path, not on it: reachable now, but
    // only an ensure of its own path gives its bits back.
    assert.equal(statSync(join(store, "local")).mode & 0o777, 0o000, "the ensure's open made `local` reachable again");
    ensureOwnedDirectory(join(store, "local"), oma, 0o700);
    assert.equal(statSync(join(store, "local")).mode & 0o777, 0o700);
    // A missing owned tail is still created, as ensureDirectory made it.
    const missing = join(f.root, "oma", "fresh", "deep");
    ensureOwnedDirectory(missing, oma, 0o700);
    assert.equal(statSync(missing).mode & 0o777, 0o700);
  } finally { sweep(f.root); }

  const g = fixture();
  try {
    // The boundary's own ancestors are the user's: a mode-000 there is a
    // fact to report, never a mode for this product to rewrite.
    const oma = join(g.root, "oma");
    mkdirSync(join(oma, ".packages"), { recursive: true });
    chmodSync(g.root, 0o000);
    assert.throws(() => ensureOwnedDirectory(join(oma, ".packages"), oma, 0o700), { code: "BROKER_UNAVAILABLE" });
    assert.equal(statSync(g.root).mode & 0o777, 0o000, "an ancestor above the boundary is never repaired");
    chmodSync(g.root, 0o700);
  } finally { sweep(g.root); }
});

test("FS-005: an owned ensure refuses a boundary that is not its own ancestor", () => {
  const f = fixture();
  try {
    const oma = join(f.root, "oma");
    mkdirSync(join(oma, ".packages"), { recursive: true });
    for (const boundary of [join(f.root, "elsewhere"), join(f.root, "oma", ".packages", "deeper"), "/"]) {
      assert.throws(() => ensureOwnedDirectory(join(oma, ".packages"), boundary, 0o700), { code: "STORE_CORRUPT" }, boundary);
    }
    // Every ancestor of the path is a lawful boundary, however far up it
    // reaches -- the check only requires it to be one.
    for (const boundary of [f.root, oma, join(oma, ".packages")]) {
      assert.doesNotThrow(() => ensureOwnedDirectory(join(oma, ".packages"), boundary, 0o700), boundary);
    }
  } finally { sweep(f.root); }
});

test("FS-005: a stray where an owned component must be a directory is collected -- at or above the boundary it stands", () => {
  const f = fixture();
  const oma = join(f.root, "oma");
  const store = join(oma, ".packages");
  try {
    mkdirSync(oma);
    // A file or link at an owned slot can hold nothing oma made beneath it
    // -- the same stray the stage collection answers inside `local/` and the
    // sweep answers for the store's own root. Before this, the open refused
    // it (ENOTDIR, ELOOP) on every `oma pi` forever.
    writeFileSync(store, "stray\n");
    ensureOwnedDirectory(store, oma, 0o700);
    assert.ok(lstatSync(store).isDirectory(), "a stray file at the store slot is collected and the directory made");

    const victim = join(f.root, "victim");
    mkdirSync(victim);
    writeFileSync(join(victim, "keep.txt"), "kept\n");
    rmSync(store, { recursive: true });
    symlinkSync(victim, store);
    ensureOwnedDirectory(store, oma, 0o700);
    assert.ok(lstatSync(store).isDirectory(), "a stray link is unlinked for what it is, never followed");
    assert.equal(readFileSync(join(victim, "keep.txt"), "utf8"), "kept\n", "the link's target is untouched");

    // The boundary component itself is never collected: its parent is the
    // user's, not oma's -- the refusal stands and the entry stays.
    rmSync(oma, { recursive: true });
    symlinkSync(victim, oma);
    assert.throws(() => ensureOwnedDirectory(join(oma, ".packages"), oma, 0o700), { code: "STORE_CORRUPT" });
    assert.ok(lstatSync(oma).isSymbolicLink(), "a stray at the boundary slot is refused, never unlinked");
    assert.equal(readFileSync(join(victim, "keep.txt"), "utf8"), "kept\n");
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
