/** Actual Host death + durable physical witness + a new recovery controller.
 * No product lease, actor authority or installed-JS qualification is inferred. */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fork, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { ExecutionJournal } from "@oma/storage/execution-journal";
import { DARWIN_EXECUTION_JOURNAL_VERSION } from "@oma/protocol/persisted-formats";
import { ExecutionCoordinator } from "@oma/process/owned-execution";
import { observeDarwinJobScope, acquireDarwinJobScope } from "@oma/platform-mac/job-recovery";
import { currentDarwinAuditToken, currentDarwinHostId, identifyDarwinCoalition, pinDarwinProcess } from "@oma/native/audit-session";
import { ExecutionRuntime, recoverExecutionState } from "#oma-test/app/runtime/execution-runtime";

const legacy = { kind: "darwin-audit-session", auditSession: 1, coalitionId: "2", pid: 3, pidVersion: 4 };
test("001. Legacy Darwin recovery never turns a saved PID/session into live authority", () => {
  assert.deepEqual(observeDarwinJobScope(legacy), { kind: "unavailable" });
  assert.throws(() => acquireDarwinJobScope(legacy), error => error.code === "RUN_TERMINATION_UNKNOWN");
});
test("002. Actual Darwin recovery refuses the controller's own coalition", () => {
  if (process.platform !== "darwin") return assert.throws(currentDarwinAuditToken, { code: "UNSUPPORTED_PROFILE" });
  const token = currentDarwinAuditToken(), identity = identifyDarwinCoalition(process.pid);
  assert.deepEqual(observeDarwinJobScope(identity), { kind: "unavailable" });
  assert.throws(() => acquireDarwinJobScope(identity), { code: "RUN_TERMINATION_UNKNOWN" });
  assert.deepEqual(currentDarwinAuditToken(), token);
});

async function died(t, point) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oma-darwin-recovery-"))), pins = [];
  ExecutionJournal.initialize(root); const initial = readFileSync(join(root, "execution/scopes.jsonl"));
  const child = fork(fileURLToPath(new URL("./fixtures/darwin-recovery.mjs", import.meta.url)), [root, point], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let stderr = ""; child.stderr.on("data", bytes => { stderr += bytes; });
  const closed = new Promise((yes, no) => { child.once("error", no); child.once("close", (code, signal) => yes({ code, signal })); }); void closed.catch(() => {});
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await closed;
    let retained = false;
    try {
      for (const row of ExecutionJournal.inspect(root)) {
        if (row.witness === null) {
          if (point !== "opening") throw new Error("fixture has no published scope identity; preserve its opening evidence");
          continue;
        }
        const observed = observeDarwinJobScope(row.witness);
        if (observed.kind === "unavailable") throw new Error("fixture scope is unobserved; preserve its journal");
        if (observed.kind !== "running") continue;
        const scope = acquireDarwinJobScope(row.witness), deadline = performance.now() + 10000;
        try {
          while (scope.population() !== "empty") {
            if (scope.population() === "unknown" || performance.now() >= deadline) throw new Error("recovery fixture remains unobserved");
            scope.terminate(); await delay(10);
          }
        } finally { scope.close(); }
      }
    } catch (error) { retained = true; t.diagnostic(`Retained recovery evidence ${root}: ${error}`); throw error; }
    finally { for (const pin of pins) pin.close(); if (!retained) rmSync(root, { recursive: true }); }
  });
  assert.deepEqual(await closed, { code: null, signal: "SIGKILL" }, stderr);
  return { root, initial, pins, file: join(root, "execution/scopes.jsonl") };
}

for (const point of ["witness", "released", "released-seatbelt"]) test(`003. Actual new Darwin controller retires ${point} Host crash only after complete CID death`, { timeout: 45000 }, async t => {
  if (process.platform !== "darwin") return assert.throws(currentDarwinAuditToken, { code: "UNSUPPORTED_PROFILE" });
  const f = await died(t, point), journal = ExecutionJournal.open(f.root, DARWIN_EXECUTION_JOURNAL_VERSION);
  try {
    const [row] = journal.entries(); assert.equal(row.witness.kind, "darwin-resource-coalition");
    assert.deepEqual(Object.keys(row.witness).sort(), ["bootId", "coalitionId", "kind"]);
    const before = readFileSync(f.file); assert.deepEqual(before.subarray(0, f.initial.length), f.initial);
    assert.equal(observeDarwinJobScope(row.witness).kind, "running");
    let descendant;
    if (point.startsWith("released")) {
      const pid = Number(readFileSync(join(f.root, "descendant.pid"), "utf8"));
      descendant = pinDarwinProcess(pid); f.pins.push(descendant);
      assert.equal(descendant.state(), "live"); assert.deepEqual(descendant.identity, row.witness);
    }
    if (point === "released-seatbelt") {
      journal.close(); await recoverExecutionState(f.root, false);
    } else await new ExecutionCoordinator(journal, observeDarwinJobScope, acquireDarwinJobScope).recover();
    assert.deepEqual(ExecutionJournal.inspect(f.root), []); assert.equal(observeDarwinJobScope(row.witness).kind, "exited");
    if (descendant) assert.equal(descendant.state(), "exited");
    assert.deepEqual(readFileSync(f.file).subarray(0, before.length), before, "old frames remain byte-identical");
  } finally { journal.close(); }
});

test("004. Actual opening-only Host crash remains unknown and leaves journal bytes unchanged", { timeout: 30000 }, async t => {
  if (process.platform !== "darwin") return assert.throws(currentDarwinAuditToken, { code: "UNSUPPORTED_PROFILE" });
  const f = await died(t, "opening"), before = readFileSync(f.file), journal = ExecutionJournal.open(f.root, DARWIN_EXECUTION_JOURNAL_VERSION);
  try {
    assert.equal(journal.entries()[0].witness, null);
    await assert.rejects(new ExecutionCoordinator(journal, observeDarwinJobScope, acquireDarwinJobScope).recover(), { code: "RUN_TERMINATION_UNKNOWN" });
    assert.deepEqual(readFileSync(f.file), before); assert.equal(journal.entries().length, 1);
  } finally { journal.close(); }
});

test("005. Actual application guard retires positive noncreation and preserves unsupported refusal on retry", async t => {
  if (process.platform !== "darwin") return assert.throws(currentDarwinAuditToken, { code: "UNSUPPORTED_PROFILE" });
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oma-darwin-guard-")));
  ExecutionJournal.initialize(root); const runtime = new ExecutionRuntime(root);
  t.after(async () => { await runtime.close(); rmSync(root, { recursive: true }); });
  const command = { executable: process.execPath, argv: ["-e", "require('node:fs').writeFileSync('entered','forbidden')"], env: {}, cwd: root,
    timeoutMs: 1000, stdoutBytes: 0, stderrBytes: 0 };
  for (let attempt = 0; attempt < 2; ++attempt) {
    await assert.rejects(runtime.run("candidate", command, undefined, () => {}), { code: "UNSUPPORTED_PROFILE" });
    assert.deepEqual(ExecutionJournal.inspect(root), []); assert.equal(existsSync(join(root, "entered")), false);
  }
});

test("006. Actual Darwin host identity agrees with independent C processes without a generated fallback", t => {
  if (process.platform !== "darwin") return assert.throws(currentDarwinHostId, { code: "UNSUPPORTED_PROFILE" });
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oma-host-identity-"))), executable = join(root, "identity");
  t.after(() => rmSync(root, { recursive: true }));
  const compile = spawnSync("/usr/bin/clang", ["-Wall", "-Wextra", "-Werror",
    fileURLToPath(new URL("./fixtures/darwin-host-identity.c", import.meta.url)), "-o", executable], { encoding: "utf8", timeout: 30000 });
  assert.equal(compile.status, 0, compile.stderr);
  const host = currentDarwinHostId(); assert.match(host, /^[0-9a-f]{32}$/); assert.notEqual(host, "0".repeat(32));
  assert.equal(currentDarwinHostId(), host);
  for (let attempt = 0; attempt < 2; ++attempt) {
    const result = spawnSync(executable, [], { encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, host + "\n");
  }
});
