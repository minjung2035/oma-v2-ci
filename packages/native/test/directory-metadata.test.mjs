import test, { before, after } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { closeSync, constants, mkdirSync, mkdtempSync, openSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errno, load } from "koffi";
import { openDirectory } from "@oma/native/files";
import { assertNoUnpreservedMetadataAt } from "@oma/native/posix-files";

// Test setup writes a real filesystem attribute through this host's public
// ABI. Neither the OS nor the metadata reader is replaced by a test double.
const libc = load(null);
const setters = {
  linux: () => (path, key, value) => libc.func("int setxattr(const char *, const char *, const void *, size_t, int)")(path, key, value, value.length, 0),
  darwin: () => (path, key, value) => libc.func("int setxattr(const char *, const char *, const void *, size_t, unsigned int, int)")(path, key, value, value.length, 0, 0),
};
const setAttribute = setters[process.platform]();
function attribute(path) {
  assert.equal(setAttribute(path, "user.oma-directory-observation", Buffer.alloc(0)), 0, `setxattr errno ${errno()}`);
}
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oma-directory-xattr-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "held"); mkdirSync(dir);
  const fd = openDirectory(dir); t.after(() => closeSync(fd));
  return { root, dir, fd };
}

test("directory metadata: actual zero-length attributes prevent reclamation and empty entries pass", t => {
  const { dir, fd } = fixture(t);
  writeFileSync(join(dir, "empty"), "data"); writeFileSync(join(dir, "attributed"), "data");
  attribute(join(dir, "attributed"));
  assertNoUnpreservedMetadataAt(fd, "empty");
  assert.throws(() => assertNoUnpreservedMetadataAt(fd, "attributed"), /has unpreserved metadata; retained/);
});

test("directory metadata: parent rename and pathname replacement preserve the held directory observation", t => {
  const { root, dir, fd } = fixture(t);
  writeFileSync(join(dir, "empty"), "data"); writeFileSync(join(dir, "attributed"), "data");
  attribute(join(dir, "attributed"));
  renameSync(dir, join(root, "moved")); mkdirSync(dir);
  writeFileSync(join(dir, "empty"), "replacement"); attribute(join(dir, "empty"));
  writeFileSync(join(dir, "attributed"), "replacement");
  const cwd = process.cwd();
  assertNoUnpreservedMetadataAt(fd, "empty");
  assert.throws(() => assertNoUnpreservedMetadataAt(fd, "attributed"), /has unpreserved metadata; retained/);
  assert.equal(process.cwd(), cwd, "the Node host cwd is unchanged");
});

test("directory metadata: final and dangling symlinks are observed without following their targets", t => {
  const { root, dir, fd } = fixture(t);
  writeFileSync(join(root, "outside"), "outside"); attribute(join(root, "outside"));
  symlinkSync(join(root, "outside"), join(dir, "link"));
  symlinkSync(join(root, "missing"), join(dir, "dangling"));
  assertNoUnpreservedMetadataAt(fd, "link"); assertNoUnpreservedMetadataAt(fd, "dangling");
});

test("directory metadata: missing entries and invalid directory capabilities never become empty observations", t => {
  const { dir, fd } = fixture(t); writeFileSync(join(dir, "file"), "data");
  assert.throws(() => assertNoUnpreservedMetadataAt(fd, "missing"), /could not be observed/);
  const file = openSync(join(dir, "file"), constants.O_RDONLY);
  try { assert.throws(() => assertNoUnpreservedMetadataAt(file, "file"), /could not be observed/); }
  finally { closeSync(file); }
  // No intervening opens can reuse the descriptor between close and the call.
  assert.throws(() => assertNoUnpreservedMetadataAt(file, "file"));
  for (const name of ["", ".", "..", "../outside", "file/child", "bad\0name"])
    assert.throws(() => assertNoUnpreservedMetadataAt(fd, name), TypeError);
});

// These cases require actual Darwin metadata and are registered only there.
// Linux grammar and xattr passes never claim that these OS cases ran.
if (process.platform === "darwin") {
  let helper, build;
  before(() => {
    build = mkdtempSync(join(tmpdir(), "oma-darwin-metadata-setup-"));
    helper = join(build, "setup");
    const result = spawnSync("/usr/bin/xcrun", ["clang", "-Wall", "-Wextra", "-Werror", "-O2",
      fileURLToPath(new URL("./fixtures/darwin-metadata.c", import.meta.url)), "-o", helper], { encoding: "utf8", timeout: 60000 });
    assert.ifError(result.error); assert.equal(result.signal, null); assert.equal(result.status, 0, result.stderr);
  });
  after(() => { if (build) rmSync(build, { recursive: true, force: true }); });
  const setup = (operation, path) => {
    const result = spawnSync(helper, [operation, path], { encoding: "utf8", timeout: 10000 });
    assert.ifError(result.error); assert.equal(result.signal, null); assert.equal(result.status, 0, result.stderr);
  };
  for (const [operation, label, directory] of [["flags", "BSD flags", false], ["acl", "extended ACL", false], ["empty-acl-flags", "empty ACL with flags", true]])
    test(`Darwin metadata: ${label} refuses reclamation without following an outside target`, t => {
      const { root, dir, fd } = fixture(t), target = join(root, "outside");
      if (directory) mkdirSync(target); else writeFileSync(target, "outside");
      const outside = openDirectory(root); t.after(() => closeSync(outside));
      assertNoUnpreservedMetadataAt(outside, "outside");
      setup(operation, target);
      assert.throws(() => assertNoUnpreservedMetadataAt(outside, "outside"), /has unpreserved metadata; retained/);
      symlinkSync(target, join(dir, "link"));
      assertNoUnpreservedMetadataAt(fd, "link");
    });
  test("Darwin metadata: a real resource fork prevents reclamation", t => {
    const { dir, fd } = fixture(t), path = join(dir, "fork"); writeFileSync(path, "data");
    const value = Buffer.from("resource-fork-bytes");
    assert.equal(setAttribute(path, "com.apple.ResourceFork", value), 0, `resource fork errno ${errno()}`);
    assert.throws(() => assertNoUnpreservedMetadataAt(fd, "fork"), /has unpreserved metadata; retained/);
  });
}
