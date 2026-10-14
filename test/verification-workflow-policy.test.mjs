/** T125 / VAL-002: the CI workflow can only claim what it actually ran.
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
import { verificationInputDigest } from "../scripts/source-digest.mjs";

const workflow = readFileSync(
  new URL("../.github/workflows/architecture-verification.yml", import.meta.url), "utf8");

/** `run_check <label> <seconds> ...` invocations, as the workflow spells them. */
function checks() {
  return [...workflow.matchAll(/^\s*run_check (\S+) (\d+) (.*)$/gm)]
    .map(([, label, seconds, command]) => ({ label, seconds: Number(seconds), command }));
}

/** The trigger block, from `on:` to the next top-level key. */
function triggerBlock() {
  const rest = workflow.slice(workflow.indexOf("\non:\n") + 1);
  return rest.slice(0, rest.search(/^permissions:/m));
}

/** The branches one event is wired to, or null when the event is not wired. */
function branchesFor(event) {
  const block = triggerBlock();
  const at = block.indexOf(`  ${event}:\n`);
  if (at < 0) return null;
  const list = /^ {4}branches: \[([^\]]*)\]$/m.exec(block.slice(at));
  return list === null ? null : list[1].split(",").map(entry => entry.trim());
}

/** One `- name:`-headed step's text. */
function step(name) {
  const at = workflow.indexOf(`- name: ${name}`);
  assert.ok(at > 0, `the workflow has no step named ${name}`);
  const rest = workflow.slice(at + 1);
  const end = rest.search(/^ {6}- (?:name|uses):/m);
  return end < 0 ? rest : rest.slice(0, end);
}

/** The lanes the workflow explicitly records as not run, from the loop that
 * writes their NOT_RUN rows. */
function notRunLanes() {
  const loop = workflow.match(/for lane in ([a-z ]+); do[\s\S]*?NOT_RUN/);
  return loop === null ? [] : loop[1].trim().split(/\s+/);
}

test("T125: no lane is killed by the workflow before its own budget expires", () => {
  const observed = checks();
  assert.ok(observed.length > 0, "the workflow runs no checks");
  for (const { label, seconds } of observed) {
    const lane = label.startsWith("verify-") ? lanes[label.slice("verify-".length)] : null;
    if (!lane) continue;
    assert.ok(seconds > lane.timeoutSeconds,
      `${label} is killed at ${seconds}s but reports at ${lane.timeoutSeconds}s, so its result would be a timeout, not an answer`);
  }
});

test("T125: the workflow runs only the lanes this runner's environment provides", () => {
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

test("T125: the job clock cannot fire before the checks it contains", () => {
  // Every check runs in sequence, so the job needs at least their sum. Without
  // this the per-check ceilings mean nothing: the outer clock kills the run
  // first and the evidence blames a check that was still inside its budget.
  const budget = checks().reduce((total, entry) => total + entry.seconds, 0);
  const job = Number(/timeout-minutes: (\d+)/.exec(workflow)?.[1] ?? 0);
  assert.ok(job * 60 >= budget,
    `the job stops at ${job} minutes but its checks may take ${Math.ceil(budget / 60)}`);
});

test("T125: the runner installs what the containment tests need rather than skipping them", () => {
  // Without bubblewrap the sandbox tests skip, the suite still exits zero, and
  // the run records a pass for work that never happened.
  assert.match(workflow, /apt-get install -y bubblewrap/);
});

test("T125: the line counter is the pinned release, verified before it runs", () => {
  // The LOC gate compares every count against a fresh measurement, so the tool
  // doing the measuring is evidence too. A distribution package of another
  // version, or an unverified download, would make that comparison meaningless.
  assert.match(workflow, /cloc\/releases\/download\/v2\.08\/cloc-2\.08\.pl/);
  assert.match(workflow, /[0-9a-f]{64}  \/tmp\/cloc-2\.08\.pl" \| sha256sum -c -/);
  const install = workflow.indexOf("sha256sum -c -");
  assert.ok(install > 0 && install < workflow.indexOf("install -m 0755 /tmp/cloc-2.08.pl"),
    "the tool is installed before its digest is checked");
  assert.ok(workflow.indexOf("Install the pinned line counter") < workflow.indexOf("check:inventory"),
    "the inventory is checked before the tool it needs is installed");
});

test("T125: the pre-generation inventory check asserts committed source digests before generating CI measurements", () => {
  // Source digests are checked before generation; measuring LOC requires the
  // pinned tool separately and must not rewrite the committed source claim.
  assert.match(workflow, /npm run check:inventory > "\$EVIDENCE\/inventory-before\.log"/);
  assert.doesNotMatch(workflow, /OMA_REQUIRE_MEASUREMENT=1/);
  assert.match(workflow, /run_check loc 900 node scripts\/loc\.mjs --out "\$EVIDENCE"/);
  assert.ok(workflow.indexOf('npm run check:inventory >') < workflow.indexOf('run_check loc 900'));
});

test("T125: committed source artifacts cannot be regenerated into a passing claim; LOC is not a committed gate", () => {
  // Recording rewritten source digests as an artifact and passing anyway would
  // hide a stale claim. LOC figures themselves are no longer commit inputs.
  const section = workflow.slice(workflow.indexOf("generated-inventory.patch"));
  assert.match(section, /git diff --exit-code -- production-files\.txt production-loc-hashes\.json/);
  assert.doesNotMatch(section, /HEAD:production-loc\.json/);
  assert.doesNotMatch(workflow, /cp production-files\.txt production-loc\.json/);
  assert.match(section, /touch "\$EVIDENCE\/failed"/);
});

test("T125: a stale inventory observed before the generators run fails the workflow", () => {
  // The generators rewrite the very files the pre-check looked at, so an
  // observation that only lands in a log would be erased by the next step.
  const section = workflow.slice(workflow.indexOf("check:inventory"));
  assert.match(section, /inventory_before=\$\?/);
  assert.ok(section.includes('if [ "$inventory_before" -ne 0 ]; then touch "$EVIDENCE/failed"; fi'),
    "a stale inventory is observed but does not fail the run");
});

test("T125: the evidence README never counts a lane that did not run as a pass", () => {
  const readme = workflow.match(/Exit codes and lane result\.json files are authoritative\.[^']*/)?.[0] ?? "";
  for (const word of ["SETUP_FAILED", "skips", "NOT_RUN", "timeouts"])
    assert.ok(readme.includes(word), `the README does not exclude ${word}`);
});

test("T125: every branch that can become master is verified before it does", () => {
  // Verifying only the integration branch means master's own bytes, and every
  // proposal to change them, are never observed by CI at all.
  const pushed = branchesFor("push");
  assert.ok(pushed?.includes("master"), "a push to master runs no verification");
  assert.ok(pushed?.includes("refactor/safety-preserving-architecture"),
    "the integration branch lost its verification");
  assert.ok(branchesFor("pull_request")?.includes("master"),
    "a proposal to change master is never verified as a proposal");
});

test("T125: the run verifies the commit under test, not the merge commit CI invented", () => {
  // On a pull request `github.sha` names a merge commit this workflow made up.
  // It exists in no repository after the run, so a tree checked out from it --
  // and any evidence filed under it -- can never be compared with a commit
  // again. The head commit is the thing being proposed, so it is the thing
  // that must be checked out.
  const claimed = /VERIFIED_SHA: (\$\{\{ [^}]*\}\})/.exec(workflow);
  assert.ok(claimed, "the workflow names no commit it claims to verify");
  assert.equal(claimed[1], "${{ github.event.pull_request.head.sha || github.sha }}");
  const checkout = workflow.slice(workflow.indexOf("actions/checkout@"));
  const ref = /^ {10}ref: (.*)$/m.exec(checkout.slice(0, checkout.search(/^ {6}- name:/m)));
  assert.ok(ref, "the checkout takes the event's default ref, which on a pull request is the merge commit");
  assert.equal(ref[1].trim(), claimed[1],
    "the checkout and the claimed commit are chosen independently, so they can disagree");
});

test("T125: nothing is measured until the tree is the commit the evidence names", () => {
  const bind = step("Bind this run to the exact commit it verifies");
  assert.match(bind, /head="\$\(git rev-parse HEAD\)"/);
  assert.match(bind, /test "\$head" = "\$VERIFIED_SHA"/,
    "the run records results without ever confirming which commit produced them");
  // A result recorded under a SHA that did not produce it is worse than none,
  // so the comparison has to come before anything that produces a result.
  const bound = workflow.indexOf('test "$head" = "$VERIFIED_SHA"');
  for (const measurement of ["npm ci", "run_check", "check:inventory"])
    assert.ok(bound > 0 && bound < workflow.indexOf(measurement),
      `${measurement} runs before the run knows which commit it is measuring`);
});

test("T125: the evidence says which bytes of that commit ran, taken before the generators", () => {
  // A commit name says which revision was meant, not which bytes were
  // measured; the generators below rewrite inputs, so a digest taken later
  // would describe a tree that no commit ever held.
  const record = step("Record which bytes of that commit were verified");
  assert.match(record, /scripts\/source-digest\.mjs/);
  assert.match(record, /verificationInputDigest\("\."\)/);
  assert.equal(typeof verificationInputDigest, "function",
    "the workflow calls an export the local gate no longer has");
  assert.match(record, /printf 'commit\\t%s\\n' "\$VERIFIED_SHA"/,
    "the recorded bytes are not filed under the commit they came from");
  const taken = workflow.indexOf("verification-input-digest.tsv");
  for (const generator of ["npm ci", "run_check loc", "check:inventory"])
    assert.ok(taken > 0 && taken < workflow.indexOf(generator),
      `${generator} may rewrite an input before the digest is taken`);
});

test("T125: evidence is filed under the commit that produced it", () => {
  const names = [...workflow.matchAll(/^ {10}name: (oma-.*)$/gm)].map(([, name]) => name.trim());
  assert.ok(names.length >= 2, "the workflow uploads fewer artifacts than it has evidence");
  for (const name of names) {
    assert.match(name, /\$\{\{ env\.VERIFIED_SHA \}\}/, `${name} is not filed under the verified commit`);
    assert.doesNotMatch(name, /github\.sha/,
      `${name} is filed under the merge commit, which no tree can be checked against`);
  }
});

test("T125: a run that lost its binding cannot report success", () => {
  // Unbound evidence is not evidence: a green result that names no commit is
  // exactly the reading error this whole file exists to prevent.
  const propagate = step("Propagate unsuccessful verification");
  assert.match(propagate, /test -f "\$EVIDENCE\/provenance\.tsv"/);
  assert.match(propagate, /grep -qxF "\$\(printf 'commit\\t%s' "\$VERIFIED_SHA"\)" "\$EVIDENCE\/provenance\.tsv"/,
    "the final gate accepts provenance that names another commit");
});
