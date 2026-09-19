import test from "node:test";
import assert from "node:assert/strict";
import { evaluateExecution, validateCrashObservation, lanes, unrunDirectives, unrunTests } from "../scripts/verification-lanes.mjs";
const healthy = ["TAP version 13", "1..2", "ok 1 - critical oracle", "ok 2 - second oracle", "# tests 2", "# pass 2", "# fail 0", "# cancelled 0", "# skipped 0", "# todo 0", ""].join("\n");
const evaluate = tap => evaluateExecution({ exitCode: 0, tap, requiredNames: ["critical oracle"], baselineNames: ["critical oracle", "second oracle"] });
test("R35 evidence policy accepts real complete summaries but never AST counts as execution", () => {
  assert.equal(evaluate(healthy).status, "PASS");
  assert.equal(evaluate("# AST call sites: 2\n").status, "FAIL");
  assert.equal(evaluate("build started\n").status, "FAIL");
  assert.equal(evaluateExecution({ exitCode: 0, tap: "# tests 0\n# pass 0\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n" }).status, "FAIL");
});
test("R35 evidence policy detects hidden skips, todo, cancellation and critical oracle deletion", () => {
  for (const bad of [healthy.replace("ok 1 - critical oracle", "ok 1 - critical oracle # SKIP missing systemd"),
    healthy.replace("# skipped 0", "# skipped 1").replace("# pass 2", "# pass 1"),
    healthy.replace("# todo 0", "# todo 1"), healthy.replace("# cancelled 0", "# cancelled 1"),
    healthy.replace("critical oracle", "renamed unrelated test"), healthy.replace("second oracle", "different test"),
    healthy.replace("# tests 2", "# tests 999")]) assert.equal(evaluate(bad).status, "FAIL");
  assert.equal(evaluateExecution({ exitCode: 1, tap: healthy }).status, "FAIL");
  assert.equal(evaluateExecution({ exitCode: 0, signal: "SIGKILL", tap: healthy }).status, "FAIL");
});
test("R35 death evidence requires reached boundary, SIGKILL and restart independently", () => {
  const observed = { requestedPoint: "submit-ref", reachedPoint: "submit-ref", signal: "SIGKILL", restarted: true };
  assert.equal(validateCrashObservation(observed), true);
  for (const bad of [{ ...observed, reachedPoint: "timeout" }, { ...observed, signal: "SIGSTOP" },
    { ...observed, signal: null }, { ...observed, restarted: false }]) assert.equal(validateCrashObservation(bad), false);
  assert.ok(lanes.crash.proof.includes("not an entrypoint-crash"));
  assert.ok(lanes.crash.proof.includes("VM-power-loss"));
  assert.equal(lanes.kernel.environment, "systemd");
});

test("R35 the local suite's own summary is read the same way a lane's is", () => {
  const summary = counts => ["TAP version 13", "1..1", "ok 1 - a test",
    `# tests ${counts.tests ?? 1}`, `# pass ${counts.pass ?? 1}`, "# fail 0",
    `# cancelled ${counts.cancelled ?? 0}`, `# skipped ${counts.skipped ?? 0}`, `# todo ${counts.todo ?? 0}`, ""].join("\n");
  // A run that executed everything it reported.
  assert.deepEqual(unrunTests(summary({})), []);
  // The exact shape that exits zero and reads as a pass: bubblewrap missing,
  // four containment tests skipped, nothing failed.
  assert.deepEqual(unrunTests(summary({ skipped: 4, pass: 0 })), ["skipped: 4"]);
  assert.deepEqual(unrunTests(summary({ todo: 1 })), ["todo: 1"]);
  assert.deepEqual(unrunTests(summary({ cancelled: 2 })), ["cancelled: 2"]);
  assert.deepEqual(unrunTests(summary({ skipped: 1, todo: 1, cancelled: 1 })),
    ["skipped: 1", "todo: 1", "cancelled: 1"]);
  // A summary that never reported the counts is not evidence of a full run.
  for (const absent of ["", "TAP version 13\n# pass 1\n", "# skipped\n"])
    assert.ok(unrunTests(absent).length > 0, `accepted ${JSON.stringify(absent)}`);
  // A count that merely appears inside a test name is not the summary line.
  assert.deepEqual(unrunTests(summary({}).replace("ok 1 - a test", "ok 1 - # skipped 9 is in this name")), []);
  // The names come back so a report can say which tests did not run.
  const withDirective = summary({ skipped: 1 }).replace("ok 1 - a test", "ok 1 - sandbox # SKIP no bubblewrap");
  assert.deepEqual(unrunDirectives(withDirective), ["ok 1 - sandbox # SKIP no bubblewrap"]);
  assert.deepEqual(unrunDirectives(summary({})), []);
});
