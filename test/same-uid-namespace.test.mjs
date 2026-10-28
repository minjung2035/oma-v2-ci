/** FS-002/FS-005 (the same-UID namespace half of S-06): a write lands in the
 * directory this process resolved, not in whatever the pathname means by the
 * time the write happens.
 *
 * Every filesystem defect this product has had at the same UID is one shape:
 * resolve a path, decide what it is, then perform the effect on the path again.
 * The two resolutions are two walks through a namespace any process of this
 * user can rearrange in between, so "I checked the directory first" establishes
 * nothing about where the bytes went. Re-checking afterwards does not close it
 * either -- that is a third walk.
 *
 * These tests do the rearranging on purpose, at the exact instant the window is
 * open, and then ask where the bytes are. The durability observer is a seam the
 * product already has for crash simulation; here it is used as a clock, because
 * a race that only fails sometimes is not a test.
 *
 * What this does NOT claim: the durability half of S-06 -- power loss, ENOSPC,
 * read-only remount, storage qualification (docs/verification-spec.md) -- is an
 * environment gate and no test in this file observes it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replaceDerivedFile } from "@oma/storage/durable-fs";
import { publishStagedDirectory, replaceDerivedSymlink } from "@oma/storage/staged-tree";

/** A state tree, a directory an adversary of the same UID controls, and the
 * swap that points the first name at the second. */
function arena() {
  const base = mkdtempSync(join(tmpdir(), "oma-ns-"));
  const real = join(base, "state");
  const attack = join(base, "attack");
  mkdirSync(real); mkdirSync(attack);
  return {
    base, real, attack,
    moved: join(base, "moved"),
    /** What any process of this user can do between a check and a use. */
    swap() { renameSync(real, join(base, "moved")); symlinkSync(attack, real); },
    cleanup() { rmSync(base, { recursive: true, force: true }); },
  };
}

test("S-06/FS-005: a derived file is created in the directory that was resolved, not the name that was checked", () => {
  const a = arena();
  try {
    const target = join(a.real, "receipt.json");
    let swapped = false;
    replaceDerivedFile(target, "owned-bytes", 0o600, fault => {
      if (swapped || fault.point !== "file-create" || fault.phase !== "before") return;
      swapped = true;
      a.swap();
    });
    assert.equal(swapped, true, "the create window never opened, so this test proved nothing");
    assert.equal(readFileSync(join(a.moved, "receipt.json"), "utf8"), "owned-bytes",
      "the bytes did not land in the directory the call had already resolved");
    assert.deepEqual(readdirSync(a.attack), [],
      "a directory swapped in after the check received this product's write");
  } finally { a.cleanup(); }
});

test("S-06/FS-005: the rename that publishes a derived file uses the held parent, not the target pathname", () => {
  const a = arena();
  try {
    const target = join(a.real, "view.json");
    let swapped = false;
    replaceDerivedFile(target, "published", 0o600, fault => {
      if (swapped || fault.point !== "derived-rename" || fault.phase !== "before") return;
      swapped = true;
      a.swap();
    });
    assert.equal(swapped, true, "the rename window never opened, so this test proved nothing");
    assert.equal(readFileSync(join(a.moved, "view.json"), "utf8"), "published");
    assert.deepEqual(readdirSync(a.attack), [],
      "the publishing rename resolved the target pathname a second time");
  } finally { a.cleanup(); }
});

test("S-06/FS-005: no temporary is left behind in the directory the call was holding", () => {
  const a = arena();
  try {
    replaceDerivedFile(join(a.real, "x.json"), "v", 0o600, fault => {
      if (fault.point === "file-create" && fault.phase === "before") a.swap();
    });
    assert.deepEqual(readdirSync(a.moved), ["x.json"],
      "the temporary survived the publication it was renamed out of");
  } finally { a.cleanup(); }
});

test("S-06/FS-005: a staged tree is refused rather than published into a destination parent that was replaced", () => {
  const a = arena();
  try {
    const staging = join(a.base, "staging");
    mkdirSync(staging); writeFileSync(join(staging, "entry.txt"), "accepted");
    const destination = join(a.real, "published");
    let swapped = false;
    // `verify` is the caller's own inspection of the staged tree, and it is the
    // last thing that runs before the rename: exactly the window an adversary
    // would use. Publication must not proceed into a parent that is no longer
    // the directory this call checked -- and refusing is the right answer,
    // because there is nothing safe left to publish into.
    assert.throws(() => publishStagedDirectory(staging, destination, () => {
      if (swapped) return;
      swapped = true;
      a.swap();
    }), /containment|escape|ELOOP|STORE_CORRUPT/i);
    assert.equal(swapped, true, "the publication window never opened, so this test proved nothing");
    assert.deepEqual(readdirSync(a.attack), [],
      "an accepted tree was published into a directory swapped in after the check");
    assert.equal(existsSync(join(staging, "entry.txt")), true,
      "the staged tree was consumed by a publication that did not happen");
  } finally { a.cleanup(); }
});

/** This one is a behaviour check, not a race control: `replaceDerivedSymlink`
 * has no fault seam to open the window at, so the line that must stay correct
 * is held by the source gate below instead. Saying so here is the point --
 * a test named after a property it does not observe is how a suite comes to
 * report more than it knows. */
test("S-06/FS-005: replacing a derived symlink is idempotent and leaves no temporary", () => {
  const a = arena();
  try {
    const link = join(a.real, "current");
    replaceDerivedSymlink(link, "revisions/7");
    assert.equal(readdirSync(a.real).includes("current"), true);
    // Replacing it again must leave exactly one entry: a temporary that is
    // unlinked through a re-resolved pathname is a temporary that can survive.
    replaceDerivedSymlink(link, "revisions/8");
    assert.deepEqual(readdirSync(a.real), ["current"]);
  } finally { a.cleanup(); }
});

