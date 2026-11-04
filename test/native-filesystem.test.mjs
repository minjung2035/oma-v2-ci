/** Actual Darwin statfs observation, not a simulated NFS/mount qualification. */
import test from "node:test";
import assert from "node:assert/strict";
import { closeSync, mkdtempSync, openSync, realpathSync, renameSync, rmSync, statfsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { openDirectory } from "@oma/native/files";
import { darwinDirectoryFilesystem } from "@oma/native/directory-layout";

test("001. Actual Darwin filesystem flags and name match C and Node on held directories after rename", t => {
  if (process.platform !== "darwin") return assert.throws(() => darwinDirectoryFilesystem(0), { code: "UNSUPPORTED_PROFILE" });
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oma-filesystem-"))), moved = root + "-moved", executable = join(root, "observe");
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(moved, { recursive: true, force: true }); });
  const compile = spawnSync("/usr/bin/clang", ["-Wall", "-Wextra", "-Werror", fileURLToPath(new URL("./fixtures/darwin-filesystem.c", import.meta.url)), "-o", executable], { encoding: "utf8", timeout: 30000 });
  assert.equal(compile.status, 0, compile.stderr);
  for (const path of [root, "/"]) {
    const fd = openDirectory(path);
    try {
      const result = spawnSync(executable, [path], { encoding: "utf8", timeout: 5000 });
      assert.equal(result.status, 0, result.stderr); const observed = darwinDirectoryFilesystem(fd);
      assert.deepEqual(observed, JSON.parse(result.stdout)); assert.equal(observed.type, statfsSync(path).type);
      assert.equal(Object.isFrozen(observed), true);
      if (path === root) {
        assert.equal(observed.local, true); assert.equal(observed.readOnly, false);
        renameSync(root, moved); assert.deepEqual(darwinDirectoryFilesystem(fd), observed); renameSync(moved, root);
      }
    } finally { closeSync(fd); }
  }
  const file = openSync(executable, "r");
  try { assert.throws(() => darwinDirectoryFilesystem(file), TypeError); } finally { closeSync(file); }
  assert.throws(() => darwinDirectoryFilesystem(-1), TypeError);
});
