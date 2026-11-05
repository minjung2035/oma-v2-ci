import { removeTree as cleanup } from "./fixtures/cleanup.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishContextRevision, verifyContextRevision } from "@oma/storage/context-snapshot";
import { fsyncTree, replaceDerivedFile } from "@oma/storage/durable-fs";
import { StoreError } from "@oma/domain/errors";

const cryptoHash = (value: string): string => createHash("sha256").update(value).digest("hex");
const revision = "a".repeat(40);
const goal = "# Frozen goal\n";
const entries = [{ path: "GOAL.md", bytes: Buffer.byteLength(goal), sha256: cryptoHash(goal) }];
const corrupt = (error: unknown): boolean => error instanceof StoreError && error.code === "STORE_CORRUPT";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "oma-context-durability-"));
  const source = join(root, "source"); mkdirSync(source);
  writeFileSync(join(source, "GOAL.md"), goal);
  const world = join(root, "world");
  const target = join(world, "context", "revisions", revision);
  return { root, source, world, target };
}


test("001. Context revision replay retains exact bytes modes and parent-only current target", () => {
  const f = fixture();
  try {
    const mask = process.umask(0o077);
    try { publishContextRevision(f.world, revision, entries, f.source); }
    finally { process.umask(mask); }
    const inode = lstatSync(f.target).ino;
    assert.equal(readFileSync(join(f.target, "GOAL.md"), "utf8"), goal);
    assert.equal(lstatSync(join(f.target, "GOAL.md")).mode & 0o777, 0o644, "context mode is fixed, independent of umask and mail policy");
    assert.equal(lstatSync(f.target).mode & 0o777, 0o555);
    assert.doesNotThrow(() => verifyContextRevision(f.target, entries, true));
    assert.equal(readlinkSync(join(f.world, "context", "current")), `revisions/${revision}`);
    publishContextRevision(f.world, revision, entries, f.source);
    assert.equal(lstatSync(f.target).ino, inode);
    assert.deepEqual(readdirSync(join(f.world, "context", "revisions")), [revision]);
    assert.equal(readFileSync(join(f.source, "GOAL.md"), "utf8"), goal);
    chmodSync(join(f.target, "GOAL.md"), 0o600);
    writeFileSync(join(f.target, "GOAL.md"), "changed\n");
    assert.throws(() => publishContextRevision(f.world, revision, entries, f.source), corrupt);
    assert.equal(readFileSync(join(f.target, "GOAL.md"), "utf8"), "changed\n");
    assert.equal(lstatSync(f.target).ino, inode);
  } finally { cleanup(f.root); }
});

test("002. Context rejects a linked source without deleting it or publishing a revision", () => {
  const f = fixture();
  try {
    linkSync(join(f.source, "GOAL.md"), join(f.root, "alias"));
    assert.throws(() => publishContextRevision(f.world, revision, entries, f.source), corrupt);
    assert.equal(existsSync(f.target), false);
    assert.equal(lstatSync(join(f.source, "GOAL.md")).nlink, 2);
    assert.equal(readFileSync(join(f.root, "alias"), "utf8"), goal);
    assert.deepEqual(readdirSync(join(f.world, "context", "revisions")), []);
  } finally { cleanup(f.root); }
});

test("003. Recursive flush distinguishes legitimate hardlinks and never follows workspace symlinks", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-tree-policy-"));
  try {
    writeFileSync(join(root, "object"), "immutable");
    linkSync(join(root, "object"), join(root, "archive"));
    fsyncTree(root);
    assert.throws(() => fsyncTree(root, "context-single-link"), corrupt);
    symlinkSync(".", join(root, "loop"));
    assert.throws(() => fsyncTree(root), corrupt);
    fsyncTree(root, "workspace-links");
    assert.equal(readlinkSync(join(root, "loop")), ".");
    assert.equal(lstatSync(join(root, "object")).nlink, 2);
  } finally { cleanup(root); }
});

for (const phase of ["file-before-rename", "directory-after-rename"] as const) {
  test(`004. Derived replacement preserves evidence on ${phase} failure`, t => {
    const root = mkdtempSync(join(tmpdir(), "oma-derived-io-"));
    const path = join(root, "view");
    const foreign = join(root, ".view.other-owner.tmp");
    writeFileSync(path, "old"); writeFileSync(foreign, "foreign");
    const fs = createRequire(import.meta.url)("node:fs") as typeof import("node:fs");
    const original = fs.fsyncSync;
    let injected = false;
    t.mock.method(fs, "fsyncSync", (fd: number): void => {
      const file = fs.fstatSync(fd).isFile();
      const trigger = phase === "file-before-rename" ? file : !file && readFileSync(path, "utf8") === "new";
      if (!injected && trigger) {
        injected = true;
        throw Object.assign(new Error("injected storage failure"), { code: "EIO" });
      }
      original(fd);
    });
    syncBuiltinESMExports();
    try {
      assert.throws(() => replaceDerivedFile(path, "new"), { code: "EIO" });
      assert.equal(injected, true);
      assert.equal(readFileSync(path, "utf8"), phase === "file-before-rename" ? "old" : "new");
      assert.equal(readFileSync(foreign, "utf8"), "foreign");
      assert.deepEqual(readdirSync(root).sort(), [".view.other-owner.tmp", "view"]);
    } finally { t.mock.restoreAll(); syncBuiltinESMExports(); cleanup(root); }
  });
}

for (const changed of [false, true]) test(`005. Context after rename and before final seal retains pending bytes and refuses changed=${changed}`, t => {
  const f = fixture(), fs = createRequire(import.meta.url)("node:fs") as typeof import("node:fs");
  const original = fs.fchmodSync;
  let injected = false;
  t.mock.method(fs, "fchmodSync", (fd: number, mode: number): void => {
    const held = fs.fstatSync(fd), named = fs.lstatSync(f.target, { throwIfNoEntry: false });
    if (!injected && mode === 0o555 && named && held.isDirectory() && held.dev === named.dev && held.ino === named.ino) {
      injected = true;
      throw Object.assign(new Error("final context seal interrupted"), { code: "EIO" });
    }
    original(fd, mode);
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => publishContextRevision(f.world, revision, entries, f.source), { code: "EIO" });
    assert.equal(injected, true);
    assert.equal(existsSync(join(f.world, "context", "current")), false);
    assert.equal(lstatSync(f.target).mode & 0o777, 0o755);
    assert.throws(() => verifyContextRevision(f.target, entries, true), corrupt);
    const inode = lstatSync(f.target).ino;
    t.mock.restoreAll(); syncBuiltinESMExports();
    if (changed) {
      writeFileSync(join(f.target, "GOAL.md"), "changed\n");
      assert.throws(() => publishContextRevision(f.world, revision, entries, f.source), corrupt);
      assert.equal(readFileSync(join(f.target, "GOAL.md"), "utf8"), "changed\n");
      assert.equal(existsSync(join(f.world, "context", "current")), false);
    } else {
      publishContextRevision(f.world, revision, entries, f.source);
      assert.equal(lstatSync(f.target).mode & 0o777, 0o555);
      assert.equal(readFileSync(join(f.target, "GOAL.md"), "utf8"), goal);
      assert.doesNotThrow(() => verifyContextRevision(f.target, entries, true));
      assert.equal(readlinkSync(join(f.world, "context", "current")), `revisions/${revision}`);
    }
    assert.equal(lstatSync(f.target).ino, inode, "replay never replaces an existing revision");
    assert.equal(readFileSync(join(f.source, "GOAL.md"), "utf8"), goal);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); cleanup(f.root); }
});
