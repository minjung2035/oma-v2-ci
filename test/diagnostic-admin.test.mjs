import { serializePlanIntent } from "../dist/test/fixtures/plan.js";
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ledgerFixture } from "./helpers/ledger-fixture.mjs";
import { physicalLedger } from "./helpers/physical-ledger.mjs";
import { createDiagnosticObservers } from "../scripts/diagnostic-observers.mjs";
import { parseDiagnosticArgs, checkState } from "../scripts/check-state.mjs";
import { generateOperationId } from "@oma/native/identity";
import { requestHash } from "@oma/domain/request-identity";
import { sha256Hex } from "@oma/domain/canonical-json";
const env = { PATH: "/usr/bin:/bin", HOME: "/nonexistent", LANG: "C", LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
function git(repo, args, input) {
  const result = spawnSync("/usr/bin/git", ["--git-dir", repo, ...args], { env, input, encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.error, undefined);
  return result.stdout.trim();
}
function repoFixture(root) {
  mkdirSync(join(root, "repos"), { recursive: true }); const repo = join(root, "repos/project.git");
  const result = spawnSync("/usr/bin/git", ["init", "--bare", repo], { env, encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  const tree = git(repo, ["mktree"], "");
  const base = git(repo, ["commit-tree", tree], "base\n");
  const candidate = git(repo, ["commit-tree", tree, "-p", base], "candidate\n");
  const later = git(repo, ["commit-tree", tree, "-p", candidate], "later\n");
  git(repo, ["update-ref", "refs/heads/main", later]);
  return { repo, tree, base, candidate, later };
}
function acceptedIntegration(store, base, candidate) {
  const id = generateOperationId(), payload = { expected: base, candidate };
  store.transaction(tx => {
    tx.operations.insert({ id, actor: "alice", requestKey: id, kind: "git.integrate", requestHash: requestHash("git.integrate", payload), payloadJson: JSON.stringify(payload),
      planJson: serializePlanIntent({ kind: "git.integrate", repo: "project", target: "refs/heads/main", base, candidate, policyRevision: "fixture", checkProfileDigest: "a".repeat(64), policyIdentity: "b".repeat(64), noopRef: null }) });
    tx.operations.succeed(id, JSON.stringify({ kind: "git.integrate", base, candidate, target: "refs/heads/main", policyRevision: "fixture", changed: true }));
  });
  return id;
}
const args = root => ["--state", root, "--society", "fixture", "--mode", "offline", "--quiesced"];
test("P6 admin: closed argv grammar requires explicit offline quiescence and has no repair switch", () => {
  assert.equal(parseDiagnosticArgs(args("/tmp/example")).mode, "offline");
  for (const value of [[], [...args("/tmp/a"), "--repair"], [...args("/tmp/a"), "--state", "/tmp/b"], args("relative"), args("/tmp/../a"),
    ["--state", "/tmp/a", "--society", "fixture", "--mode", "offline"], [...args("/tmp/a"), "--max-rows", "10001"]]) assert.throws(() => parseDiagnosticArgs(value));
});
test("P6 admin: actual standalone command leaves accepted data and source bytes unchanged", t => {
  const f = physicalLedger(t), before = f.snapshot(), bytes = readFileSync(f.object);
  const result = spawnSync(process.execPath, ["scripts/check-state.mjs", ...args(f.root)], { encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout); assert.equal(report.status, "PASS"); assert.equal(report.pendingOperations, 1);
  assert.deepEqual(f.snapshot(), before); assert.deepEqual(readFileSync(f.object), bytes);
});
test("P6 admin: unavailable live user bus stays UNKNOWN and is not cgroup-death proof", t => {
  const f = physicalLedger(t);
  const result = spawnSync(process.execPath, ["scripts/check-state.mjs", "--state", f.root, "--society", "fixture", "--mode", "live"],
    { env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: `unix:path=${f.root}/missing-bus`, XDG_RUNTIME_DIR: f.root }, encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 2, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout); assert.equal(report.status, "UNKNOWN");
  assert.ok(report.issues.some(issue => issue.entity === "units"));
});
test("P6 admin: actual Git history accepts a later descendant but rejects a lost integrated candidate", t => {
  const f = ledgerFixture(t), repo = repoFixture(f.root), id = acceptedIntegration(f.store, repo.base, repo.candidate);
  const before = f.store.getOperationById(id); const good = checkState(args(f.root));
  assert.equal(good.status, "PASS", JSON.stringify(good));
  const unrelated = git(repo.repo, ["commit-tree", repo.tree], "unrelated\n"); git(repo.repo, ["update-ref", "refs/heads/main", unrelated]);
  const bad = checkState(args(f.root)); assert.equal(bad.status, "FAIL", JSON.stringify(bad));
  assert.ok(bad.issues.some(issue => issue.code === "INTEGRATED_CANDIDATE_LOST"));
  assert.deepEqual(f.store.getOperationById(id), before);
});
test("P6 admin: command budget and invalid method/ref requests cannot become successful empty observations", t => {
  const f = ledgerFixture(t), repo = repoFixture(f.root), context = { stateRoot: f.root, society: "fixture" };
  const observer = createDiagnosticObservers(context, { limits: { maxCommands: 1 } });
  assert.equal(observer.git.commit(repo.repo, repo.candidate).kind, "present");
  assert.equal(observer.git.ref(repo.repo, "refs/heads/main").kind, "unknown");
  assert.equal(observer.commands, 1);
  const noCommands = createDiagnosticObservers(context, { invoke() { throw new Error("must not execute"); } });
  assert.equal(noCommands.git.ref(repo.repo, "--evil").kind, "unknown");
  assert.equal(noCommands.git.commit(repo.repo, "bad\nobject").kind, "unknown");
  for (const pair of [["--evil", repo.candidate], [repo.candidate, "bad\nobject"]]) {
    const observation = noCommands.git.ancestry(repo.repo, ...pair);
    assert.equal(observation.kind, "unknown");
    assert.equal(observation.evidence.status, null);
  }
  assert.equal(noCommands.commands, 0);
});
test("P6 admin: canonical context tree byte/path relations are read from real Git objects", t => {
  const f = ledgerFixture(t), r = repoFixture(f.root), bytes = Buffer.from("goal\n");
  const blob = git(r.repo, ["hash-object", "-w", "--stdin"], bytes);
  const tree = git(r.repo, ["mktree"], `100644 blob ${blob}\tGOAL.md\n`);
  const candidate = git(r.repo, ["commit-tree", tree], "context\n");
  const observer = createDiagnosticObservers({ stateRoot: f.root, society: "fixture" });
  const entries = [{ path: "GOAL.md", bytes: bytes.length, sha256: sha256Hex(bytes) }];
  assert.equal(observer.git.contextTree(r.repo, candidate, entries).kind, "present");
  assert.equal(observer.git.contextTree(r.repo, candidate, [{ ...entries[0], sha256: "a".repeat(64) }]).kind, "corrupt");
  assert.equal(observer.git.contextTree(r.repo, candidate, [...entries, { path: "RATIONALE.md", bytes: 1, sha256: "a".repeat(64) }]).kind, "corrupt");
});
test("P6 admin: child environments exclude provider and inherited Git hooks/config variables", t => {
  const f = ledgerFixture(t), r = repoFixture(f.root); const seen = [];
  const observer = createDiagnosticObservers({ stateRoot: f.root, society: "fixture" }, { invoke(spec) {
    seen.push(spec);
    return { kind: "exited", exitCode: 0, signal: null, stdout: Buffer.from("commit\n"), stderr: Buffer.alloc(0) };
  } });
  assert.equal(observer.git.commit(r.repo, r.candidate).kind, "present");
  assert.deepEqual(Object.keys(seen[0].env).sort(), ["PATH", "HOME", "LANG", "LC_ALL", "GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_GLOBAL", "GIT_OPTIONAL_LOCKS", "GIT_NO_REPLACE_OBJECTS", "GIT_NO_LAZY_FETCH", "GIT_TERMINAL_PROMPT", "GIT_ALLOW_PROTOCOL"].sort());
  assert.equal(seen[0].env.GIT_ALLOW_PROTOCOL, ""); assert.equal(seen[0].executable, "/usr/bin/git");
});
