/** Launcher failure diagnostics, not successful namespace/native qualification.
 * Substitute only the fixed launcher with direct argv; no workload gate opens. */
import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StoreError } from "@oma/domain/errors";
import { launchBlockedNamespace } from "@oma/platform-linux/namespace-execution";
import { runnerScope } from "@oma/platform-linux/runner-scope";
import { ExecutionCoordinator, ExecutionNotStarted } from "@oma/process/owned-execution";
import { ExecutionJournal } from "@oma/storage/execution-journal";

const command = () => runnerScope({ executable: process.execPath, argv: ["-e", "throw new Error('workload must not start')"],
  env: {}, timeoutMs: 5000, stdoutBytes: 1024, stderrBytes: 1024 });
const linux = { skip: process.platform !== "linux" ? "Linux launcher failure boundary" : false, timeout: 15_000 };

for (const code of ["ENOENT", "EACCES"])
  test(`001. Namespace launch: ${code} is unavailable, preserves errno and retires only the unstarted reservation`, linux, async t => {
    const root = mkdtempSync(join(tmpdir(), "oma-launch-failure-"));
    const executable = join(root, "launcher");
    if (code === "EACCES") writeFileSync(executable, "not executable", { mode: 0o600 });
    const spawn = childProcess.spawn;
    const mocked = t.mock.method(childProcess, "spawn", (...args: Parameters<typeof childProcess.spawn>) => {
      assert.equal(args[0], "/usr/bin/bwrap");
      return spawn(executable, [], args[2]);
    });
    syncBuiltinESMExports();
    ExecutionJournal.initialize(root);
    const journal = ExecutionJournal.open(root);
    const owner = new ExecutionCoordinator(journal, () => { throw new Error("an unstarted launcher has no witness to observe"); });
    let authorized = false;
    try {
      await assert.rejects(launchBlockedNamespace(command()), error => {
        assert.ok(error instanceof ExecutionNotStarted);
        assert.ok(error.cause instanceof StoreError);
        assert.equal(error.cause.code, "BROKER_UNAVAILABLE");
        assert.match(error.cause.message, new RegExp(code));
        const observed = Reflect.get(error.cause, "namespaceLaunch");
        assert.equal(observed.kind, "spawn-failed"); assert.equal(observed.errorCode, code);
        return true;
      });
      await assert.rejects(owner.run({ slot: "candidate", launch: () => launchBlockedNamespace(command()), authorize() { authorized = true; } }),
        { code: "BROKER_UNAVAILABLE" });
      assert.equal(authorized, false);
      assert.deepEqual(journal.entries(), []);
      assert.equal(owner.confirmDead("candidate"), true);
    } finally {
      mocked.mock.restore(); syncBuiltinESMExports();
      try { await owner.drain(); } finally { journal.close(); rmSync(root, { recursive: true, force: true }); }
    }
  });

for (const [label, identity] of [["empty", ""], ["malformed", "{"], ["non-object", "[]"], ["missing-pid", "{}"]])
  test(`002. Namespace launch: ${label} identity is unknown, never proof that the scope did not start`, linux, async t => {
    const spawn = childProcess.spawn;
    const mocked = t.mock.method(childProcess, "spawn", (...args: Parameters<typeof childProcess.spawn>) => {
      assert.equal(args[0], "/usr/bin/bwrap");
      return spawn(process.execPath, ["-e", `require('node:fs').writeSync(3, ${JSON.stringify(identity)}); process.stderr.write('injected launcher setup failure'); process.exitCode = 1;`], args[2]);
    });
    syncBuiltinESMExports();
    try {
      await assert.rejects(launchBlockedNamespace(command()), error => {
        assert.equal(error instanceof ExecutionNotStarted, false, "launcher close is not namespace death evidence");
        assert.ok(error instanceof StoreError);
        assert.equal(error.code, "RUN_TERMINATION_UNKNOWN");
        const observed = Reflect.get(error, "namespaceLaunch");
        // EOF can precede the launcher's close event; cleanup may record its
        // own cancellation. Neither observation proves whole-scope death.
        assert.ok(["exited", "aborted"].includes(observed.kind));
        if (observed.kind === "exited") assert.equal(observed.exitCode, 1);
        assert.equal(observed.stderr, "injected launcher setup failure");
        return true;
      });
    } finally { mocked.mock.restore(); syncBuiltinESMExports(); }
  });

test("003. Namespace launch: cancellation before spawn remains cancellation, not launcher unavailability", linux, async t => {
  const controller = new AbortController(); controller.abort();
  const mocked = t.mock.method(childProcess, "spawn", () => { throw new Error("cancelled launch must not spawn"); });
  syncBuiltinESMExports();
  try {
    await assert.rejects(launchBlockedNamespace(command(), { signal: controller.signal }), error => {
      assert.ok(error instanceof ExecutionNotStarted);
      assert.ok(error.cause instanceof StoreError);
      assert.equal(error.cause.code, "CANCELLED_BEFORE_COMMIT");
      return true;
    });
    assert.equal(mocked.mock.callCount(), 0);
  } finally { mocked.mock.restore(); syncBuiltinESMExports(); }
});
