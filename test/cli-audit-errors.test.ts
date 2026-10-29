import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { RequestCache } from "#oma-test/app/request-cache";
import { runClientWithPeer } from "./fixtures/client-peer.js";
import { clientCall } from "./fixtures/client-process.js";

const git = (cwd: string, args: string[]) => execFileSync("/usr/bin/git", args, {
  cwd, encoding: "utf8", env: { ...process.env, HOME: cwd, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
}).trim();


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
    const run = await runClientWithPeer(home, home, clientCall("publishCandidate", { candidate, subject: "", body: "" }, "builder-error"), async request => {
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
  for (const [limit, expression] of [
    ["32", clientCall("publishGoal", "goal\n", expected, "goal", "context-error")],
    ["bad", clientCall("publishContext", home, null, "context-error")],
  ] as const) {
    const preload = join(home, "bounds.mjs");
    writeFileSync(preload, `process.env.OMA_CONTEXT_BYTES=${JSON.stringify(limit)}; process.env.OMA_CONTEXT_GIT=${JSON.stringify(join(home, ".git"))};`);
    const run = await runClientWithPeer(home, home, expression, async () => {
      assert.fail("builder failures cannot send requests");
    }, preload);
    assert.equal(run.status, 2, run.stderr);
    assert.equal(new RequestCache(home).read("context-error").kind, "absent");
    assert.deepEqual(run.requests, []);
  }
});
