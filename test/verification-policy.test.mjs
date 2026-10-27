import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
  assert.equal(lanes.kernel.environment, "linux-native");
});

test("R35 every verification lane names a current test source", () => {
  for (const [laneName, lane] of Object.entries(lanes)) {
    if (lane.files !== "all")
      for (const file of lane.files)
        assert.ok(existsSync(new URL(file.replace(/\.js$/, ".ts"), import.meta.url)), `${laneName}: ${file}`);
    for (const file of lane.sourceFiles)
      assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), `${laneName}: ${file}`);
  }
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

test("V02C: stable consistency IDs and real fixture/checkpoint cases belong to explicit lanes", () => {
  assert.ok(lanes.fast.sourceFiles.includes("test/config-bundle-owner.test.mjs"));
  assert.ok(lanes.fast.sourceFiles.includes("test/consistency-decisions.test.mjs"));
  assert.ok(lanes.fast.requiredNames.includes("V02A:"));
  assert.ok(lanes.durable.files.includes("checkpoint-driver.test.js"));
  assert.ok(lanes.durable.requiredNames.includes("V02B:"));
  assert.ok(lanes.property.files.includes("effect-observation.test.js"));
  assert.ok(lanes.property.requiredNames.includes("V02C:"));
  for (const id of ["V01A:", "V01B:", "V02A:", "V02B:", "V02C:"]) {
    assert.ok(lanes.all.requiredNames.includes(id), `all lane omits ${id}`);
    assert.equal(evaluateExecution({ exitCode: 0, tap: healthy, requiredNames: [id] }).status, "FAIL");
  }
});

test("R35 dummy restart checks are required by durable without replacing power-loss evidence", () => {
  assert.ok(lanes.durable.sourceFiles.includes("test/powercut-lane.test.mjs"));
  for (const id of ["P9 simulation: real accepted mail", "P9 simulation: missing immutable bytes",
    "P9 simulation: checkpoint failure", "P9 simulation: UNKNOWN", "P9 simulation: recovery child"]) {
    assert.ok(lanes.durable.requiredNames.includes(id));
    assert.equal(evaluateExecution({ exitCode: 0, tap: healthy, requiredNames: [id] }).status, "FAIL");
  }
});

test("R35 Store opening oracles are required by durable and all lanes", () => {
  assert.ok(lanes.durable.files.includes("store-open.test.js"));
  assert.equal(lanes.all.files, "all");
  for (const id of ["V04A:", "V04B:"]) {
    assert.ok(lanes.durable.requiredNames.includes(id));
    assert.ok(lanes.all.requiredNames.includes(id));
    assert.equal(evaluateExecution({ exitCode: 0, tap: healthy, requiredNames: [id] }).status, "FAIL");
  }
});

test("R35 config ownership oracles use their prescribed lanes and stable IDs", () => {
  assert.ok(lanes.fast.files.includes("config-edit-descriptors.test.js"));
  assert.ok(lanes.fast.requiredNames.includes("V11B:"));
  assert.ok(lanes.durable.files.includes("config-editing.test.js"));
  assert.ok(lanes.durable.requiredNames.includes("V11A:"));
  assert.ok(lanes.property.files.includes("config-validation.test.js"));
  assert.ok(lanes.property.requiredNames.includes("V11C:"));
  for (const id of ["V11A:", "V11B:", "V11C:"]) {
    assert.ok(lanes.all.requiredNames.includes(id), `all lane omits ${id}`);
    assert.equal(evaluateExecution({ exitCode: 0, tap: healthy, requiredNames: [id] }).status, "FAIL");
  }
});

test("R35 preaccept ownership oracles are required by durable and all lanes", () => {
  assert.ok(lanes.durable.files.includes("preaccept-scope.test.js"));
  for (const id of ["V17A:", "V17B:"]) {
    assert.ok(lanes.durable.requiredNames.includes(id));
    assert.ok(lanes.all.requiredNames.includes(id));
    assert.equal(evaluateExecution({ exitCode: 0, tap: healthy, requiredNames: [id] }).status, "FAIL");
  }
});

test("R35 delivery receipt publication oracles are required by durable and all lanes", () => {
  assert.ok(lanes.durable.files.includes("delivery-receipt-publication.test.js"));
  for (const id of ["V05A:", "V05B:"]) {
    assert.ok(lanes.durable.requiredNames.includes(id));
    assert.ok(lanes.all.requiredNames.includes(id));
    assert.equal(evaluateExecution({ exitCode: 0, tap: healthy, requiredNames: [id] }).status, "FAIL");
  }
  assert.equal(lanes.durable.requiredNames.includes("V05C:"), false, "local durable lane must not claim power-loss qualification");
});

test("R35 configuration snapshot oracles are required by durable and all lanes", () => {
  assert.ok(lanes.durable.files.includes("config-snapshot.test.js"));
  for (const id of ["V12A:", "V12B:"]) {
    assert.ok(lanes.durable.requiredNames.includes(id));
    assert.ok(lanes.all.requiredNames.includes(id));
    assert.equal(evaluateExecution({ exitCode: 0, tap: healthy, requiredNames: [id] }).status, "FAIL");
  }
});

test("R35 context preaccept ownership oracles are required by durable and all lanes", () => {
  for (const file of ["preaccept-ownership.test.js", "r21-context-workflow.test.js", "r21-context-stream.test.js"])
    assert.ok(lanes.durable.files.includes(file));
  for (const id of ["V18A:", "V18B:"]) {
    assert.ok(lanes.durable.requiredNames.includes(id));
    assert.ok(lanes.all.requiredNames.includes(id));
    assert.equal(evaluateExecution({ exitCode: 0, tap: healthy, requiredNames: [id] }).status, "FAIL");
  }
});

test("R35 receipt observation and settlement oracles are required by durable and all lanes", () => {
  for (const file of ["receipt-observation.test.js", "receipt-settlement.test.js"])
    assert.ok(lanes.durable.files.includes(file));
  for (const id of ["V06A:", "V06B local:"]) {
    assert.ok(lanes.durable.requiredNames.includes(id));
    assert.ok(lanes.all.requiredNames.includes(id));
    assert.equal(evaluateExecution({ exitCode: 0, tap: healthy, requiredNames: [id] }).status, "FAIL");
  }
  assert.equal(lanes.kernel.requiredNames.includes("V06B:"), false, "the kernel V06B oracle is not claimed by a local test");
});

test("R35 create and bootstrap preaccept oracles are required by durable and all lanes", () => {
  assert.ok(lanes.durable.files.includes("preaccept-ownership.test.js"));
  for (const id of ["V19A:", "V19B:"]) {
    assert.ok(lanes.durable.requiredNames.includes(id));
    assert.ok(lanes.all.requiredNames.includes(id));
    assert.equal(evaluateExecution({ exitCode: 0, tap: healthy, requiredNames: [id] }).status, "FAIL");
  }
});

test("R35 mail and submit preaccept oracles are required by durable and all lanes", () => {
  assert.ok(lanes.durable.files.includes("mail-submit-scope.test.js"));
  for (const id of ["V20A:", "V20B:"]) {
    assert.ok(lanes.durable.requiredNames.includes(id));
    assert.ok(lanes.all.requiredNames.includes(id));
    assert.equal(evaluateExecution({ exitCode: 0, tap: healthy, requiredNames: [id] }).status, "FAIL");
  }
});

test("R35 action category and admission oracles are required by their lanes", () => {
  assert.ok(lanes.fast.files.includes("request-validation-order.test.js"));
  assert.ok(lanes.durable.files.includes("unrestricted-admission.test.js"));
  for (const [lane, id] of [["fast", "V21A:"], ["durable", "V21B:"]]) {
    assert.ok(lanes[lane].requiredNames.includes(id));
    assert.ok(lanes.all.requiredNames.includes(id));
    assert.equal(evaluateExecution({ exitCode: 0, tap: healthy, requiredNames: [id] }).status, "FAIL");
  }
});

test("R35 storage reservation and settlement headroom oracles are required by their lanes", () => {
  assert.ok(lanes.stress.files.includes("stream-body-ownership.test.js"));
  assert.ok(lanes.durable.files.includes("mail-settlement-storage.test.js"));
  for (const [lane, id] of [["stress", "V22A:"], ["durable", "V22B:"]]) {
    assert.ok(lanes[lane].requiredNames.includes(id));
    assert.ok(lanes.all.requiredNames.includes(id));
    assert.equal(evaluateExecution({ exitCode: 0, tap: healthy, requiredNames: [id] }).status, "FAIL");
  }
});

test("R35 Git effect evidence oracles are required by durable and all lanes", () => {
  assert.ok(lanes.durable.files.includes("git-effect-evidence.test.js"));
  for (const id of ["V24A:", "V24B:"]) {
    assert.ok(lanes.durable.requiredNames.includes(id));
    assert.ok(lanes.all.requiredNames.includes(id));
    assert.equal(evaluateExecution({ exitCode: 0, tap: healthy, requiredNames: [id] }).status, "FAIL");
  }
});

test("R35 every required name of every lane is the start of a test in this tree", async () => {
  // A renamed test leaves its lane requiring a name nothing carries; the lane
  // then fails only when it is run, as a critical oracle not executed. Here it
  // fails with the rename. A templated name counts only through the part
  // before its first substitution, and only when that part is not empty.
  const { testNames } = await import("../scripts/review-closure.mjs");
  const names = testNames(fileURLToPath(new URL("..", import.meta.url)));
  const carries = (name, required) => {
    if (!name.includes("${")) return name.startsWith(required);
    const known = name.slice(0, name.indexOf("${"));
    return known.length > 0 && (required.startsWith(known) || known.startsWith(required));
  };
  const missing = Object.entries(lanes).flatMap(([lane, { requiredNames = [] }]) =>
    requiredNames.filter(required => !names.some(name => carries(name, required))).map(required => `${lane}: ${required}`));
  assert.deepEqual(missing, []);
});
