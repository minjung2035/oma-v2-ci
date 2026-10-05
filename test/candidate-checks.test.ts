import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CandidateChecks, candidateCheckCommand, CHECK_CHECKOUT } from "../src/runtime/candidate-checks.js";
import { snapshotIntegrationPolicy } from "../src/git/integration-policy.js";
import { StoreError } from "../src/domain/errors.js";
import { GIT_ENV, runGitText } from "../src/process/policies.js";
import { runProcess, type ProcessObservation } from "../src/process/run.js";

const resources = { memoryBytes: 64 * 1024 * 1024, tasks: 32, cpuQuotaPercent: 25, tmpBytes: 1024 * 1024,
  workspaceBytes: 2 * 1024 * 1024, stagingBytes: 1024 * 1024, checkTimeoutSeconds: 1 };
const check = snapshotIntegrationPolicy({ policyRevision: "p1", protectedPaths: [], checks: [
  { id: "exact", argv: ["/bin/test", "literal $variable", "=", "literal $variable"], env: { CHECK: "selected" },
    timeoutSeconds: 1, tmpBytes: resources.tmpBytes, resources }],
}).checks[0]!;
const paths = { stateRoot: "/tmp/oma-checks", projectGit: "/tmp/oma-checks/project.git", contextGit: "/tmp/oma-checks/context.git",
  society: "demo", worldDir: "/tmp/oma-checks/world", quarantineTmpBytes: 1,
  checkRootfs: "/tmp/oma-checks/rootfs", checkNode: process.execPath, checkAssetsDir: "/tmp/oma-check-assets" };
const candidate = "a".repeat(40);
const code = (expected: string) => (error: unknown) => error instanceof StoreError && error.code === expected;

test("DR29/INT-002: trusted checks bound the entire tree and both writable mounts without host credentials or sockets", () => {
  const command = candidateCheckCommand(paths, candidate, check, ["/usr", "/lib"]);
  assert.equal(command.executable, "/usr/bin/systemd-run");
  for (const flag of ["--wait", "--pipe", "--collect", "--expand-environment=no", "--property=ExitType=cgroup",
    "--property=MemoryMax=67108864", "--property=MemorySwapMax=0", "--property=TasksMax=32",
    "--property=CPUQuota=25%", "--property=RuntimeMaxSec=1s", "--property=KillMode=control-group"])
    assert.ok(command.argv.includes(flag), flag);
  const at = command.argv.indexOf("/usr/bin/bwrap"); const sandbox = command.argv.slice(at);
  assert.ok(at > 0);
  for (const flag of ["--unshare-all", "--new-session", "--die-with-parent", "--clearenv"]) assert.ok(sandbox.includes(flag));
  assert.deepEqual(sandbox.slice(sandbox.indexOf("--seccomp"), sandbox.indexOf("--seccomp") + 2), ["--seccomp", "0"]);
  assert.ok(Buffer.isBuffer(command.input) && command.input.length > 0);
  assert.equal(sandbox.includes("--bind"), false, "no writable host directory");
  assert.deepEqual(sandbox.slice(sandbox.indexOf("--size"), sandbox.indexOf("--size") + 8),
    ["--size", "2097152", "--tmpfs", "/workspace", "--size", "1048576", "--tmpfs", "/tmp"]);
  assert.ok(command.argv.some(arg => arg.includes("memory.max") && arg.includes("pids.max") && arg.includes("cpu.max")),
    "actual kernel limits are checked before candidate execution");
  assert.equal(command.env.OMA_PRINCIPAL_TOKEN, undefined);
  assert.deepEqual(sandbox.slice(-check.argv.length), check.argv);
  assert.equal(candidateCheckCommand(paths, "b".repeat(40), check, ["/usr"]).argv.find(arg => arg.startsWith("--unit=")),
    command.argv.find(arg => arg.startsWith("--unit=")), "a retry cannot bypass an uncertain tree with a fresh unit name");
  assert.throws(() => candidateCheckCommand(paths, candidate, check, ["/home"]), code("UNSUPPORTED_PROFILE"));
  assert.throws(() => candidateCheckCommand({ ...paths, checkRootfs: "/" }, candidate, check, []), code("UNSUPPORTED_PROFILE"));
  assert.throws(() => candidateCheckCommand(paths, candidate, { ...check, argv: [] }, []), code("UNSUPPORTED_PROFILE"));
  assert.throws(() => candidateCheckCommand(paths, candidate, { ...check, resources: { ...resources, tmpBytes: 0 } }, []), code("UNSUPPORTED_PROFILE"));
});

test("DR29/INT-007/P0-5: only an observed successful manager wait permits CAS", async () => {
  for (const [kind, exitCode, expected] of [["exited", 0, null], ["exited", 1, "CHECK_FAILED"],
    ["timed-out", null, "REF_STATE_UNKNOWN"], ["spawn-failed", null, "REF_STATE_UNKNOWN"],
    ["output-limited", null, "REF_STATE_UNKNOWN"], ["signalled", null, "REF_STATE_UNKNOWN"]] as const) {
    const observation = { kind, exitCode, signal: null, errorCode: null, elapsedMs: 1,
      stdout: Buffer.from("tests passed"), stderr: Buffer.alloc(0), stdoutTruncated: false, stderrTruncated: false } as ProcessObservation;
    const checks = new CandidateChecks(paths, async command => { assert.equal(command.executable, "/usr/bin/systemd-run"); return observation; });
    if (expected === null) await checks.run(candidate, check);
    else await assert.rejects(checks.run(candidate, check), code(expected));
  }
});

test("UX-09/INT-007: only the sandbox marker turns a nonzero exit into a named refusal", async () => {
  // A bare exit — the resource gate shares 125 — stays an unclassified failure.
  const bare = { kind: "exited", exitCode: 125, signal: null, errorCode: null, elapsedMs: 1,
    stdout: Buffer.alloc(0), stderr: Buffer.from("cgroup mismatch"), stdoutTruncated: false, stderrTruncated: false } as ProcessObservation;
  await assert.rejects(new CandidateChecks(paths, async () => bare).run(candidate, check), code("CHECK_FAILED"));
  // The marker makes the refusal explicit; the paths it names are re-observed
  // on the immutable candidate, never parsed from sandbox output.
  const marked = { ...bare, stderr: Buffer.from("OMA_ERROR=UNSUPPORTED_PROFILE\nOMA_GITLINK=dep\nOMA_GITLINK=vendor/nested\n") };
  let reobserved: string | null = null;
  const checks = new CandidateChecks(paths, async () => marked, {
    gitlinks: (repository, oid) => {
      assert.equal(repository, paths.projectGit); assert.equal(oid, candidate); reobserved = oid;
      return { kind: "present", value: ["dep", "vendor/nested"], evidence: { status: 0, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) } };
    } });
  await assert.rejects(checks.run(candidate, check), (error: unknown) => {
    if (!(error instanceof StoreError) || error.code !== "UNSUPPORTED_PROFILE") return false;
    assert.match(error.message, /submodule gitlink/);
    assert.deepEqual(error.details, { paths: ["dep", "vendor/nested"] });
    return true;
  });
  assert.equal(reobserved, candidate);
});

for (const format of ["sha1", "sha256"] as const) test(`DR29/INT-002: ${format} checkout checks exact bytes, including export-ignored files, without hooks or user filters`, async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-check-tree-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "source"), work = join(root, "checked"), temporary = join(root, "tmp"), repo = join(root, "project.git");
  mkdirSync(source); mkdirSync(temporary);
  const git = (...argv: string[]) => {
    const result = runGitText(argv, { cwd: source, env: { GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@invalid",
      GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@invalid" } });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  };
  git("init", "-q", `--object-format=${format}`);
  writeFileSync(join(source, ".gitattributes"), "checked.txt export-ignore\nsubstitute.txt export-subst\nencoded.txt working-tree-encoding=UTF-16LE\nlines.txt text eol=crlf\nident.txt ident\n");
  writeFileSync(join(source, "checked.txt"), "exact\r\nbytes\n");
  writeFileSync(join(source, "substitute.txt"), "$Format:%H$\n");
  writeFileSync(join(source, "encoded.txt"), Buffer.from("raw encoding\n", "utf16le"));
  writeFileSync(join(source, "lines.txt"), "LF only\n");
  writeFileSync(join(source, "ident.txt"), "$Id$\n");
  git("add", "."); git("commit", "-qm", "checked"); const oid = git("rev-parse", "HEAD");
  git("clone", "-q", "--bare", source, repo);
  // CHECK_CHECKOUT is a shell program; a bare `sh` is what the local lane's
  // guard refuses, while the production launcher is bwrap. The script is driven
  // the way production drives it — inside bwrap — with the host tree bound so
  // the fixture paths resolve.
  const result = await runProcess({ executable: "/usr/bin/bwrap",
    argv: ["--dev-bind", "/", "/", "--die-with-parent", "--", "/bin/sh", "-c", CHECK_CHECKOUT, "test-check", oid,
      repo, work, temporary, "/usr/bin/test", "-f", "checked.txt"],
    env: GIT_ENV, timeoutMs: 5000, stdoutBytes: 4096, stderrBytes: 4096 });
  assert.equal(result.kind, "exited"); assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.deepEqual(readFileSync(join(work, "checked.txt")), readFileSync(join(source, "checked.txt")));
  assert.equal(readFileSync(join(work, "substitute.txt"), "utf8"), "$Format:%H$\n");
  for (const name of ["encoded.txt", "lines.txt", "ident.txt"])
    assert.deepEqual(readFileSync(join(work, name)), Buffer.from(git("show", `${oid}:${name}`) + "\n"), name);
  // A submodule cannot silently turn an incomplete checkout into a passing check.
  // UX-09: the refusal names its class and every gitlink path on stderr before
  // the bare exit — the host does not have to guess which 125 it saw.
  git("update-index", "--add", "--cacheinfo", `160000,${oid},dependency`);
  git("update-index", "--add", "--cacheinfo", `160000,${oid},vendor/nested`);
  git("commit", "-qm", "gitlink");
  const withLink = git("rev-parse", "HEAD"); git("--git-dir", repo, "fetch", "-q", source, withLink);
  const marker = join(root, "should-not-run");
  const refused = await runProcess({ executable: "/usr/bin/bwrap",
    argv: ["--dev-bind", "/", "/", "--die-with-parent", "--", "/bin/sh", "-c", CHECK_CHECKOUT, "test-check", withLink,
      repo, join(root, "incomplete"), temporary, "/usr/bin/touch", marker],
    env: GIT_ENV, timeoutMs: 5000, stdoutBytes: 4096, stderrBytes: 4096 });
  assert.equal(refused.kind, "exited"); assert.equal(refused.exitCode, 125); assert.equal(existsSync(marker), false);
  const stderr = refused.stderr.toString();
  assert.match(stderr, /^OMA_ERROR=UNSUPPORTED_PROFILE$/m);
  assert.match(stderr, /^OMA_GITLINK=dependency$/m);
  assert.match(stderr, /^OMA_GITLINK=vendor\/nested$/m);
});
