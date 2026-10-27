import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
function cleanup(root: string): void {
  const walk = (path: string): void => {
    const stat = lstatSync(path);
    if (!stat.isDirectory()) return;
    chmodSync(path, 0o700);
    for (const name of readdirSync(path)) walk(join(path, name));
  };
  walk(root); rmSync(root, { recursive: true, force: true });
}

test("context revision replay retains exact bytes modes and parent-only current target", () => {
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

test("context rejects a linked source without deleting it or publishing a revision", () => {
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

test("recursive flush distinguishes legitimate hardlinks and never follows workspace symlinks", () => {
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
  test(`derived replacement preserves evidence on ${phase} failure`, t => {
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
