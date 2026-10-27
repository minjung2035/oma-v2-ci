/** V32A: exercise the generator in its own history, not only this checkout's
 * dirty state. Historical review can certify only the bytes it reviewed. */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));

test("DR27/V32A: isolated history never certifies unstaged, staged, new or ignored bytes", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-review-history-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const git = (...args) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd: root, encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
  }).trim();
  const commit = message => git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
    "commit", "--no-gpg-sign", "-qm", message);
  for (const script of ["review-ledger.mjs", "review-closure.mjs"]) {
    mkdirSync(join(root, "scripts"), { recursive: true });
    copyFileSync(join(repo, "scripts", script), join(root, "scripts", script));
  }
  mkdirSync(join(root, "node_modules"));
  symlinkSync(join(repo, "node_modules/typescript"), join(root, "node_modules/typescript"), "dir");
  const historical = ["history", "unstaged", "staged", "bound"].map(name => `apps/oma/src/${name}.ts`);
  const unchanged = "apps/oma/src/unchanged.ts";
  const current = [...historical, unchanged, "apps/oma/src/new.ts", "apps/oma/src/ignored.ts"];
  for (const path of [...historical, unchanged]) put(path, "export const value = 1;\n");
  git("init", "-q", "--initial-branch=fixture");
  git("add", "apps"); commit("fixture baseline");
  const baseline = git("rev-parse", "HEAD");
  for (const path of historical) put(path, "export const value = 2;\n");
  git("add", "apps"); commit("WP32 reviewed fixture");
  put("production-files.txt", `${current.join("\n")}\n`);
  put("docs/archive/oma-v2-consistency-plan-b25961c/plan.json", JSON.stringify({ baseline_commit: baseline,
    tasks: [{ id: "WP32", tests: ["V32A"] }],
    production_review_assignments: current.map(path => ({ path, primary_review_task: "WP32" })),
  }));
  put("test/fixture.test.mjs", 'test("V32A: fixture oracle", () => {});\ntest("MAC-210: declared fixture oracle", () => {});\n');
  put("docs/macos-platform.md", "### 구현 현황\n| owner | `apps/oma/src/ignored.ts` | MAC-210 |\n**NOT_BUILT**\n");
  const notes = { lanes: {}, readUnchanged: [{ path: unchanged, by: ["WP32"], oracles: ["V32A"], note: "read baseline" }] };
  const writeNotes = () => put("implementation/review-notes.json", JSON.stringify(notes));
  writeNotes();
  const ledgerPath = join(root, "implementation/review-ledger.json");
  const run = () => {
    const child = spawnSync(process.execPath, [join(root, "scripts/review-ledger.mjs")], { cwd: root, encoding: "utf8", timeout: 10_000 });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, child.stderr);
    return new Map(JSON.parse(readFileSync(ledgerPath, "utf8")).files.map(entry => [entry.path, entry]));
  };
  let ledger = run();
  assert.equal(ledger.get(unchanged).status, "READ_UNCHANGED");
  // AV-20261003-30: every status derived from committed bytes is bound to
  // them, not only the explicitly reviewed changes.
  assert.equal(ledger.get(unchanged).sha256,
    createHash("sha256").update(readFileSync(join(root, unchanged))).digest("hex"));
  for (const path of historical) assert.equal(ledger.get(path).status, "CHANGED_WITH_ORACLE", path);
  for (const path of ["apps/oma/src/unstaged.ts", "apps/oma/src/staged.ts", "apps/oma/src/bound.ts", unchanged, "apps/oma/src/new.ts", "apps/oma/src/ignored.ts"])
    put(path, "export const value = 3;\n");
  git("add", "apps/oma/src/staged.ts");
  put(".gitignore", "apps/oma/src/ignored.ts\n");
  ledger = run();
  assert.equal(ledger.get("apps/oma/src/history.ts").status, "CHANGED_WITH_ORACLE");
  for (const path of current.filter(path => path !== "apps/oma/src/history.ts")) {
    assert.equal(ledger.get(path).status, "NOT_REVIEWED", path);
    assert.deepEqual(ledger.get(path).oracles, [], path);
  }
  notes.reviewedChanges = [{ path: "apps/oma/src/bound.ts", by: ["DR27"], oracles: ["V32A"], note: "reviewed current fixture",
    sha256: createHash("sha256").update(readFileSync(join(root, "apps/oma/src/bound.ts"))).digest("hex") }];
  writeNotes();
  ledger = run();
  assert.equal(ledger.get("apps/oma/src/bound.ts").status, "CHANGED_WITH_ORACLE");
  assert.equal(ledger.get("apps/oma/src/bound.ts").sha256, notes.reviewedChanges[0].sha256);
  const before = readFileSync(ledgerPath, "utf8");
  put("apps/oma/src/bound.ts", "export const value = 4;\n");
  const stale = spawnSync(process.execPath, [join(root, "scripts/review-ledger.mjs")], { cwd: root, encoding: "utf8", timeout: 10_000 });
  assert.equal(stale.error, undefined);
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /reviewed change is stale: apps\/oma\/src\/bound.ts/);
  assert.equal(readFileSync(ledgerPath, "utf8"), before, "a stale review never overwrites the previous ledger");

  // A claimed read-unchanged digest that is not the file's digest is refused
  // like a stale reviewed change: the claim does not bind the bytes read.
  git("checkout", "--", unchanged);
  notes.readUnchanged = [{ path: unchanged, by: ["WP32"], oracles: ["V32A"], note: "read baseline", sha256: "0".repeat(64) }];
  delete notes.reviewedChanges;
  writeNotes();
  const staleRead = spawnSync(process.execPath, [join(root, "scripts/review-ledger.mjs")],
    { cwd: root, encoding: "utf8", timeout: 10_000 });
  assert.equal(staleRead.error, undefined);
  assert.equal(staleRead.status, 1);
  assert.match(staleRead.stderr, /read-unchanged claim is stale: apps\/oma\/src\/unchanged\.ts/);
  assert.equal(readFileSync(ledgerPath, "utf8"), before);

  const authored = readFileSync(join(root, "implementation/review-notes.json"), "utf8");
  const invalidated = spawnSync(process.execPath, [join(root, "scripts/review-ledger.mjs"), "--invalidate-stale"],
    { cwd: root, encoding: "utf8", timeout: 10_000 });
  assert.equal(invalidated.status, 0, invalidated.stderr);
  const result = JSON.parse(readFileSync(ledgerPath, "utf8"));
  assert.equal(result.files.find(entry => entry.path === unchanged).status, "NOT_REVIEWED");
  assert.equal(result.files.find(entry => entry.path === unchanged).sha256, undefined);
  assert.ok(result.invalidatedReviews.some(entry => entry.path === unchanged && entry.sha256 === "0".repeat(64)));
  assert.equal(readFileSync(join(root, "implementation/review-notes.json"), "utf8"), authored,
    "invalidating a review must not rewrite or renew the original claim");
});
