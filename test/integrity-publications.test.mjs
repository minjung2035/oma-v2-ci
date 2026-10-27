import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync, symlinkSync, readlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { physicalLedger } from "./helpers/physical-ledger.mjs";
import { createDiagnosticObservers } from "../scripts/diagnostic-observers.mjs";
import { inspectIntegrity } from "#oma-test/app/diagnostics/integrity";
import { NodeIntegrityFiles } from "#oma-test/app/diagnostics/files";
import { sha256Hex } from "@oma/domain/canonical-json";
const env = { PATH: "/usr/bin:/bin", HOME: "/nonexistent", LANG: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
function git(repo, args, input) {
  const result = spawnSync("/usr/bin/git", ["--git-dir", repo, ...args], { env, input, encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
function objects(t) {
  const root = mkdtempSync(join(tmpdir(), "oma-context-objects-")), repo = join(root, "source.git");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const init = spawnSync("/usr/bin/git", ["init", "--bare", repo], { env, encoding: "utf8", timeout: 10000 }); assert.equal(init.status, 0, init.stderr);
  const bytes = Buffer.from("the committed goal\n"), blob = git(repo, ["hash-object", "-w", "--stdin"], bytes);
  const tree = git(repo, ["mktree"], `100644 blob ${blob}\tGOAL.md\n`), candidate = git(repo, ["commit-tree", tree], "goal\n");
  return { repo, bytes, candidate, entries: [{ path: "GOAL.md", bytes: bytes.length, sha256: sha256Hex(bytes) }] };
}
function install(source, fixture, name) {
  mkdirSync(join(fixture.root, "repos"), { recursive: true });
  const repo = join(fixture.root, "repos", name);
  const cloned = spawnSync("/usr/bin/git", ["clone", "--bare", "--no-hardlinks", source, repo], { env, encoding: "utf8", timeout: 10000 }); assert.equal(cloned.status, 0, cloned.stderr);
  // An unreachable candidate needs an explicit local fetch during fixture setup.
  return repo;
}
function observe(f) { return inspectIntegrity(f.snapshot(), f.context, { files: new NodeIntegrityFiles(), git: createDiagnosticObservers(f.context).git }); }
function contextFixture(t) {
  const source = objects(t); git(source.repo, ["update-ref", "refs/heads/fixture", source.candidate]);
  const f = physicalLedger(t, { kind: "context.publish", candidate: source.candidate, entries: source.entries, contentHash: sha256Hex(source.bytes) });
  const repo = install(source.repo, f, "context.git");
  const revision = join(f.root, "world/context/revisions", source.candidate);
  return { f, source, repo, revision };
}
test("P6 publication: pending context may await snapshot/mail without fabricated terminal success", t => {
  const { f, repo, source } = contextFixture(t);
  const before = f.store.getOperationById(f.id);
  assert.equal(observe(f).status, "PASS");
  git(repo, ["update-ref", "refs/heads/main", source.candidate]);
  // Canonical ref can become visible before current/snapshot/mail publication.
  const report = observe(f); assert.notEqual(report.status, "FAIL", JSON.stringify(report));
  assert.deepEqual(f.store.getOperationById(f.id), before);
});
test("P6 publication: succeeded context requires exact snapshot/current/canonical manifest", t => {
  const { f, repo, source, revision } = contextFixture(t);
  mkdirSync(revision, { recursive: true }); writeFileSync(join(revision, "GOAL.md"), source.bytes, { mode: 0o644 }); chmodSync(revision, 0o555);
  git(repo, ["update-ref", "refs/heads/main", source.candidate]);
  const pointer = join(f.root, "world/context/current"); symlinkSync(`revisions/${source.candidate}`, pointer);
  f.publish(); f.store.transaction(tx => tx.operations.succeed(f.id, JSON.stringify({ kind: "context.publish", previous: null, revision: source.candidate, message: f.message.id, recipientCount: 1 })));
  const good = observe(f); assert.equal(good.status, "PASS", JSON.stringify(good));
  rmSync(pointer); symlinkSync(`revisions/${"a".repeat(40)}`, pointer);
  const bad = observe(f); assert.equal(bad.status, "FAIL"); assert.ok(bad.issues.some(i => i.code === "CONTEXT_CURRENT_MISMATCH"));
  assert.equal(readlinkSync(pointer), `revisions/${"a".repeat(40)}`);
});
test("P6 publication: published submission ref must point to its exact accepted candidate", t => {
  const source = objects(t); git(source.repo, ["update-ref", "refs/heads/fixture", source.candidate]);
  const f = physicalLedger(t, { kind: "git.submit", candidate: source.candidate }); const repo = install(source.repo, f, "project.git");
  git(repo, ["update-ref", f.plan.publishedRef, source.candidate]); f.publish();
  f.store.transaction(tx => tx.operations.succeed(f.id, JSON.stringify({ kind: "git.submit", candidate: source.candidate, publishedRef: f.plan.publishedRef, message: f.message.id, recipientCount: 1 })));
  assert.equal(observe(f).status, "PASS");
  const tree = git(repo, ["mktree"], ""), different = git(repo, ["commit-tree", tree], "different\n"); git(repo, ["update-ref", f.plan.publishedRef, different]);
  const report = observe(f); assert.equal(report.status, "FAIL"); assert.ok(report.issues.some(i => i.code === "PUBLISHED_REF_MISMATCH"));
  assert.equal(git(repo, ["rev-parse", f.plan.publishedRef]), different);
});
