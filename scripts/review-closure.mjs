/** WP32 (V32A): whether every production file has a review status with
 * evidence, and whether the plan can be called approved. Verification tooling,
 * not production runtime; reading it measures nothing and writes nothing.
 *
 * A file is REVIEWED only when the ledger names the work that reviewed it and
 * the oracles that test it, and every named oracle exists as a test in this
 * tree. Being assigned to a work package is not a review. Approval additionally
 * needs every required environment lane to have run.
 */
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import { join } from "node:path";
import { createHash } from "node:crypto";

export const LEDGER = "implementation/review-ledger.json";
export const PLAN = "docs/archive/oma-v2-consistency-plan-b25961c/plan.json";
export const REVIEWED = Object.freeze(["CHANGED_WITH_ORACLE", "READ_UNCHANGED"]);
export const STATUSES = Object.freeze([...REVIEWED, "CHANGED_WITHOUT_ORACLE", "NOT_REVIEWED", "REMOVED"]);
/** Environment lanes release needs, and what this tree has recorded for them. */
export const RELEASE_LANES = Object.freeze(["fast", "durable", "property", "stress", "kernel", "crash", "powercut", "provider", "ci"]);
/** The one process bound every synchronous git plumbing call in this
 * verification tooling runs under: CANONICAL_PROCESS_LIMITS
 * (packages/git/src/canonical-command.ts), restated. These scripts also run copied
 * into fixture trees where no dist/ exists, so the constant cannot be
 * imported -- a test pins the two equal. Whole-tree plumbing (`ls-tree -r`,
 * `diff --name-only -z`, `log`) emits output that scales with the repository;
 * Node's 1 MiB execFileSync default was an ENOBUFS wedge, not a bound, once
 * the vendored bundles pushed this tree's own listing past it. */
export const GIT_PLUMBING_LIMITS = Object.freeze({ timeout: 120000, maxBuffer: 4 * 1024 * 1024 });

/** Authored test declarations, including workspace-owned tests. Source text
 * inside a comment, fixture string or vendored payload is not an oracle. */
export function testNames(root) {
  const names = [];
  const directory = path => {
    const stat = lstatSync(join(root, path), { throwIfNoEntry: false });
    if (stat === undefined) return false;
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`test source root is not a real directory: ${path}`);
    return true;
  };
  const walk = folder => {
    if (!directory(folder)) return;
    for (const entry of readdirSync(join(root, folder), { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`symlink in authored test sources: ${path}`);
      if (entry.isDirectory()) { if (entry.name !== "fixtures") walk(path); continue; }
      if (!entry.isFile() || !/\.test\.(ts|mjs)$/.test(entry.name)) continue;
      const source = ts.createSourceFile(path, readFileSync(join(root, path), "utf8"), ts.ScriptTarget.Latest, true);
      const visit = node => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "test") {
          const label = node.arguments[0];
          if (label && ts.isStringLiteralLike(label)) names.push(label.text);
          else if (label && ts.isTemplateExpression(label)) names.push(label.getText(source).slice(1, -1));
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  };
  walk("test");
  if (directory("packages")) for (const entry of readdirSync(join(root, "packages"), { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`symlink in workspace test discovery: ${entry.name}`);
    if (entry.isDirectory()) walk(join("packages", entry.name, "test"));
  }
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
      if (entry.sha256 !== undefined) {
        let actual;
        try { actual = createHash("sha256").update(readFileSync(join(root, entry.path))).digest("hex"); } catch { /* missing is stale */ }
        if (entry.sha256 !== actual) findings.push({ path: entry.path, problem: "reviewed change digest is stale" });
      }
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

export const ORACLE_MAP = "implementation/oracle-map.json";
/** The lanes a verification cycle executes; the `all` lane is a local aggregate. */
export const EXECUTED_LANES = Object.freeze(["fast", "durable", "property", "stress", "kernel", "crash"]);

/** Every plan oracle is a test by its own id, or carried by named tests, or
 * recorded as not run -- and whatever carries it is required by an executed
 * lane, so it cannot silently stop running. */
export async function oracleFindings(root, map = JSON.parse(readFileSync(join(root, ORACLE_MAP), "utf8"))) {
  const { lanes } = await import(new URL("./verification-lanes.mjs", import.meta.url).href);
  const plan = JSON.parse(readFileSync(join(root, PLAN), "utf8"));
  const names = testNames(root);
  const required = EXECUTED_LANES.flatMap(lane => lanes[lane]?.requiredNames ?? []);
  // A templated test name is known statically up to its first substitution.
  const covers = (name, r) => {
    if (!name.includes("${")) return name.startsWith(r);
    const known = name.slice(0, name.indexOf("${"));
    return r.startsWith(known) || known.startsWith(r);
  };
  const enforced = prefix => names.some(name => name.startsWith(prefix) && required.some(r => covers(name, r)));
  const findings = [];
  const notRun = [];
  for (const { id } of plan.tests) {
    const entry = map.oracles[id];
    if (!entry) {
      if (!oraclePresent(names, id)) findings.push({ id, problem: "no test carries it and the oracle map does not name one" });
      else if (!names.some(name => [`${id}:`, `${id} `, `${id}/`].some(p => name.startsWith(p)) && required.some(r => covers(name, r))))
        findings.push({ id, problem: "its test is not required by any executed lane" });
      continue;
    }
    if ((entry.carriedBy ?? []).length === 0 && !entry.notRun) findings.push({ id, problem: "mapped to nothing" });
    for (const carrier of entry.carriedBy ?? []) {
      if (!names.some(name => name.startsWith(carrier))) findings.push({ id, problem: `carrier "${carrier}" is not a test in this tree` });
      else if (!enforced(carrier)) findings.push({ id, problem: `carrier "${carrier}" is not required by any executed lane` });
    }
    if (entry.notRun) notRun.push(`${id}: ${entry.notRun}`);
  }
  for (const id of Object.keys(map.oracles)) if (!plan.tests.some(test => test.id === id)) findings.push({ id, problem: "the plan has no such oracle" });
  return { findings, notRun };
}

/** The approval verdict, with everything that stands in its way. */
export function approval(root, ledger = JSON.parse(readFileSync(join(root, LEDGER), "utf8")), oracles = { findings: [], notRun: [] }) {
  const findings = reviewFindings(root, ledger);
  const unreviewed = ledger.files.filter(entry => !REVIEWED.includes(entry.status) && entry.status !== "REMOVED").map(entry => entry.path);
  const lanes = ledger.lanes ?? {};
  const notRun = RELEASE_LANES.filter(lane => lanes[lane] !== "PASS");
  const blockers = [
    ...findings.map(f => `${f.path}: ${f.problem}`),
    ...(unreviewed.length > 0 ? [`${unreviewed.length} production files not reviewed`] : []),
    ...notRun.map(lane => `lane ${lane}: ${lanes[lane] ?? "NOT_RUN"}`),
    ...oracles.findings.map(f => `oracle ${f.id}: ${f.problem}`),
    ...oracles.notRun.map(line => `oracle ${line}`),
  ];
  return { approved: blockers.length === 0, blockers, unreviewed };
}
