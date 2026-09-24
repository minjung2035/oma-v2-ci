/** WP32 (V32A): whether every production file has a review status with
 * evidence, and whether the plan can be called approved. Verification tooling,
 * not production runtime; reading it measures nothing and writes nothing.
 *
 * A file is REVIEWED only when the ledger names the work that reviewed it and
 * the oracles that test it, and every named oracle exists as a test in this
 * tree. Being assigned to a work package is not a review. Approval additionally
 * needs every required environment lane to have run.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const LEDGER = "implementation/review-ledger.json";
export const PLAN = "oma-v2-consistency-plan-b25961c/plan.json";
export const REVIEWED = Object.freeze(["CHANGED_WITH_ORACLE", "READ_UNCHANGED"]);
export const STATUSES = Object.freeze([...REVIEWED, "CHANGED_WITHOUT_ORACLE", "NOT_REVIEWED", "REMOVED"]);
/** Environment lanes release needs, and what this tree has recorded for them. */
export const RELEASE_LANES = Object.freeze(["fast", "durable", "property", "stress", "kernel", "crash", "powercut", "provider", "ci"]);

/** Every test name declared in the tree's test sources. */
export function testNames(root) {
  const names = [];
  const walk = directory => {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { if (entry.name !== "fixtures") walk(path); continue; }
      if (!/\.test\.(ts|mjs)$/.test(entry.name)) continue;
      for (const match of readFileSync(join(root, path), "utf8").matchAll(/\btest\(\s*(?:`([^`]*)`|"([^"]*)"|'([^']*)')/g))
        names.push(match[1] ?? match[2] ?? match[3]);
    }
  };
  walk("test");
  return names;
}
/** An oracle id is present when some test name starts with it. */
export function oraclePresent(names, id) {
  return names.some(name => name === id || name.startsWith(`${id}:`) || name.startsWith(`${id} `) || name.startsWith(`${id}/`));
}

export function reviewFindings(root, ledger = JSON.parse(readFileSync(join(root, LEDGER), "utf8"))) {
  const findings = [];
  const current = readFileSync(join(root, "production-files.txt"), "utf8").split("\n").filter(Boolean);
  const plan = JSON.parse(readFileSync(join(root, PLAN), "utf8"));
  const baseline = new Set(plan.production_review_assignments.map(row => row.path));
  const names = testNames(root);
  const byPath = new Map();
  for (const entry of ledger.files) {
    if (byPath.has(entry.path)) findings.push({ path: entry.path, problem: "listed twice" });
    byPath.set(entry.path, entry);
    if (!STATUSES.includes(entry.status)) findings.push({ path: entry.path, problem: `unknown status ${entry.status}` });
    if (REVIEWED.includes(entry.status)) {
      if (!Array.isArray(entry.by) || entry.by.length === 0) findings.push({ path: entry.path, problem: "reviewed by no work package" });
      if (!Array.isArray(entry.oracles) || entry.oracles.length === 0) findings.push({ path: entry.path, problem: "reviewed with no oracle" });
      for (const id of entry.oracles ?? []) if (!oraclePresent(names, id)) findings.push({ path: entry.path, problem: `oracle ${id} is not a test in this tree` });
    }
    if (entry.status === "REMOVED" && current.includes(entry.path)) findings.push({ path: entry.path, problem: "removed but still a production file" });
  }
  // The summary is generated; a hand-edited count is a finding.
  const counted = {};
  for (const entry of ledger.files) counted[entry.status] = (counted[entry.status] ?? 0) + 1;
  for (const status of new Set([...Object.keys(counted), ...Object.keys(ledger.summary ?? {})]))
    if ((counted[status] ?? 0) !== (ledger.summary?.[status] ?? 0)) findings.push({ path: LEDGER, problem: `summary says ${ledger.summary?.[status] ?? 0} ${status}, the files say ${counted[status] ?? 0}` });
  for (const path of current) if (!byPath.has(path)) findings.push({ path, problem: "production file missing from the ledger" });
  for (const path of baseline) if (!byPath.has(path)) findings.push({ path, problem: "baseline file missing from the ledger" });
  for (const path of byPath.keys()) if (!current.includes(path) && !baseline.has(path)) findings.push({ path, problem: "ledger names a file that is neither current nor baseline" });
  return findings;
}

/** The approval verdict, with everything that stands in its way. */
export function approval(root, ledger = JSON.parse(readFileSync(join(root, LEDGER), "utf8"))) {
  const findings = reviewFindings(root, ledger);
  const unreviewed = ledger.files.filter(entry => !REVIEWED.includes(entry.status) && entry.status !== "REMOVED").map(entry => entry.path);
  const lanes = ledger.lanes ?? {};
  const notRun = RELEASE_LANES.filter(lane => lanes[lane] !== "PASS");
  const blockers = [
    ...findings.map(f => `${f.path}: ${f.problem}`),
    ...(unreviewed.length > 0 ? [`${unreviewed.length} production files not reviewed`] : []),
    ...notRun.map(lane => `lane ${lane}: ${lanes[lane] ?? "NOT_RUN"}`),
  ];
  return { approved: blockers.length === 0, blockers, unreviewed };
}
