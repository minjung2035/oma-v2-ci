import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, mkdirSync, closeSync, constants, openSync, readFileSync, writeFileSync, rmSync, renameSync, fchmodSync, fstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDirectory, openBeneath } from "@oma/native/files";
import { directoryNames, mkdirAt, unlinkAt } from "@oma/file-descriptors";
import { linkAt, renameAt, readlinkAt, readlinkBytesAt, statAt, symlinkAt } from "@oma/native/posix-files";
import { observeDarwinProcess, observeLinuxProcess } from "@oma/native/process-observation";
import { hostProcessProbe } from "@oma/broker/process-ancestry";
import { RestartPolicy } from "@oma/process/restart-policy";
import { cleanupAll, withCleanup } from "@oma/native/cleanup";
import { SnapshotReader } from "@oma/native/snapshot-reader";
import { ensureOwnedDirectory, openOwnedDirectory } from "@oma/storage/directory";
import { createHash } from "node:crypto";
import { publishImmutableFile } from "@oma/storage/immutable-file";

test("snapshot reader returns final symlink bytes while refusing linked parents", () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "oma-native-snapshot-link-")));
  let reader;
  withCleanup(() => {
    mkdirSync(join(scratch, "nested"));
    writeFileSync(join(scratch, "nested", "data"), "content");
    const held = openDirectory(scratch);
    withCleanup(() => {
      symlinkAt("../missing-target", held, "final-link");
      symlinkAt("nested", held, "parent-link");
    }, () => closeSync(held));
    reader = new SnapshotReader(scratch);
    const entry = reader.entry("final-link");
    assert.ok(entry);
    withCleanup(() => {
      assert.equal(entry.stat.isSymbolicLink(), true);
      assert.deepEqual(entry.link, Buffer.from("../missing-target"));
    }, () => closeSync(entry.descriptor));
    assert.throws(() => reader.entry("parent-link/data"), { code: "STORE_CORRUPT" });
  }, () => cleanupAll([
    () => reader?.close(),
    () => rmSync(scratch, { recursive: true, force: true }),
  ]));
});

test("contained opens accept caller no-follow and reject intermediate and final symlinks", () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "oma-native-nofollow-")));
  let held;
  withCleanup(() => {
    mkdirSync(join(scratch, "nested"));
    writeFileSync(join(scratch, "nested", "data"), "original inode");
    if (process.platform === "darwin") {
      // Real-kernel positive control for the rejected combination. Neither
      // process.platform nor any OS observation is replaced in this test.
      let raw;
      withCleanup(() => assert.throws(() => {
        raw = openSync(join(scratch, "nested", "data"), constants.O_RDONLY |
          constants.O_NOFOLLOW | 0x20000000 /* Darwin O_NOFOLLOW_ANY */);
      }, { code: "EINVAL" }), () => { if (raw !== undefined) closeSync(raw); });
    }
    held = openDirectory(scratch);
    const fd = openBeneath(held, "nested/data", constants.O_RDONLY | constants.O_NOFOLLOW);
    withCleanup(() => assert.equal(readFileSync(fd, "utf8"), "original inode"), () => closeSync(fd));
    symlinkAt("nested", held, "directory-link");
    symlinkAt("nested/data", held, "file-link");
    for (const path of ["directory-link/data", "file-link"]) {
      let unexpected;
      withCleanup(() => assert.throws(() => {
        unexpected = openBeneath(held, path, constants.O_RDONLY | constants.O_NOFOLLOW);
      }, { code: "STORE_CORRUPT" }), () => { if (unexpected !== undefined) closeSync(unexpected); });
    }
    assert.equal(readFileSync(join(scratch, "nested", "data"), "utf8"), "original inode");
  }, () => cleanupAll([
    () => { if (held !== undefined) closeSync(held); },
    () => rmSync(scratch, { recursive: true, force: true }),
  ]));
});

test("owned directory creation retains readable inode authority and repairs owner bits without following replacements", () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "oma-owned-readable-")));
  let parent, held;
  withCleanup(() => {
    const owned = join(scratch, "owned"), outside = join(scratch, "outside");
    mkdirSync(owned); mkdirSync(outside);
    const original = openDirectory(owned);
    withCleanup(() => fchmodSync(original, 0o550), () => closeSync(original));
    writeFileSync(join(outside, "canary"), "outside unchanged");
    ensureOwnedDirectory(join(owned, "nested"), owned, 0o700);
    parent = openDirectory(scratch); held = openOwnedDirectory(parent, "owned");
    assert.equal(fstatSync(held).mode & 0o777, 0o750);
    renameSync(owned, join(scratch, "moved")); symlinkAt("outside", parent, "owned");
    mkdirAt(held, "held-effect", 0o700);
    assert.deepEqual(directoryNames(held), ["held-effect", "nested"]);
    assert.throws(() => openOwnedDirectory(parent, "owned"), { code: "STORE_CORRUPT" });
    assert.equal(readFileSync(join(outside, "canary"), "utf8"), "outside unchanged");
  }, () => cleanupAll([
    () => { if (held !== undefined) closeSync(held); },
    () => { if (parent !== undefined) closeSync(parent); },
    () => rmSync(scratch, { recursive: true, force: true }),
  ]));
});

test("immutable publication keeps checked source bytes across source-name substitution and refuses a conflicting destination", () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "oma-immutable-held-")));
  withCleanup(() => {
    const source = join(scratch, "source"), moved = join(scratch, "moved"), target = join(scratch, "published");
    const original = Buffer.from([0, 0x7f, 0x80, 0xff, 10]);
    const replacement = Buffer.from("replacement must not be published");
    writeFileSync(source, original);
    const hash = createHash("sha256").update(original).digest("hex");
    publishImmutableFile(source, target, hash, fault => {
      if (fault.point === "publication-link" && fault.phase === "before") {
        renameSync(source, moved);
        writeFileSync(source, replacement);
      }
    });
    assert.deepEqual(readFileSync(target), original);
    assert.deepEqual(readFileSync(source), replacement);
    assert.deepEqual(readFileSync(moved), original);
    assert.throws(() => publishImmutableFile(source, target), { code: "STORE_CORRUPT" });
    assert.deepEqual(readFileSync(target), original);
    assert.deepEqual(readFileSync(source), replacement);
  }, () => rmSync(scratch, { recursive: true, force: true }));
});

test("directory effects remain on the held inode after a pathname replacement", () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "oma-native-files-")));
  mkdirSync(join(scratch, "root")); const held = openDirectory(join(scratch, "root"));
  try {
    renameSync(join(scratch, "root"), join(scratch, "moved")); mkdirSync(join(scratch, "root"));
    mkdirAt(held, "안전", 0o700);
    const fd = openBeneath(held, "data", constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try {
      assert.equal(fstatSync(fd).mode & 0o777, 0o600, "openat must pass the requested creation mode through the actual ABI");
      writeFileSync(fd, "pinned");
    } finally { closeSync(fd); }
    linkAt(held, "data", held, "published");
    assert.throws(() => linkAt(held, "data", held, "published"), { code: "EEXIST" });
    renameAt(held, "data", held, "renamed");
    symlinkAt("\ufeff../밖", held, "link");
    assert.equal(readlinkAt(held, "link"), "\ufeff../밖");
    assert.deepEqual(readlinkBytesAt(held, "link"), Buffer.from("\ufeff../밖"));
    assert.deepEqual(directoryNames(held), ["link", "published", "renamed", "안전"]);
    assert.deepEqual(directoryNames(held), ["link", "published", "renamed", "안전"], "each listing owns an independent cursor");
    assert.equal(readFileSync(join(scratch, "moved", "published"), "utf8"), "pinned");
    assert.throws(() => readFileSync(join(scratch, "root", "published")), { code: "ENOENT" });
    assert.throws(() => unlinkAt(held, "../outside"), TypeError);
    unlinkAt(held, "link"); unlinkAt(held, "renamed"); unlinkAt(held, "published"); unlinkAt(held, "안전", true);
    assert.ok(fstatSync(held).isDirectory());
  } finally { closeSync(held); rmSync(scratch, { recursive: true, force: true }); }
});

test("entry metadata preserves nanoseconds and link identity without content access", () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "oma-native-stat-")));
  const held = openDirectory(scratch);
  try {
    const fd = openBeneath(held, "data", constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    let expected, expectedNumeric;
    try { writeFileSync(fd, "bytes"); fchmodSync(fd, 0); expected = fstatSync(fd, { bigint: true }); expectedNumeric = fstatSync(fd); }
    finally { closeSync(fd); }
    symlinkAt("data", held, "link");
    assert.deepEqual(statAt(held, "data", { bigint: true }), expected);
    assert.deepEqual(statAt(held, "data"), expectedNumeric);
    assert.equal(statAt(held, "link").isSymbolicLink(), true);
    assert.equal(statAt(held, "missing", { throwIfNoEntry: false }), undefined);
    assert.throws(() => statAt(held, "missing"), { code: "ENOENT" });
    assert.throws(() => statAt(held, "../data", { throwIfNoEntry: false }), TypeError);
  } finally { closeSync(held); rmSync(scratch, { recursive: true, force: true }); }
});

test("the real kernel process substrate feeds the shared ancestry and reuse policy", () => {
  const observe = process.platform === "darwin" ? observeDarwinProcess : observeLinuxProcess;
  const own = observe(process.pid);
  assert.equal(own.kind, "running"); assert.equal(own.ppid, process.ppid);
  const identity = hostProcessProbe.identity(process.pid);
  assert.ok(identity); assert.equal(hostProcessProbe.ended(identity), "running");
  assert.equal(hostProcessProbe.descendsFrom(process.pid, identity), true);
  assert.equal(hostProcessProbe.descendsFrom(process.pid, { ...identity, startTime: "wrong" }), false);
  assert.equal(hostProcessProbe.ended({ ...identity, startTime: "wrong" }), "ended");
  assert.deepEqual(observe(-1), { kind: "unavailable" });
});

test("restart breaker counts only within its monotonic window and remains bounded", () => {
  let now = 0; const policy = new RestartPolicy(5, 60000, () => now);
  for (const expected of [250, 500, 1000, 2000, 4000]) assert.deepEqual(policy.next(), { kind: "restart", delayMs: expected });
  assert.deepEqual(policy.next(), { kind: "exhausted", count: 5 });
  now = 60000; assert.equal(policy.next().kind, "exhausted");
  now = 60001; assert.deepEqual(policy.next(), { kind: "restart", delayMs: 250 });
  assert.throws(() => new RestartPolicy(-1), TypeError);
});
