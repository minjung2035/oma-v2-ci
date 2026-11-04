import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { preparationShutdownBarrier } from "@oma/process/preparation";
import { withAsyncCleanup } from "@oma/native/cleanup";
import { registerHooks } from "node:module";
import { mkdtempSync, realpathSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// The workflow API is usable without evaluating any canonical command adapter.
const evaluated = [];
const hook = registerHooks({ resolve(specifier, context, next) {
  const result = next(specifier, context);
  if (/\/(?:canonical-command|observe|repository|quarantine|context-repository)\.js$/.test(result.url)) evaluated.push(result.url);
  return result;
} });
const { GitModule } = await import("@oma/git");
hook.deregister();
assert.equal(typeof GitModule, "function");
assert.deepEqual(evaluated, [], "workflow imports evaluated command implementations");

const { GitRepository } = await import("@oma/git/repository");
const root = realpathSync(mkdtempSync(join(tmpdir(), "oma-installed-git-")));
await withAsyncCleanup(async () => {
  const projectGit = join(root, "project.git");
  const run = args => {
    const child = spawnSync("/usr/bin/git", args, { encoding: "utf8", env: {
      ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
    }, timeout: 10000 });
    assert.equal(child.status, 0, child.stderr); return child.stdout.trim();
  };
  run(["init", "--bare", "--initial-branch=main", projectGit]);
  const repository = new GitRepository({ stateRoot: root, projectGit, society: "demo",
    contextGit: join(root, "context.git"), worldDir: join(root, "world") }, { submissions: () => [] });
  assert.equal("mergeDiff" in repository.review, false, "the retired direct-diff execution port is absent from the packed repository");
  assert.equal("canonicalMergeDiff" in await import("@oma/git/canonical-command"), false,
    "the removed fallback is not retained as a callable packed export");
  assert.equal(repository.integration.main().kind, "absent");
  assert.equal(repository.context.current(), null);
  assert.equal(existsSync(join(root, "runtime.sqlite")), false);
  const tree = run(["--git-dir", projectGit, "hash-object", "-w", "-t", "tree", "--stdin"]);
  const oid = run(["-c", "user.name=OMA", "-c", "user.email=oma@example.invalid", "--git-dir", projectGit,
    "commit-tree", tree, "-m", "installed candidate"]);
  run(["--git-dir", projectGit, "update-ref", "refs/heads/main", oid]);
  const candidate = run(["-c", "user.name=OMA", "-c", "user.email=oma@example.invalid", "--git-dir", projectGit,
    "commit-tree", tree, "-p", oid, "-m", "installed next candidate"]);
  repository.submission.publishRef("refs/oma/published/alice/installed", candidate);
  assert.equal(repository.submission.observeRef("refs/oma/published/alice/installed").value, candidate);
  assert.equal(repository.integration.compareAndSwap(oid, candidate).kind, "candidate");
  assert.equal(repository.integration.main().value, candidate);
  assert.deepEqual(repository.integration.published().value, [candidate]);
  const contextTree = join(root, "context-preparation", "tree"), contextBytes = Buffer.from("# Installed context\n");
  mkdirSync(contextTree, { recursive: true }); writeFileSync(join(contextTree, "GOAL.md"), contextBytes);
  const manifest = [{ path: "GOAL.md", bytes: contextBytes.length, sha256: createHash("sha256").update(contextBytes).digest("hex") }];
  const contextCandidate = await repository.context.prepareCandidate(contextTree, manifest, null);
  assert.equal(run(["--git-dir", join(root, "context.git"), "show", contextCandidate + ":GOAL.md"]), "# Installed context");
  assert.equal(repository.context.current(), null, "preparation does not publish the accepted context ref");
  assert.equal(repository.context.preparationQuiescent(contextTree), true);
  const { CanonicalHealthObserver } = await import("@oma/git/canonical-health");
  const health = new CanonicalHealthObserver(projectGit);
  const pending = health.assertHealthy();
  assert.equal(health.assertHealthy(), pending, "one actual fsck owns its tree lease");
  await pending;
  const malformed = join(projectGit, "objects", "aa"); mkdirSync(malformed, { recursive: true });
  writeFileSync(join(malformed, "b".repeat(38)), "invalid git object");
  await assert.rejects(health.assertHealthy(), { code: "STORE_CORRUPT" });
  assert.equal(existsSync(`${projectGit}.fsck.stderr`), false);

}, async () => { await preparationShutdownBarrier(); rmSync(root, { recursive: true, force: true }); });
