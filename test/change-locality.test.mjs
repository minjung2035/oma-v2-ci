import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { changeLocality } from "../scripts/change-locality.mjs";

test("DR40: Change locality measures actual Git files, includes pending work, and keeps ownership separate", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-change-locality-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const write = (file, text) => { mkdirSync(join(root, file, ".."), { recursive: true }); writeFileSync(join(root, file), text); };
  git("init", "-q"); write("apps/oma/src/owned.ts", "first\n"); git("add", ".");
  const commit = () => git("-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture");
  commit(); const base = git("rev-parse", "HEAD").trim();
  write("apps/oma/src/owned.ts", "second\n"); git("add", "."); commit();
  write("test/untracked.test.mjs", "pending\n"); write("apps/oma/src/line\nbreak.ts", "pending\n");
  const inventory = [{ mutation: "probe", refs: [{ path: "apps/oma/src/owned.ts" }, { path: "apps/oma/src/unchanged.ts" }] }];
  const pending = changeLocality(root, base, undefined, inventory);
  assert.equal(pending.totalFiles, 3); assert.equal(pending.counts.source, 2); assert.equal(pending.counts.tests, 1);
  assert.ok(pending.changedFiles.includes("apps/oma/src/line\nbreak.ts"));
  assert.deepEqual(pending.ownerIntersections, [{ mutation: "probe", files: ["apps/oma/src/owned.ts"] }]);
  const committed = changeLocality(root, base, "HEAD", inventory);
  assert.deepEqual(committed.changedFiles, ["apps/oma/src/owned.ts"]);
  assert.equal(committed.totalFiles, 1); assert.notEqual(committed.to, "working-tree");
  assert.throws(() => changeLocality(root, "missing-revision"), /Command failed/);
});
