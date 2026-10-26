/** V32A (WP32): every production file carries a review status with evidence,
 * and approval is refused while any file is unreviewed or any required lane has
 * not run. The ledger is generated (`npm run review:ledger`); these oracles hold
 * the checker to refusing what the card forbids: a file assigned but not
 * reviewed counted as reviewed, a review with no oracle or an oracle that is not
 * a test, a missing file, a hand-edited summary. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { GIT_PLUMBING_LIMITS, LEDGER, ORACLE_MAP, approval, oracleFindings, reviewFindings } from "../scripts/review-closure.mjs";
import { CANONICAL_PROCESS_LIMITS } from "@oma/git/canonical-command";

const ledger = () => JSON.parse(readFileSync(LEDGER, "utf8"));
const problems = value => reviewFindings(".", value).map(finding => finding.problem);
const recount = value => { const counted = {}; for (const entry of value.files) counted[entry.status] = (counted[entry.status] ?? 0) + 1; value.summary = counted; return value; };
/** A local ledger fixture with one current file NOT_REVIEWED. A full move may
 * invalidate every READ_UNCHANGED claim; that must not disable refusal tests. */
const withUnreviewed = () => {
  const value = ledger();
  const index = value.files.findIndex(entry => entry.status !== "REMOVED");
  assert.ok(index >= 0, "the review fixture needs a current production file");
  Object.assign(value.files[index], { status: "NOT_REVIEWED", by: [], oracles: [] });
  delete value.files[index].note;
  return { value: recount(value), index };
};

test("V32A: the committed ledger accounts for every current and baseline file, with evidence for every review", () => {
  assert.deepEqual(reviewFindings("."), []);
  const value = ledger();
  assert.ok(value.files.length >= 220);
  for (const entry of value.files.filter(entry => entry.status === "CHANGED_WITH_ORACLE" || entry.status === "READ_UNCHANGED"))
    assert.ok(entry.by.length > 0 && entry.oracles.length > 0, entry.path);
});

test("DR27/V32A: historical review cannot certify unbound working-tree changes", () => {
  const paths = command => execFileSync("git", command, { encoding: "utf8", ...CANONICAL_PROCESS_LIMITS }).split("\0").filter(Boolean);
  const changed = new Set(paths(["diff", "--name-only", "-z", "HEAD", "--"]));
  const committed = new Set(paths(["ls-tree", "-r", "--name-only", "-z", "HEAD"]));
  for (const entry of ledger().files) {
    if (entry.status === "REMOVED" || entry.sha256 !== undefined) continue;
    if (changed.has(entry.path) || !committed.has(entry.path))
      assert.ok(!["CHANGED_WITH_ORACLE", "READ_UNCHANGED"].includes(entry.status), entry.path);
  }
});

/** The vendored bundles pushed this tree's `ls-tree -r` listing past Node's
 * 1 MiB execFileSync default, so both the ledger generator and this suite
 * wedged on ENOBUFS. The scripts' restated bound is pinned equal to the
 * canonical adapter's, and the generator must apply it at every synchronous
 * git call -- an unbounded execFileSync is how the wedge got in. */
test("V32A: verification git plumbing runs under the canonical process bound", () => {
  assert.deepEqual({ ...GIT_PLUMBING_LIMITS }, { ...CANONICAL_PROCESS_LIMITS });
  const source = readFileSync(new URL("../scripts/review-ledger.mjs", import.meta.url), "utf8");
  const calls = source.match(/\bexecFileSync\(/g) ?? [];
  const bounded = source.match(/\.\.\.GIT_PLUMBING_LIMITS\b/g) ?? [];
  assert.ok(calls.length >= 2, "the generator's git call sites were not found");
  assert.equal(bounded.length, calls.length, "a git exec in review-ledger.mjs lost the canonical bound");
});

test("V32A: a working-tree review is bound to the reviewed file bytes", () => {
  const value = ledger();
  const entry = value.files.find(entry => entry.status !== "REMOVED");
  assert.ok(entry, "the local review fixture needs a current file");
  // Only this parsed fixture claims review; the real ledger remains unreviewed.
  Object.assign(entry, { status: "CHANGED_WITH_ORACLE", by: ["fixture-only"], oracles: ["fixture-only"], sha256: "0".repeat(64) });
  assert.ok(problems(value).includes("reviewed change digest is stale"));
});

test("V32A: approval is refused while files are unreviewed or a required lane has not run", async () => {
  const oracles = await oracleFindings(".");
  const verdict = approval(".", undefined, oracles);
  assert.equal(verdict.approved, false);
  assert.ok(approval(".", withUnreviewed().value, oracles).blockers.some(line => /production files not reviewed/.test(line)));
  for (const lane of ["powercut", "provider", "ci"]) assert.ok(verdict.blockers.some(line => line.startsWith(`lane ${lane}:`)), lane);
  for (const id of ["V05C", "V30B", "V32B"]) assert.ok(verdict.blockers.some(line => line.startsWith(`oracle ${id}:`)), id);
});

test("V32A: every plan oracle is a test, or carried by tests an executed lane requires, or recorded as not run", async () => {
  const map = JSON.parse(readFileSync(ORACLE_MAP, "utf8"));
  assert.deepEqual((await oracleFindings(".", map)).findings, []);
  const findingsWith = async change => { const value = structuredClone(map); change(value); return (await oracleFindings(".", value)).findings.map(f => `${f.id} ${f.problem}`); };
  // A carrier that is not a test, or that no executed lane requires, carries nothing.
  assert.ok((await findingsWith(value => { value.oracles.V26A.carriedBy = ["R99: no such oracle"]; })).some(line => /V26A carrier "R99: no such oracle" is not a test/.test(line)));
  assert.ok((await findingsWith(value => { value.oracles.V26A.carriedBy = ["R14: every two-way split"]; })).some(line => /is not required by any executed lane/.test(line)));
  // Dropping a mapping leaves the oracle uncarried.
  assert.ok((await findingsWith(value => { delete value.oracles.V25B; })).some(line => /^V25B no test carries it/.test(line)));
  assert.ok((await findingsWith(value => { value.oracles.V99Z = { carriedBy: ["V02A:"] }; })).some(line => /^V99Z the plan has no such oracle/.test(line)));
});

test("V32A: an assignment is not a review, and a claimed review needs real oracles", () => {
  const { value: base, index } = withUnreviewed();
  assert.equal(base.files[index].status, "NOT_REVIEWED");
  const edit = change => { const value = structuredClone(base); change(value); const counted = {};
    for (const entry of value.files) counted[entry.status] = (counted[entry.status] ?? 0) + 1; value.summary = counted; return value; };
  assert.ok(problems(edit(value => { value.files[index].status = "READ_UNCHANGED"; })).includes("reviewed by no work package"));
  assert.ok(problems(edit(value => { Object.assign(value.files[index], { status: "READ_UNCHANGED", by: ["WP32"], oracles: [] }); })).includes("reviewed with no oracle"));
  assert.ok(problems(edit(value => { Object.assign(value.files[index], { status: "READ_UNCHANGED", by: ["WP32"], oracles: ["V99Z"] }); }))
    .includes("oracle V99Z is not a test in this tree"));
  assert.ok(problems(edit(value => { value.files.splice(index, 1); })).some(problem => /missing from the ledger/.test(problem)));
  const summary = structuredClone(base); summary.summary.NOT_REVIEWED -= 1;
  summary.summary.READ_UNCHANGED = (summary.summary.READ_UNCHANGED ?? 0) + 1;
  assert.ok(problems(summary).some(problem => /summary says/.test(problem)), "a hand-edited count passed");
});

test("V32A: with every file reviewed and every lane run, and only then, the verdict is approval", () => {
  const value = ledger();
  for (const entry of value.files) if (entry.status !== "REMOVED" && entry.status !== "CHANGED_WITH_ORACLE" && entry.status !== "READ_UNCHANGED")
    Object.assign(entry, { status: "READ_UNCHANGED", by: ["WP32"], oracles: ["V32A"] });
  const counted = {}; for (const entry of value.files) counted[entry.status] = (counted[entry.status] ?? 0) + 1; value.summary = counted;
  assert.equal(approval(".", value).approved, false, "approved with lanes not run");
  for (const lane of Object.keys(value.lanes)) value.lanes[lane] = "PASS";
  value.lanes.ci = "PASS";
  assert.equal(approval(".", value, { findings: [], notRun: ["V05C: not run"] }).approved, false, "approved with an oracle not run");
  const verdict = approval(".", value);
  assert.deepEqual(verdict.blockers, []);
  assert.equal(verdict.approved, true);
});
