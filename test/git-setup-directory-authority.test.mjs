/** Disposable Git setup must not acquire listing/flush authority above its
 * workspace. Real POSIX permissions, Git, checkout and bundle verification. */
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GIT_ENV } from "@oma/process/policies";
import { exportRefForRequestKey } from "@oma/domain/derived";

for (const kind of ["candidate", "quarantine"]) test(`001. ${kind} setup keeps its effects below a search-only ancestor`, t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oma-git-setup-authority-")));
  const source = join(root, "source"), project = join(root, "project.git"), workspace = join(root, "workspace");
  const quarantine = join(root, "quarantine"), temporary = join(quarantine, "tmp"), bundle = join(quarantine, "input.bundle");
  t.after(() => { chmodSync(root, 0o700); rmSync(root, { recursive: true, force: true }); });
  mkdirSync(source); mkdirSync(workspace); mkdirSync(quarantine); mkdirSync(temporary);
  const env = { ...GIT_ENV, HOME: root, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
  const git = (...argv) => {
    const result = spawnSync("/usr/bin/git", argv, { cwd: source, env, encoding: "utf8", timeout: 10000 });
    assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "-q"); writeFileSync(join(source, "exact.txt"), "committed\r\n$literal\n");
  git("add", "."); git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD"); git("clone", "-q", "--bare", source, project);
  writeFileSync(join(source, "new.txt"), "new bytes"); git("add", "."); git("commit", "-qm", "candidate");
  const candidate = git("rev-parse", "HEAD"), exportRef = exportRefForRequestKey("setup-directory-authority");
  git("update-ref", exportRef, candidate); git("bundle", "create", bundle, exportRef, `^${base}`);
  const accepted = readFileSync(bundle), before = git("--git-dir", project, "show-ref");
  // Candidate needs this exact object; quarantine must import it from the
  // accepted thin bundle while preserving the canonical repository's refs.
  if (kind === "candidate") git("--git-dir", project, "fetch", "-q", source, candidate);
  chmodSync(root, 0o111);
  assert.throws(() => readdirSync(root), { code: "EACCES" });
  const input = kind === "candidate" ? { candidate, view: { git: "/usr/bin/git", project, workspace },
    argv: [process.execPath, "--input-type=module", "-e", `import {readFileSync} from 'node:fs';process.stdout.write(readFileSync('exact.txt'));`] }
    : { phase: "verify", candidate, exportRef, prerequisites: [base],
      view: { git: "/usr/bin/git", project, root: quarantine, bundle, temporary } };
  const module = import.meta.resolve(`@oma/git/${kind === "candidate" ? "candidate-check" : "quarantine-worker"}`);
  const script = `import {${kind === "candidate" ? "executeCandidateCheck" : "executeQuarantinePhase"}} from ${JSON.stringify(module)};
    await ${kind === "candidate" ? "executeCandidateCheck(JSON.parse(process.argv[1]),()=>{})" : "executeQuarantinePhase(JSON.parse(process.argv[1]))"};`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script, JSON.stringify(input)],
    { cwd: workspace, env, encoding: "utf8", timeout: 20000 });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, kind === "candidate" ? "committed\r\n$literal\n" : `${candidate}\n`);
  assert.equal(statSync(root).mode & 0o777, 0o111);
  assert.deepEqual(readFileSync(bundle), accepted);
  assert.equal(git("--git-dir", project, "show-ref"), before);
});
