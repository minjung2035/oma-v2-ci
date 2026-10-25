import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishStagedDirectory, replaceDerivedSymlink } from "@oma/storage/staged-tree";
import { StoreError } from "@oma/domain/errors";

function fixture(): { root: string; staging: string; destination: string } {
  const root = mkdtempSync(join(tmpdir(), "oma-staged-retry-"));
  const staging = join(root, "staging");
  const destination = join(root, "revision");
  mkdirSync(staging);
  writeFileSync(join(staging, "GOAL.md"), "frozen\n", { mode: 0o444 });
  return { root, staging, destination };
}
const verify = (root: string): void => {
  assert.deepEqual(readdirSync(root), ["GOAL.md"]);
  assert.equal(readFileSync(join(root, "GOAL.md"), "utf8"), "frozen\n");
};

test("a completed rename can be retried without recreating its missing staging tree", () => {
  const f = fixture();
  try {
    assert.equal(publishStagedDirectory(f.staging, f.destination, verify), "published");
    assert.equal(existsSync(f.staging), false);
    const inode = lstatSync(f.destination).ino;
    assert.equal(publishStagedDirectory(f.staging, f.destination, verify), "existing");
    assert.equal(lstatSync(f.destination).ino, inode);
    assert.equal(lstatSync(join(f.destination, "GOAL.md")).mode & 0o777, 0o444);
    assert.deepEqual(readdirSync(f.root), ["revision"]);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("ENOENT from existing-destination verification is not permission to replace it", () => {
  const f = fixture();
  try {
    mkdirSync(f.destination);
    const inode = lstatSync(f.destination).ino;
    const checkMissing = (path: string): void => { readFileSync(join(path, "missing")); };
    assert.throws(() => publishStagedDirectory(f.staging, f.destination, checkMissing), { code: "ENOENT" });
    assert.equal(lstatSync(f.destination).ino, inode);
    assert.deepEqual(readdirSync(f.destination), []);
    verify(f.staging);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("existing different trees and symlink destinations are never merged or removed", () => {
  const f = fixture();
  try {
    mkdirSync(f.destination);
    writeFileSync(join(f.destination, "GOAL.md"), "different\n");
    assert.throws(() => publishStagedDirectory(f.staging, f.destination, verify));
    assert.equal(readFileSync(join(f.destination, "GOAL.md"), "utf8"), "different\n");
    verify(f.staging);
    rmSync(f.destination, { recursive: true });
    symlinkSync("absent-target", f.destination);
    assert.throws(() => publishStagedDirectory(f.staging, f.destination, verify),
      (error: unknown) => error instanceof StoreError && error.code === "STORE_CORRUPT");
    assert.equal(readlinkSync(f.destination), "absent-target");
    verify(f.staging);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("derived current links do not traverse their target and leave no temporary aliases", () => {
  const f = fixture();
  try {
    const current = join(f.root, "current");
    replaceDerivedSymlink(current, "revisions/not-created-yet");
    assert.equal(readlinkSync(current), "revisions/not-created-yet");
    replaceDerivedSymlink(current, "revisions/next");
    assert.equal(readlinkSync(current), "revisions/next");
    for (const target of ["/tmp", "../outside", "revisions/../outside", "./revision", "revisions//x", "x\0y"])
      assert.throws(() => replaceDerivedSymlink(current, target),
        (error: unknown) => error instanceof StoreError && error.code === "STORE_CORRUPT");
    assert.deepEqual(readdirSync(f.root).sort(), ["current", "staging"]);
    verify(f.staging);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
