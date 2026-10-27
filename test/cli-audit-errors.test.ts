import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { RequestCache } from "#oma-test/app/request-cache";
import { runCliWithPeer } from "./fixtures/cli-peer.js";

const git = (cwd: string, args: string[]) => execFileSync("/usr/bin/git", args, {
  cwd, encoding: "utf8", env: { ...process.env, HOME: cwd, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
}).trim();

for (const [code, exit] of [
  ["LIMIT_EXCEEDED", 2], ["INVALID_REQUEST", 2], ["INVALID_OID", 2],
  ["REF_STATE_UNKNOWN", 3], ["DEADLINE_EXCEEDED", 3], ["STORE_CORRUPT", 3], ["UNSUPPORTED_PROFILE", 4],
] as const) {
  test(`NB-16: top-level ${code} keeps its declared exit`, () => {
    const errors = fileURLToPath(new URL(import.meta.resolve("@oma/domain/errors")));
    const exits = fileURLToPath(new URL(import.meta.resolve("#oma-test/app/cli/exit")));
    const result = spawnSync(process.execPath, ["--input-type=module", "-e",
      `import { StoreError } from ${JSON.stringify(errors)}; import { fatal } from ${JSON.stringify(exits)}; fatal(new StoreError(${JSON.stringify(code)}, 'controlled builder failure'));`],
    { cwd: process.cwd(), encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, exit, result.stderr);
    assert.match(result.stderr, /controlled builder failure/);
  });
}

test("NB-16: accepted conflict bundled with cleanup stays unknown", () => {
  const errors = fileURLToPath(new URL(import.meta.resolve("@oma/domain/errors")));
  const exits = fileURLToPath(new URL(import.meta.resolve("#oma-test/app/cli/exit")));
  const result = spawnSync(process.execPath, ["--input-type=module", "-e",
    `import { AcceptedFailure } from ${JSON.stringify(errors)}; import { fatal } from ${JSON.stringify(exits)}; fatal(new AggregateError([new AcceptedFailure('POLICY_CHANGED', 'accepted conflict', 'possible'), new Error('cleanup')]));`],
  { encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 3, result.stderr);
  assert.match(result.stderr, /accepted conflict/);
});

for (const fault of ["bundle-size", "bundle-git", "invalid-prerequisite", "ancestry-unknown"] as const) {
  test(`NB-16: submit ${fault} cleans up before classified exit without freezing`, async t => {
    const home = mkdtempSync(join(tmpdir(), "oma-nb16-"));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    git(home, ["init", "-q"]);
    git(home, ["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qm", "base", "--allow-empty"]);
    const base = git(home, ["rev-parse", "HEAD"]);
    git(home, ["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qm", "candidate", "--allow-empty"]);
    const candidate = git(home, ["rev-parse", "HEAD"]);
    git(home, ["-c", "user.name=T", "-c", "user.email=t@t", "tag", "-am", "advertised tag object", "advertised", base]);
    const advertisedTag = git(home, ["rev-parse", "advertised"]);
    const preload = join(home, "fault.mjs");
    writeFileSync(preload, `import cp from 'node:child_process'; import { syncBuiltinESMExports } from 'node:module';
      const spawn = cp.spawnSync;
      process.env.OMA_BUNDLE_BYTES = ${JSON.stringify(fault === "bundle-size" ? "1" : "4096")};
      cp.spawnSync = (command, args, options) => {
        if (command === '/usr/bin/git' && args[0] === ${JSON.stringify(fault === "ancestry-unknown" ? "merge-base" : fault === "bundle-git" ? "bundle" : "never")})
          return { ...spawn('/usr/bin/false', [], options), status: 2 };
        return spawn(command, args, options);
      }; syncBuiltinESMExports();`);
    const run = await runCliWithPeer(home, home, ["submit", candidate, "--request", "builder-error"], async request => {
      assert.equal(request.method, "git.known");
      return { v: 1, id: request.id, ok: true, result: { hasCandidate: false,
        prerequisites: [fault === "invalid-prerequisite" ? advertisedTag : base] } };
    }, preload);
    assert.equal(run.status, fault === "ancestry-unknown" ? 3 : 2, run.stderr);
    assert.equal(new RequestCache(home).read("builder-error").kind, "absent");
    assert.deepEqual(readdirSync(join(home, "tmp")), []);
    assert.deepEqual(run.requests.map(request => request.method), ["git.known"]);
  });
}

test("NB-16: GOAL output bound and invalid context bound are input failures", async t => {
  const home = mkdtempSync(join(tmpdir(), "oma-nb16-goal-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  git(home, ["init", "-q"]);
  writeFileSync(join(home, "GOAL.md"), "goal\n");
  writeFileSync(join(home, "RATIONALE.md"), "x".repeat(256));
  git(home, ["add", "GOAL.md", "RATIONALE.md"]);
  git(home, ["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qm", "context"]);
  const expected = git(home, ["rev-parse", "HEAD"]);
  for (const [limit, args] of [
    ["32", ["send", "residents", "--intent", "goal", "--expect", expected, "--subject", "goal", "--file", join(home, "GOAL.md")]],
    ["bad", ["context", "publish", home, "--expect", "none"]],
  ] as const) {
    const preload = join(home, "bounds.mjs");
    writeFileSync(preload, `process.env.OMA_CONTEXT_BYTES=${JSON.stringify(limit)}; process.env.OMA_CONTEXT_GIT=${JSON.stringify(join(home, ".git"))};`);
    const run = await runCliWithPeer(home, home, [...args, "--request", "context-error"], async () => {
      assert.fail("builder failures cannot send requests");
    }, preload);
    assert.equal(run.status, 2, run.stderr);
    assert.equal(new RequestCache(home).read("context-error").kind, "absent");
    assert.deepEqual(run.requests, []);
  }
});
