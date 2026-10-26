import test from "node:test";
import assert from "node:assert/strict";
import fs, { closeSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync, type Stats } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SnapshotReader } from "@oma/native/snapshot-reader";

const count = () => readdirSync("/proc/self/fd").length;
function fixture(t: import("node:test").TestContext) {
  const root = mkdtempSync(join(tmpdir(), "oma-snapshot-fds-"));
  mkdirSync(join(root, "a", "b"), { recursive: true }); writeFileSync(join(root, "a", "b", "file"), "bytes");
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); rmSync(root, { recursive: true, force: true }); });
  return root;
}
function failClose(t: import("node:test").TestContext, at: number) {
  const real = fs.closeSync; const calls: number[] = []; const failure = new Error("close failed after releasing descriptor");
  t.mock.method(fs, "closeSync", (fd: number) => { calls.push(fd); real(fd); if (calls.length === at) throw failure; });
  syncBuiltinESMExports();
  return { calls, failure };
}
/** Select the resource being returned, independent of how many intermediate
 * parents the platform opens. Read metadata through the unmocked observer. */
function failResourceClose(t: import("node:test").TestContext, identity: Stats, stat = fs.fstatSync) {
  const real = fs.closeSync, failure = new Error("resource close failed after releasing descriptor");
  let triggered = false;
  t.mock.method(fs, "closeSync", (fd: number) => {
    const held = stat(fd), selected = !triggered && held.dev === identity.dev && held.ino === identity.ino;
    real(fd);
    if (selected) { triggered = true; throw failure; }
  });
  syncBuiltinESMExports();
  return { failure, get triggered() { return triggered; } };
}

test("DR27/P0-4: a constructor close failure releases its newly acquired directory exactly once", t => {
  const root = fixture(t); const before = count(); const fault = failClose(t, 1);
  assert.throws(() => new SnapshotReader(root), error => error === fault.failure);
  assert.equal(count(), before);
  assert.equal(fault.calls.length, 2); assert.notEqual(fault.calls[0], fault.calls[1]);
});

for (const phase of ["readable handoff", "parent return"] as const) {
  test(`DR27/P0-4: ${phase} failure closes every still-owned descriptor`, t => {
    const root = fixture(t); const reader = new SnapshotReader(root); t.after(() => reader.close());
    const before = count(), resource = join(root, "a", "b", ...(phase === "readable handoff" ? ["file"] : []));
    const fault = failResourceClose(t, fs.statSync(resource));
    assert.throws(() => {
      const entry = reader.entry("a/b/file");
      if (entry !== null) closeSync(entry.descriptor);
    }, error => error === fault.failure);
    assert.equal(fault.triggered, true);
    assert.equal(count(), before);
    reader.close(); reader.close();
    assert.equal(count(), before - 1);
    assert.throws(() => reader.entry("a/b/file"), /reader is closed/);
  });
}

for (const linked of [false, true]) test(`DR27/P0-4: ${linked ? "linked" : "missing"} parent resolution leaves no descriptors behind`, t => {
  const root = fixture(t), reader = new SnapshotReader(root); t.after(() => reader.close());
  if (linked) symlinkSync(join(root, "a", "b"), join(root, "a", "other"));
  const before = count();
  if (linked) assert.throws(() => reader.entry("a/other/file"), { code: "STORE_CORRUPT" });
  else assert.equal(reader.entry("a/other/file"), null);
  assert.equal(count(), before);
});

test("DR27/P0-4: a failed reader close is not retried on a recycled descriptor number", t => {
  const root = fixture(t); const reader = new SnapshotReader(root);
  const before = count(); const fault = failClose(t, 1);
  assert.throws(() => reader.close(), error => error === fault.failure);
  reader.close();
  assert.equal(fault.calls.length, 1); assert.equal(count(), before - 1);
});

test("DR27/P0-5: a failed entry read and failed cleanup retain both errors, and close the parent", t => {
  const root = fixture(t); const reader = new SnapshotReader(root); t.after(() => reader.close());
  const before = count(), realStat = fs.fstatSync, readFailure = new Error("entry stat failed");
  const fault = failResourceClose(t, fs.statSync(join(root, "a", "b", "file")), realStat);
  t.mock.method(fs, "fstatSync", ((fd: number, options?: object) => {
    if (fd !== reader.descriptor) throw readFailure;
    return realStat(fd, options as never);
  }) as typeof fs.fstatSync);
  syncBuiltinESMExports();
  assert.throws(() => reader.entry("a/b/file"), error => {
    assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [readFailure, fault.failure]); return true;
  });
  assert.equal(fault.triggered, true); assert.equal(count(), before);
  reader.close(); assert.equal(count(), before - 1);
});
