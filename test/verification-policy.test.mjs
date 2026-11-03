import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { evaluateExecution, validateCrashObservation, lanes, unrunDirectives, unrunTests } from "../scripts/verification-lanes.mjs";
const healthy = ["TAP version 13", "1..2", "ok 1 - critical oracle", "ok 2 - second oracle", "# tests 2", "# pass 2", "# fail 0", "# cancelled 0", "# skipped 0", "# todo 0", ""].join("\n");
const evaluate = tap => evaluateExecution({ exitCode: 0, tap, requiredNames: ["critical oracle"], baselineNames: ["critical oracle", "second oracle"] });
test("001. Evidence policy accepts real complete summaries but never AST counts as execution", () => {
  assert.equal(evaluate(healthy).status, "PASS");
  assert.equal(evaluate("# AST call sites: 2\n").status, "FAIL");
  assert.equal(evaluate("build started\n").status, "FAIL");
  assert.equal(evaluateExecution({ exitCode: 0, tap: "# tests 0\n# pass 0\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n" }).status, "FAIL");
});
test("002. Evidence policy detects hidden skips, todo, cancellation and critical oracle deletion", () => {
  for (const bad of [healthy.replace("ok 1 - critical oracle", "ok 1 - critical oracle # SKIP missing systemd"),
    healthy.replace("# skipped 0", "# skipped 1").replace("# pass 2", "# pass 1"),
    healthy.replace("# todo 0", "# todo 1"), healthy.replace("# cancelled 0", "# cancelled 1"),
    healthy.replace("critical oracle", "renamed unrelated test"), healthy.replace("second oracle", "different test"),
    healthy.replace("# tests 2", "# tests 999")]) assert.equal(evaluate(bad).status, "FAIL");
  assert.equal(evaluateExecution({ exitCode: 1, tap: healthy }).status, "FAIL");
  assert.equal(evaluateExecution({ exitCode: 0, signal: "SIGKILL", tap: healthy }).status, "FAIL");
});
test("003. Death evidence requires reached boundary, SIGKILL and restart independently", () => {
  const observed = { requestedPoint: "submit-ref", reachedPoint: "submit-ref", signal: "SIGKILL", restarted: true };
  assert.equal(validateCrashObservation(observed), true);
  for (const bad of [{ ...observed, reachedPoint: "timeout" }, { ...observed, signal: "SIGSTOP" },
    { ...observed, signal: null }, { ...observed, restarted: false }]) assert.equal(validateCrashObservation(bad), false);
  assert.ok(lanes.crash.proof.includes("not an entrypoint-crash"));
  assert.ok(lanes.crash.proof.includes("VM-power-loss"));
  assert.equal(lanes.kernel.environment, "linux-native");
});

test("004. Every verification lane names a current test source", () => {
  for (const [laneName, lane] of Object.entries(lanes)) {
    if (lane.files !== "all")
      for (const file of lane.files)
        assert.ok(existsSync(new URL(file.replace(/\.js$/, ".ts"), import.meta.url)), `${laneName}: ${file}`);
    for (const file of lane.sourceFiles)
      assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), `${laneName}: ${file}`);
  }
});

test("005. The local suite's own summary is read the same way a lane's is", () => {
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

test("006. Stable consistency IDs and real fixture/checkpoint cases belong to explicit lanes", () => {
  assert.ok(lanes.fast.sourceFiles.includes("test/config-bundle-owner.test.mjs"));
  assert.ok(lanes.fast.sourceFiles.includes("test/consistency-decisions.test.mjs"));
  assert.ok(lanes.fast.requiredNames.includes("011. Operations config: "));
  assert.ok(lanes.durable.files.includes("checkpoint-driver.test.js"));
  assert.ok(["001. Confirmed process death at ",
    "002. Checkpoint driver: ",
    "003. Actual death leaves the pre-rename temporary whereas ordinary throw cleaned it",
    "004. A lying checkpoint message cannot satisfy the independent effect oracle",
    "005. Actual Mail acceptance survives commit-before-response in a fresh process",
    "006. Published Git CAS is observed independently before result mail and response"].every(name => lanes.durable.requiredNames.includes(name)));
  assert.ok(lanes.property.files.includes("effect-observation.test.js"));
  assert.ok(["001. Independent raw SQL and physical Mail effects detect duplicate replay",
    "003. Controlled unit requests are counted apart from committed lifecycle facts"].every(name => lanes.property.requiredNames.includes(name)));
  for (const id of ["001. Execution order names every WP once and preserves late observation dependencies",
    "004. Every domain names facts, relations, phase and current authority",
    "005. All proposed cases have existing rule, owner, oracle and compatibility",
    "007. Existing normative requirements explicitly carry their reviewed decision",
    "008. Identifies the reviewed architecture bytes", "002. Change surfaces retain distinct registries and name real existing owners",
    "003. Profile review cannot imply unexecuted runtime qualification", "011. Operations config: ",
    "002. Config editor performs an observable replacement and remains loadable", "001. Confirmed process death at ",
    "002. Checkpoint driver: ",
    "003. Actual death leaves the pre-rename temporary whereas ordinary throw cleaned it",
    "004. A lying checkpoint message cannot satisfy the independent effect oracle",
    "005. Actual Mail acceptance survives commit-before-response in a fresh process",
    "006. Published Git CAS is observed independently before result mail and response", "001. Independent raw SQL and physical Mail effects detect duplicate replay",
    "003. Controlled unit requests are counted apart from committed lifecycle facts",
    "006. Stable consistency IDs and real fixture/checkpoint cases belong to explicit lanes"]) {
    assert.ok(lanes.all.requiredNames.includes(id), `all lane omits ${id}`);
    assert.equal(evaluateExecution({ exitCode: 0, tap: healthy, requiredNames: [id] }).status, "FAIL");
  }
});

test("007. Dummy restart checks are required by durable without replacing power-loss evidence", () => {
  assert.ok(lanes.durable.sourceFiles.includes("test/powercut-lane.test.mjs"));
  for (const id of ["005. Simulation: real accepted mail survives checkpoint, dummy restart and repeated same-key recovery", "006. Simulation: missing immutable bytes are a real diagnostic failure, not successful recovery",
    "007. Simulation: checkpoint failure never calls cut or leaves successful evidence", "008. Simulation: UNKNOWN, failed recovery and foreign or unchanged boot evidence never pass", "009. Simulation: recovery child readiness, early exit, spawn error and timeout are observed asynchronously"]) {
    assert.ok(lanes.durable.requiredNames.includes(id));
    assert.equal(evaluateExecution({ exitCode: 0, tap: healthy, requiredNames: [id] }).status, "FAIL");
  }
});

function requireDurableOracles(ids) {
  for (const id of ids) {
    assert.ok(lanes.durable.requiredNames.includes(id), `durable lane omits ${id}`);
    assert.ok(lanes.all.requiredNames.includes(id), `all lane omits ${id}`);
    assert.equal(evaluateExecution({ exitCode: 0, tap: healthy, requiredNames: [id] }).status, "FAIL");
  }
}

test("008. Store opening oracles are required by durable and all lanes", () => {
  assert.ok(lanes.durable.files.includes("store-open.test.js"));
  assert.equal(lanes.all.files, "all");
  requireDurableOracles(["001. Unsupported ",
    "002. Store open: ",
    "003. Store open: ",
    "004. An unversioned foreign schema is not a fresh OMA database",
    "005. Corrupt bytes are refused without replacement or sidecar creation",
    "006. Sidecar arrival during preflight prevents writer setup",
    "007. A killed rollback-journal transaction is preserved, not recovered before refusal",
    "014. Supported current schema ", "008. OS read-only permissions refuse writing and retain no constructor handle",
    "009. Failed ",
    "010. Initialization and close failures retain both causes",
    "011. Failed schema application retains its rollback failure and still closes",
    "012. Busy writer setup closes its handle without releasing another connection's lock",
    "013. Store open: ",
    "015. Fresh and supported Store ownership still transfers to the caller"]);
});

test("009. Config ownership oracles use their prescribed lanes and stable IDs", () => {
  assert.ok(lanes.fast.files.includes("config-edit-descriptors.test.js"));
  assert.ok(lanes.fast.requiredNames.includes("001. One own-key descriptor registry covers every editable field and policy"));
  assert.ok(lanes.durable.files.includes("config-editing.test.js"));
  assert.ok(["001. The inline writer validates before replacement",
    "002. Invalid "].every(name => lanes.durable.requiredNames.includes(name)));
  assert.ok(lanes.property.files.includes("config-validation.test.js"));
  assert.ok(["001. The pure validator returns a deep immutable snapshot with own-key maps",
    "002. Zero bootstrap seeds expose no editable profile target",
    "003. Config edits do not rewrite accepted Store identities or frozen specs"].every(name => lanes.property.requiredNames.includes(name)));
  for (const id of ["001. The inline writer validates before replacement",
    "002. Invalid ", "001. One own-key descriptor registry covers every editable field and policy", "001. The pure validator returns a deep immutable snapshot with own-key maps",
    "002. Zero bootstrap seeds expose no editable profile target",
    "003. Config edits do not rewrite accepted Store identities or frozen specs"]) {
    assert.ok(lanes.all.requiredNames.includes(id), `all lane omits ${id}`);
    assert.equal(evaluateExecution({ exitCode: 0, tap: healthy, requiredNames: [id] }).status, "FAIL");
  }
});

test("010. Preaccept ownership oracles are required by durable and all lanes", () => {
  assert.ok(lanes.durable.files.includes("preaccept-scope.test.js"));
  requireDurableOracles(["001. One cleanup failure does not skip another owned resource",
    "002. Observation uncertainty retains every preaccept resource",
    "003. Uncertain native preparation quiescence retains the resource",
    "004. Scope preserves the primary cause, aggregates cleanup, and reports dispositions",
    "005. Cleanup-unconfirmed can retry once without creating new ownership",
    "006. Identity loss is cleanup-unconfirmed and never deletes the replacement", "007. An accepted row that does not reference the artifact discards it"]);
});

test("011. Delivery receipt publication oracles are required by durable and all lanes", () => {
  assert.ok(lanes.durable.files.includes("delivery-receipt-publication.test.js"));
  requireDurableOracles(["001. Receipt success follows temp fsync, no-replace publication, validation and parent fsync",
    "002. Invalid boundary is rejected before a final name exists",
    "003. A crash at temp write never leaves partial bytes under the final name",
    "004. Final publication followed by parent-fsync uncertainty preserves the valid final receipt",
    "007. The receipt file itself is flushed before it is published, and its directory after", "005. EEXIST returns the first valid private receipt and never overwrites it",
    "006. Conflicting existing receipt is preserved and never converted to success"]);
  assert.equal(lanes.durable.requiredNames.includes("V05C:"), false, "local durable lane must not claim power-loss qualification");
});

test("012. Configuration snapshot oracles are required by durable and all lanes", () => {
  assert.ok(lanes.durable.files.includes("config-snapshot.test.js"));
  requireDurableOracles(["001. One snapshot uses one manifest even when the pointer is replaced after its read",
    "005. A file changed after the snapshot read it, before the snapshot completes, fails the snapshot", "002. Prompt references remain index-root relative and enter the bounded source closure",
    "003. Aggregate source bytes are bounded even when each referenced file is individually valid",
    "004. One configuration file over the document bound is refused even though the whole source would fit"]);
});

test("013. Context preaccept ownership oracles are required by durable and all lanes", () => {
  for (const file of ["preaccept-ownership.test.js", "r21-context-workflow.test.js", "r21-context-stream.test.js"])
    assert.ok(lanes.durable.files.includes(file));
  requireDurableOracles(["010. Preaccept order is stream, staged tree, candidate, mail object, acceptance, then canonical effect",
    "011. Preaccept ownership: ",
    "012. A lost acceptance acknowledgement retains the accepted tree and object, and recovery uses them",
    "013. An unavailable acceptance observation after refusal retains the tree and object",
    "014. Native preparation uncertainty retains only the tree that preparation may still use",
    "007. A failed preparation keeps its root when a file it created was replaced",
    "008. A staging root replaced after preparation is kept, and its cleanup is reported unconfirmed", "004. Accepted context evidence outlives its RPC connection; same-key retry and reconcile reuse the frozen plan"]);
});

test("014. Receipt observation and settlement oracles are required by durable and all lanes", () => {
  for (const file of ["receipt-observation.test.js", "receipt-settlement.test.js"])
    assert.ok(lanes.durable.files.includes(file));
  requireDurableOracles(["001. A verified receipt completes the batch and the runner presents nothing again",
    "003. An observed absent ",
    "004. Receipt observation: ",
    "005. Receipt observation: ",
    "006. The observer returns verified receipts it issued, and nothing else counts as one",
    "007. Absence names which name is missing, under a runner root that exists",
    "008. An observation that did not complete is unavailable, with its cause and the expected identity",
    "009. Conflicting evidence says what differs, and a legacy incarnation is never accepted as current",
    "010. A receipt directory that cannot be opened is unavailable, never absent",
    "011. Live completion binds the current run's incarnation and the receipt's session",
    "001. Recovery settles only a verified receipt; absent, unavailable and conflicting settle nothing",
    "002. A completed batch keeps its first terminal fact under recovery", "003. Local: a stale runner's live completion stays refused while the broker settles its exact receipt",
    "004. Local: settlement authority ends with the opening run and names one actor and incarnation",
    "005. Local: recovery for one actor cannot settle another actor's batch"]);
  assert.equal(lanes.kernel.requiredNames.includes("V06B:"), false, "the kernel V06B oracle is not claimed by a local test");
});

test("015. Create and bootstrap preaccept oracles are required by durable and all lanes", () => {
  assert.ok(lanes.durable.files.includes("preaccept-ownership.test.js"));
  requireDurableOracles(["015. When ",
    "016. A registry that changes during preparation refuses the whole seed set and settles every brief",
    "017. An accepted seed set retains exactly the briefs its plans name", "018. A policy refresh that fails after the brief was frozen removes that brief",
    "019. A same-name, same-spec race has one physical winner and the linked loser owns no brief"]);
});

test("016. Mail and submit preaccept oracles are required by durable and all lanes", () => {
  assert.ok(lanes.durable.files.includes("mail-submit-scope.test.js"));
  requireDurableOracles(["001. A mail object whose publication fails after its link is removed before any acceptance",
    "002. A refused mail acceptance whose cleanup also fails reports the refusal first and keeps the object",
    "003. A same-key retry after acceptance returns the frozen message; recovery delivers the frozen recipients",
    "004. A submit same-key retry after acceptance reads no new bundle, and publication happens once", "005. Recovery rebuilds only the missing derived links from the unchanged authoritative object",
    "006. A derived name holding other bytes is conflicting evidence, never overwritten or success",
    "007. An existing archive without every delivery materialized never records success"]);
});

test("017. Action category and admission oracles are required by their lanes", () => {
  assert.ok(lanes.fast.files.includes("request-validation-order.test.js"));
  assert.ok(lanes.durable.files.includes("unrestricted-admission.test.js"));
  for (const [lane, id] of [["fast","001. A read preserves authentication, version and DTO checks"], ["durable","001. Over the storage limit reads and accepted same-key lookups answer, new work and safety stops proceed"],
    ["durable","002. Over the storage limit runner reads answer and settlement uses its normal validation"],
    ["durable","003. Over the storage limit recovery settles safety stages and settles new effects and settlement"],
    ["durable","004. Within the limit the same recovery settles the mail and activates the waiting unit"],
    ["durable","005. A mail failure after its acceptance is reported as accepted, never as a refusal"],
    ["durable","006. A submit effect failure recorded as unknown is reported for same-key lookup"],
    ["durable","007. A startup stop that cannot be confirmed still leaves every other resident stopped"]]) {
    assert.ok(lanes[lane].requiredNames.includes(id));
    assert.ok(lanes.all.requiredNames.includes(id));
    assert.equal(evaluateExecution({ exitCode: 0, tap: healthy, requiredNames: [id] }).status, "FAIL");
  }
});

test("018. Storage reservation and settlement headroom oracles are required by their lanes", () => {
  assert.ok(lanes.stress.files.includes("stream-body-ownership.test.js"));
  assert.ok(lanes.durable.files.includes("mail-settlement-storage.test.js"));
  for (const [lane, id] of [["stress","001. A streamed submission owns its body until execution settles while ordinary mail proceeds"],
    ["stress","003. Partial transport bodies close once and large-tree streams remain unrestricted"], ["durable","001. Large existing state does not block recovery, new mail or activation"],
    ["durable","002. Recovery retains frozen bytes in a larger tree and never replays settled facts"],
    ["durable","003. Ordinary settlement materializes the frozen mail for every recipient"],
    ["durable","004. On a real full filesystem new work is STORAGE_FULL and accepted mail is never complete without its views"]]) {
    assert.ok(lanes[lane].requiredNames.includes(id));
    assert.ok(lanes.all.requiredNames.includes(id));
    assert.equal(evaluateExecution({ exitCode: 0, tap: healthy, requiredNames: [id] }).status, "FAIL");
  }
});

test("019. Git effect evidence oracles are required by durable and all lanes", () => {
  assert.ok(lanes.durable.files.includes("git-effect-evidence.test.js"));
  requireDurableOracles(["001. Git effect evidence: ",
    "004. A recovery CAS that loses to a third writer after its checks is unknown, never applied", "002. A no-op integration recovered after ",
    "003. An applied non-no-op CAS is settled as history even after stop and policy change"]);
});

test("020. Every required test belongs to the files its lane actually executes", async () => {
  // A renamed test leaves its lane requiring a name nothing carries; the lane
  // then fails only when it is run, as a critical oracle not executed. Here it
  // fails with the rename. A templated name counts only through the part
  // before its first substitution, and only when that part is not empty.
  const { testDeclarations } = await import("../scripts/review-closure.mjs");
  const { workspaceTestFiles } = await import("../scripts/check-modules.mjs");
  const root = fileURLToPath(new URL("..", import.meta.url));
  const declarations = testDeclarations(root);
  const workspace = workspaceTestFiles(root);
  const carries = (name, required) => {
    if (!name.includes("${")) return name.startsWith(required);
    const known = name.slice(0, name.indexOf("${"));
    return known.length > 0 && (required.startsWith(known) || known.startsWith(required));
  };
  const missingFrom = (lane, definition) => {
    const selected = definition.files === "all" ? null : new Set([
      ...definition.files.map(file => `test/${file.replace(/\.js$/, ".ts")}`),
      ...definition.sourceFiles, ...(lane === "fast" ? workspace : []),
    ]);
    const names = declarations.filter(entry => selected === null || selected.has(entry.file)).map(entry => entry.name);
    return definition.requiredNames.filter(required => !names.some(name => carries(name, required)));
  };
  assert.deepEqual(Object.entries(lanes).flatMap(([lane, definition]) =>
    missingFrom(lane, definition).map(required => `${lane}: ${required}`)), []);
  const missingStore = { ...lanes.fast, files: lanes.fast.files.filter(file => file !== "store-open.test.js") };
  assert.ok(missingFrom("fast", missingStore).some(name => name.includes("An unversioned foreign schema")),
    "a test elsewhere in the tree cannot satisfy a lane that never executes its file");
});
