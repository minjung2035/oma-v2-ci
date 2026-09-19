/** T116 / VAL-002: the CI workflow can only claim what it actually ran.
 *
 * The workflow is the only place a reader sees a verification result without
 * running anything, so the ways it can lie are worth a gate of their own: a
 * lane killed by an outer clock before its own budget, a lane whose environment
 * the runner does not have, and a failing pre-check that the generators that
 * run after it then erase.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lanes } from "../scripts/verification-lanes.mjs";

const workflow = readFileSync(
  new URL("../.github/workflows/architecture-verification.yml", import.meta.url), "utf8");

/** `run_check <label> <seconds> ...` invocations, as the workflow spells them. */
function checks() {
  return [...workflow.matchAll(/^\s*run_check (\S+) (\d+) (.*)$/gm)]
    .map(([, label, seconds, command]) => ({ label, seconds: Number(seconds), command }));
}

/** The lanes the workflow explicitly records as not run, from the loop that
 * writes their NOT_RUN rows. */
function notRunLanes() {
  const loop = workflow.match(/for lane in ([a-z ]+); do[\s\S]*?NOT_RUN/);
  return loop === null ? [] : loop[1].trim().split(/\s+/);
}

test("T116: no lane is killed by the workflow before its own budget expires", () => {
  const observed = checks();
  assert.ok(observed.length > 0, "the workflow runs no checks");
  for (const { label, seconds } of observed) {
    const lane = label.startsWith("verify-") ? lanes[label.slice("verify-".length)] : null;
    if (!lane) continue;
    assert.ok(seconds > lane.timeoutSeconds,
      `${label} is killed at ${seconds}s but reports at ${lane.timeoutSeconds}s, so its result would be a timeout, not an answer`);
  }
});

test("T116: the workflow runs only the lanes this runner's environment provides", () => {
  const run = new Set(checks().map(entry => entry.label));
  const recorded = notRunLanes();
  for (const [name, lane] of Object.entries(lanes)) {
    const label = `verify-${name}`;
    if (lane.environment === "systemd") {
      // A hosted runner has no systemd user manager: running the lane here
      // would produce a setup failure that says nothing about the code.
      assert.equal(run.has(label), false,
        `${label} is a systemd lane and cannot run on a hosted runner`);
      assert.ok(recorded.includes(name),
        `${label} must be recorded as NOT_RUN rather than left unmentioned`);
    } else {
      assert.ok(run.has(label), `${label} runs in this environment and is not run`);
    }
  }
});

test("T116: the job clock cannot fire before the checks it contains", () => {
  // Every check runs in sequence, so the job needs at least their sum. Without
  // this the per-check ceilings mean nothing: the outer clock kills the run
  // first and the evidence blames a check that was still inside its budget.
  const budget = checks().reduce((total, entry) => total + entry.seconds, 0);
  const job = Number(/timeout-minutes: (\d+)/.exec(workflow)?.[1] ?? 0);
  assert.ok(job * 60 >= budget,
    `the job stops at ${job} minutes but its checks may take ${Math.ceil(budget / 60)}`);
});

test("T116: the runner installs what the containment tests need rather than skipping them", () => {
  // Without bubblewrap the sandbox tests skip, the suite still exits zero, and
  // the run records a pass for work that never happened.
  assert.match(workflow, /apt-get install -y bubblewrap/);
});

test("T116: a stale inventory observed before the generators run fails the workflow", () => {
  // The generators rewrite the very files the pre-check looked at, so an
  // observation that only lands in a log would be erased by the next step.
  const section = workflow.slice(workflow.indexOf("check:inventory"));
  assert.match(section, /inventory_before=\$\?/);
  assert.ok(section.includes('if [ "$inventory_before" -ne 0 ]; then touch "$EVIDENCE/failed"; fi'),
    "a stale inventory is observed but does not fail the run");
});

test("T116: the evidence README never counts a lane that did not run as a pass", () => {
  const readme = workflow.match(/Exit codes and lane result\.json files are authoritative\.[^']*/)?.[0] ?? "";
  for (const word of ["SETUP_FAILED", "skips", "NOT_RUN", "timeouts"])
    assert.ok(readme.includes(word), `the README does not exclude ${word}`);
});
