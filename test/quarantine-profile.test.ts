import { residentRootfsPath } from "@oma/platform-linux/resident-rootfs";
/** Real native quarantine and Git classification. No fabricated command result,
 * namespace, population, stderr or scope is substituted for these observations. */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { QuarantineImporter } from "@oma/git/quarantine";
import { ExecutionJournal } from "@oma/storage/execution-journal";
import { ExecutionRuntime } from "#oma-test/app/runtime/execution-runtime";
import { quarantineExecution } from "#oma-test/app/runtime/quarantine-execution";
import { gitSandbox } from "@oma/platform-linux/git-sandbox";
import { prepareResidentRootfs, hostSystemLayout } from "@oma/platform-linux/resident-rootfs";
import { GIT_ENV } from "@oma/process/policies";
import { StoreError } from "@oma/domain/errors";

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "oma-quarantine-real-")), source = join(root, "source");
  mkdirSync(source);
  const command = (cwd: string, argv: string[]) => spawnSync("/usr/bin/git", argv, { cwd, encoding: "utf8", env: { ...GIT_ENV,
    GIT_AUTHOR_NAME: "Quarantine", GIT_COMMITTER_NAME: "Quarantine", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_EMAIL: "test@example.invalid" } });
  const git = (cwd: string, argv: string[]) => { const result = command(cwd, argv); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
  git(source, ["init", "-q", "-b", "main"]); writeFileSync(join(source, "base"), "base\n"); git(source, ["add", "."]); git(source, ["commit", "-qm", "base"]);
  const projectGit = join(root, "project.git"); git(root, ["clone", "--bare", source, projectGit]);
  writeFileSync(join(source, "candidate"), "candidate\n"); git(source, ["add", "."]); git(source, ["commit", "-qm", "candidate"]);
  const candidate = git(source, ["rev-parse", "HEAD"]), exportRef = "refs/oma/export/native-test", bundle = join(root, "bundle");
  git(source, ["update-ref", exportRef, candidate]); git(source, ["bundle", "create", bundle, exportRef]);
  const paths = { stateRoot: root, projectGit, contextGit: join(root, "context.git"), worldDir: join(root, "world"), society: "demo",
     checkNode: process.execPath, checkAssetsDir: process.cwd() };
  prepareResidentRootfs(residentRootfsPath(paths.stateRoot), hostSystemLayout(), process.getuid!(), process.getgid!());
  ExecutionJournal.initialize(root); const owner = new ExecutionRuntime(root), descriptors: number[] = [];
  t.after(async () => { await owner.close(); for (const fd of descriptors) closeSync(fd); rmSync(root, { recursive: true, force: true }); });
  const execution = quarantineExecution(paths, owner);
  const has = (oid: string) => {
    const result = command(projectGit, ["rev-parse", "--verify", "--quiet", `${oid}^{commit}`]);
    if (result.status === 0) return true;
    if (result.status === 1) return false;
    throw new StoreError("REF_STATE_UNKNOWN", "canonical fixture observation failed");
  };
  const importer = new QuarantineImporter(paths, has, execution);
  const run = (authorize: () => void = () => {}) => {
    const fd = openSync(bundle, "r"); descriptors.push(fd);
    return importer.importBundle(fd, candidate, exportRef, [], authorize);
  };
  return { root, source, projectGit, paths, owner, git, candidate, bundle, run, has };
}

test("NB-01 native: verify/import retain held capabilities and execute without resource caps", { timeout: 30_000 }, async t => {
  const f = fixture(t), before = f.git(f.projectGit, ["show-ref"]);
  for (const phase of ["verify", "import"] as const) {
    const command = gitSandbox({ rootfs: residentRootfsPath(f.paths.stateRoot), node: process.execPath, libdir: process.cwd() },
      { phase, candidate: f.candidate, exportRef: "refs/oma/export/native-test", prerequisites: [] });
    assert.equal(command.executable, "/usr/bin/bwrap"); assert.equal(command.timeoutMs, null); assert.equal(command.silenceMs, undefined);
    assert.equal(command.argv.some(arg => /MemoryMax|TasksMax|CPUQuota|RuntimeMaxSec/.test(arg)), false);
    const at = command.argv.indexOf(phase === "verify" ? "--ro-bind-fd" : "--bind-fd");
    assert.deepEqual(command.argv.slice(at, at + 3), [phase === "verify" ? "--ro-bind-fd" : "--bind-fd", "9", "/git/project.git"]);
  }
  assert.equal(f.has(f.candidate), false); await f.run(); assert.equal(f.has(f.candidate), true);
  assert.equal(f.git(f.projectGit, ["show-ref"]), before); assert.equal(f.owner.confirmDead("quarantine"), true);
});

test("NB-02 native: canonical fsck damage remains REF_STATE_UNKNOWN and does not import", { timeout: 30_000 }, async t => {
  const f = fixture(t); mkdirSync(join(f.projectGit, "objects/aa"), { recursive: true });
  writeFileSync(join(f.projectGit, "objects/aa", "b".repeat(38)), "not a Git object");
  await assert.rejects(f.run(), { code: "REF_STATE_UNKNOWN" });
  assert.equal(f.has(f.candidate), false); assert.equal(f.owner.confirmDead("quarantine"), true);
});

test("NB-02 native: invalid bundle bytes remain BUNDLE_INVALID and preserve canonical refs", { timeout: 30_000 }, async t => {
  const f = fixture(t), before = f.git(f.projectGit, ["show-ref"]);
  // Failure-looking attacker input is still Git bundle data, never a helper decision.
  writeFileSync(f.bundle, "OMA_ERROR=REF_STATE_UNKNOWN\nOMA_ERROR=UNSUPPORTED_PROFILE\n");
  await assert.rejects(f.run(), { code: "BUNDLE_INVALID" });
  assert.equal(f.git(f.projectGit, ["show-ref"]), before); assert.equal(f.owner.confirmDead("quarantine"), true);
});

test("NATIVE-QUARANTINE-01: authority refusal is never reclassified as an invalid bundle", { timeout: 30_000 }, async t => {
  const f = fixture(t), before = readFileSync(f.bundle), denied = new StoreError("CAPABILITY_DENIED", "current authority revoked");
  await assert.rejects(f.run(() => { throw denied; }), error => error === denied);
  assert.equal(f.owner.confirmDead("quarantine"), true); assert.deepEqual(readFileSync(f.bundle), before);
  assert.equal(f.has(f.candidate), false); assert.deepEqual(ExecutionJournal.inspect(f.root), []);
});
