/** V32A (WP32): every production file carries a review status with evidence,
 * and approval is refused while any file is unreviewed or any required lane has
 * not run. The ledger is generated (`npm run review:ledger`); these oracles hold
 * the checker to refusing what the card forbids: a file assigned but not
 * reviewed counted as reviewed, a review with no oracle or an oracle that is not
 * a test, a missing file, a hand-edited summary. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LEDGER, ORACLE_MAP, approval, oracleFindings, reviewFindings } from "../scripts/review-closure.mjs";

const ledger = () => JSON.parse(readFileSync(LEDGER, "utf8"));
const problems = value => reviewFindings(".", value).map(finding => finding.problem);

test("V32A: the committed ledger accounts for every current and baseline file, with evidence for every review", () => {
  assert.deepEqual(reviewFindings("."), []);
  const value = ledger();
  assert.ok(value.files.length >= 220);
  for (const entry of value.files.filter(entry => entry.status === "CHANGED_WITH_ORACLE" || entry.status === "READ_UNCHANGED"))
    assert.ok(entry.by.length > 0 && entry.oracles.length > 0, entry.path);
});

test("V32A: approval is refused while files are unreviewed or a required lane has not run", async () => {
  const verdict = approval(".", undefined, await oracleFindings("."));
  assert.equal(verdict.approved, false);
  assert.ok(verdict.blockers.some(line => /production files not reviewed/.test(line)));
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
  const base = ledger();
  const index = base.files.findIndex(entry => entry.status === "NOT_REVIEWED");
  assert.ok(index >= 0);
  const edit = change => { const value = structuredClone(base); change(value); const counted = {};
    for (const entry of value.files) counted[entry.status] = (counted[entry.status] ?? 0) + 1; value.summary = counted; return value; };
  assert.ok(problems(edit(value => { value.files[index].status = "READ_UNCHANGED"; })).includes("reviewed by no work package"));
  assert.ok(problems(edit(value => { Object.assign(value.files[index], { status: "READ_UNCHANGED", by: ["WP32"], oracles: [] }); })).includes("reviewed with no oracle"));
  assert.ok(problems(edit(value => { Object.assign(value.files[index], { status: "READ_UNCHANGED", by: ["WP32"], oracles: ["V99Z"] }); }))
    .includes("oracle V99Z is not a test in this tree"));
  assert.ok(problems(edit(value => { value.files.splice(index, 1); })).some(problem => /missing from the ledger/.test(problem)));
  const summary = structuredClone(base); summary.summary.NOT_REVIEWED -= 1; summary.summary.READ_UNCHANGED += 1;
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
