import test from "node:test";
import assert from "node:assert/strict";
import { closeSync, constants, mkdirSync, mkdtempSync, openSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errno, load } from "koffi";
import { openDirectory } from "@oma/native/files";
import { assertNoExtendedAttributesAt } from "@oma/native/posix-files";

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
  const root = mkdtempSync(join(tmpdir(), "oma-directory-xattr-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "held"); mkdirSync(dir);
  const fd = openDirectory(dir); t.after(() => closeSync(fd));
  return { root, dir, fd };
}

test("directory xattrs: actual zero-length attributes prevent reclamation and empty entries pass", t => {
  const { dir, fd } = fixture(t);
  writeFileSync(join(dir, "empty"), "data"); writeFileSync(join(dir, "attributed"), "data");
  attribute(join(dir, "attributed"));
  assertNoExtendedAttributesAt(fd, "empty");
  assert.throws(() => assertNoExtendedAttributesAt(fd, "attributed"), /has extended attributes; retained/);
});

test("directory xattrs: parent rename and pathname replacement preserve the held directory observation", t => {
  const { root, dir, fd } = fixture(t);
  writeFileSync(join(dir, "empty"), "data"); writeFileSync(join(dir, "attributed"), "data");
  attribute(join(dir, "attributed"));
  renameSync(dir, join(root, "moved")); mkdirSync(dir);
  writeFileSync(join(dir, "empty"), "replacement"); attribute(join(dir, "empty"));
  writeFileSync(join(dir, "attributed"), "replacement");
  const cwd = process.cwd();
  assertNoExtendedAttributesAt(fd, "empty");
  assert.throws(() => assertNoExtendedAttributesAt(fd, "attributed"), /has extended attributes; retained/);
  assert.equal(process.cwd(), cwd, "the Node host cwd is unchanged");
});

test("directory xattrs: final and dangling symlinks are observed without following their targets", t => {
  const { root, dir, fd } = fixture(t);
  writeFileSync(join(root, "outside"), "outside"); attribute(join(root, "outside"));
  symlinkSync(join(root, "outside"), join(dir, "link"));
  symlinkSync(join(root, "missing"), join(dir, "dangling"));
  assertNoExtendedAttributesAt(fd, "link"); assertNoExtendedAttributesAt(fd, "dangling");
});

test("directory xattrs: missing entries and invalid directory capabilities never become empty observations", t => {
  const { dir, fd } = fixture(t); writeFileSync(join(dir, "file"), "data");
  assert.throws(() => assertNoExtendedAttributesAt(fd, "missing"), /could not be observed/);
  const file = openSync(join(dir, "file"), constants.O_RDONLY);
  try { assert.throws(() => assertNoExtendedAttributesAt(file, "file"), /could not be observed/); }
  finally { closeSync(file); }
  // No intervening opens can reuse the descriptor between close and the call.
  assert.throws(() => assertNoExtendedAttributesAt(file, "file"));
  for (const name of ["", ".", "..", "../outside", "file/child", "bad\0name"])
    assert.throws(() => assertNoExtendedAttributesAt(fd, name), TypeError);
});
