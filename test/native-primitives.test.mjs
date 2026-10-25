import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, mkdirSync, closeSync, constants, readFileSync, writeFileSync, rmSync, renameSync, fchmodSync, fstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDirectory, openBeneath } from "@oma/native/files";
import { directoryNames, mkdirAt, unlinkAt, linkAt, renameAt, readlinkAt, readlinkBytesAt, statAt, symlinkAt } from "@oma/native/posix-files";
import { observeDarwinProcess, observeLinuxProcess } from "@oma/native/process-observation";
import { hostProcessProbe } from "@oma/broker/process-ancestry";
import { RestartPolicy } from "@oma/process/restart-policy";

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

test("entry metadata preserves nanoseconds and link identity; an unverified substrate refuses", () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "oma-native-stat-")));
  const held = openDirectory(scratch);
  try {
    const fd = openBeneath(held, "data", constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    let expected;
    try { writeFileSync(fd, "bytes"); fchmodSync(fd, 0); expected = fstatSync(fd, { bigint: true }); }
    finally { closeSync(fd); }
    symlinkAt("data", held, "link");
    if (process.platform === "darwin") {
      // This is the actual current refusal, recorded separately from G-FILES.
      // It never treats an I/O open as the missing permission-independent pin.
      assert.throws(() => statAt(held, "data"), { code: "UNSUPPORTED_PROFILE" });
    } else {
      assert.deepEqual(statAt(held, "data", { bigint: true }), expected);
      assert.equal(statAt(held, "link").isSymbolicLink(), true);
      assert.equal(statAt(held, "missing", { throwIfNoEntry: false }), undefined);
      assert.throws(() => statAt(held, "missing"), { code: "ENOENT" });
    }
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
