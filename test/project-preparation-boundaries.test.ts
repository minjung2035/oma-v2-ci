/** DR27/P0-4/P0-7: local snapshot ownership, never a VM or manager probe. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs, { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareProjectDirectory } from "@oma/git/project-preparation";
import { collectLeasedTree } from "@oma/storage/tree-lease";

for (const point of ["prepared", "released", "collected"] as const) {
  test(`DR27/P0-7: snapshot preparation SIGKILL after ${point} keeps ownership recoverable`, t => {
    const root = mkdtempSync(join(tmpdir(), "oma-preparation-crash-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const tree = join(root, "snapshot");
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { prepareProjectDirectory } from ${JSON.stringify(new URL(import.meta.resolve("@oma/git/project-preparation"), import.meta.url).href)};
      import { TreeLease } from ${JSON.stringify(new URL(import.meta.resolve("@oma/storage/tree-lease"), import.meta.url).href)};
      const owner = prepareProjectDirectory(${JSON.stringify(tree)});
      const point = ${JSON.stringify(point)};
      if (point === "prepared") process.kill(process.pid, "SIGKILL");
      const release = TreeLease.prototype.release;
      TreeLease.prototype.release = function() {
        release.call(this);
        if (point === "released") process.kill(process.pid, "SIGKILL");
      };
      owner.dispose();
      process.kill(process.pid, "SIGKILL");
    `], { encoding: "utf8", timeout: 10_000 });
    assert.equal(child.error, undefined);
    assert.equal(child.signal, "SIGKILL", child.stderr);
    assert.equal(existsSync(tree), point !== "collected");
    assert.equal(existsSync(`${tree}.lease`), point !== "collected");
    if (point !== "collected") assert.deepEqual(collectLeasedTree(tree), { kind: "quiescent" });
    assert.deepEqual(readdirSync(root), []);
    const next = prepareProjectDirectory(tree);
    assert.deepEqual(collectLeasedTree(tree), { kind: "active" }, "new ownership must not be removed as stale");
    next.dispose(); assert.deepEqual(readdirSync(root), []);
  });
}

test("DR27/P0-4: failed preparation handoff releases its lease and collects only its own tree", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-preparation-handoff-"));
  const tree = join(root, "snapshot");
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); rmSync(root, { recursive: true, force: true }); });
  const before = readdirSync("/proc/self/fd").length;
  const close = fs.closeSync;
  const failure = new Error("parent close failed after creating tree");
  let injected = false;
  t.mock.method(fs, "closeSync", (fd: number) => {
    const parent = fs.readlinkSync(`/proc/self/fd/${fd}`);
    close(fd);
    // mkdirat created the owned tree before its held parent is returned.
    if (parent === root && existsSync(tree) && !injected) { injected = true; throw failure; }
  });
  syncBuiltinESMExports();
  assert.throws(() => prepareProjectDirectory(tree), error => error === failure);
  assert.equal(injected, true);
  assert.deepEqual(readdirSync(root), []);
  assert.equal(readdirSync("/proc/self/fd").length, before);
  t.mock.restoreAll(); syncBuiltinESMExports();
  prepareProjectDirectory(tree).dispose(); assert.deepEqual(readdirSync(root), []);
});
