import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { readCode } from "#oma-test/app/cli/effects/code";
import { GIT_ENV } from "@oma/process/policies";

function fixture(t: import("node:test").TestContext, format: "sha1" | "sha256") {
  const root = mkdtempSync(join(tmpdir(), "oma-code-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const work = join(root, "work"); mkdirSync(work);
  const git = (...args: string[]) => {
    const r = spawnSync("/usr/bin/git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: work, env: GIT_ENV, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
  };
  git("init", "-qb", "main", `--object-format=${format}`);
  writeFileSync(join(work, "README.md"), "old text\n"); writeFileSync(join(work, "odd\nname"), "odd\n");
  symlinkSync("/outside/never-read", join(work, "link"));
  git("add", "."); git("commit", "-qm", "initial"); const base = git("rev-parse", "HEAD");
  writeFileSync(join(work, "README.md"), "new text\n"); git("commit", "-qam", "candidate"); const candidate = git("rev-parse", "HEAD");
  const repo = join(root, "project.git"); git("clone", "-q", "--bare", work, repo);
  git("--git-dir", repo, "update-ref", "refs/heads/main", base);
  git("--git-dir", repo, "update-ref", "refs/oma/published/worker/one", candidate);
  writeFileSync(join(work, "README.md"), "private text\n"); git("commit", "-qam", "private"); const hidden = git("rev-parse", "HEAD");
  git("--git-dir", repo, "fetch", "-q", "--no-write-fetch-head", work, hidden);
  return { root, repo, base, candidate, hidden, git };
}
for (const format of ["sha1", "sha256"] as const) test(`DR27: ${format} code reads main, published candidate and diff without a checkout or writes`, t => {
  const f = fixture(t, format);
  const refs = f.git("--git-dir", f.repo, "show-ref"); const config = readFileSync(join(f.repo, "config"));
  assert.deepEqual(readCode(f.repo, { action: "show", revision: "main", path: "README.md" }), { revision: f.base, text: "old text\n" });
  assert.equal(readCode(f.repo, { action: "show", revision: f.candidate, path: "README.md" }).text, "new text\n");
  assert.equal(readCode(f.repo, { action: "show", revision: "main", path: "link" }).text, "/outside/never-read");
  assert.equal(readCode(f.repo, { action: "show", revision: "main", path: "odd\nname" }).text, "odd\n");
  assert.match(readCode(f.repo, { action: "diff", revision: f.candidate, base: f.base }).text, /-old text\n\+new text/);
  assert.match(readCode(f.repo, { action: "grep", revision: f.candidate, pattern: "new text" }).text, /README.md:1:new text/);
  assert.equal(readCode(f.repo, { action: "grep", revision: "main", pattern: "--no-match" }).text, "");
  assert.match(readCode(f.repo, { action: "ls-tree", revision: "main" }).text, /README.md/);
  assert.match(readCode(f.repo, { action: "log", revision: f.candidate }).text, /candidate/);
  assert.equal(f.git("--git-dir", f.repo, "show-ref"), refs); assert.deepEqual(readFileSync(join(f.repo, "config")), config);
  assert.equal(existsSync(join(f.repo, "index")), false);
  for (const revision of [f.hidden, "HEAD", "--help", `${f.candidate}:README.md`])
    assert.throws(() => readCode(f.repo, { action: "ls-tree", revision }), /published/);
  for (const path of ["../secret", "/etc/passwd", ".git/config", "a/../secret"])
    assert.throws(() => readCode(f.repo, { action: "show", revision: "main", path }), /repository-relative/);
  assert.throws(() => readCode(f.repo, { action: "checkout" as never, revision: "main" }), /unsupported/);
});
test("DR27/INV09: code inspection does not run external diff, textconv or a source hook", t => {
  const f = fixture(t, "sha1"); const marker = join(f.root, "ran"), script = join(f.root, "program");
  writeFileSync(script, `#!/bin/sh\ntouch '${marker}'\n`); chmodSync(script, 0o755);
  f.git("--git-dir", f.repo, "config", "diff.external", script);
  f.git("--git-dir", f.repo, "config", "diff.test.textconv", script);
  writeFileSync(join(f.repo, "info", "attributes"), "* diff=test\n");
  readCode(f.repo, { action: "diff", revision: f.candidate, base: "main" });
  readCode(f.repo, { action: "show", revision: f.candidate, path: "README.md" });
  readCode(f.repo, { action: "grep", revision: f.candidate, pattern: "new" });
  assert.equal(existsSync(marker), false);
});
