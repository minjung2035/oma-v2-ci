// COMP-001..006: source-derived inventory. Missing evidence is a failing gate.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const sources = ["implementation-spec.md", "implementation/integration-policy.md",
  "implementation/physical-ordering.md", "implementation/compliance.md", "implementation/loc-budget.md",
  "implementation/test-matrix.md", "implementation/spikes.md", "implementation/validation.md"];
// Whole-source pins also invalidate evidence for tables/paragraphs outside a MUST line.
const key = (row) => JSON.stringify([row.source, row.requirement, row.digest]);
const textValue = (value) => typeof value === "string" && value.trim().length > 0;
const textList = (value) => Array.isArray(value) && value.length > 0 && value.every(textValue);
const fileOf = (locator) => locator.split("#")[0];
const entries = sources.flatMap((source) => {
  const text = readFileSync(source, "utf8");
  return [...text.matchAll(/\*\*(MUST(?: NOT)?|SHOULD|OPTIONAL) \[([^\]]+)\]\*\*([^\n]*(?:\n(?!\s*\n|\*\*)[^\n]+)*)/g)].map((match) => ({
    requirement: match[2], source, digest: digest(match[0]), normativeText: match[0],
    applicability: "unclassified", rationale: "Requires production-path review; no inference from test names.",
    owner: null, entrypoint: null, callPath: [], negativeTests: [], evidence: null, status: "unverified",
  }));
});
const tracePath = "implementation/traceability.json";
const trace = existsSync(tracePath) ? JSON.parse(readFileSync(tracePath, "utf8")) : [];
if (!Array.isArray(trace) || trace.some((row) => !row || typeof row !== "object"))
  throw new Error("trace must be an array of requirement records");
const previous = new Map(trace.map((row) => [key(row), row]));
if (previous.size !== trace.length) throw new Error("duplicate trace identity");
if (process.argv.includes("--inventory")) {
  const refreshed = entries.map((entry) => previous.get(key(entry)) ?? entry);
  writeFileSync(tracePath, JSON.stringify(refreshed, null, 2) + "\n");
  console.log(`Inventoried ${entries.length} normative clauses; matching records preserved, new clauses unverified.`);
} else {
  const production = readFileSync("production-files.txt", "utf8").trim().split(/\r?\n/);
  const closure = [...sources, ...production, "architecture.md", "implementation/spikes.md",
    "production-files.txt", "package.json", "package-lock.json"];
  const failures = entries.filter((entry) => {
    const row = previous.get(key(entry));
    if (!row || !["runtime", "build", "document", "optional"].includes(row.applicability) ||
      !["proven", "not_applicable"].includes(row.status) || !textValue(row.rationale) ||
      !textValue(row.owner) || !textValue(row.entrypoint) || !textList(row.callPath) ||
      !textList(row.negativeTests) || !row.evidence) return true;
    if (row.status === "not_applicable" && row.applicability !== "optional") return true;
    if (!/^.+#[^#]+$/.test(row.owner) || row.negativeTests.some((test) => !/^.+#[^#]+$/.test(test))) return true;
    if (!row.callPath.includes(row.owner) || !row.callPath.includes(row.entrypoint)) return true;
    const evidence = row.evidence;
    if (evidence.specDigest !== entry.digest || evidence.buildExit !== 0 || evidence.testExit !== 0 ||
      ![evidence.buildCommand, evidence.testCommand, evidence.environmentPin, evidence.logPath, evidence.logDigest].every(textValue) ||
      !evidence.sourceDigests || typeof evidence.sourceDigests !== "object" || Array.isArray(evidence.sourceDigests)) return true;
    try {
      if (digest(readFileSync(evidence.logPath)) !== evidence.logDigest) return true;
      const required = [...closure, fileOf(row.owner), fileOf(row.entrypoint),
        ...row.callPath.map(fileOf), ...row.negativeTests.map(fileOf)];
      if (required.some((file) => !Object.hasOwn(evidence.sourceDigests, file))) return true;
      return Object.entries(evidence.sourceDigests).some(([file, expected]) => digest(readFileSync(file)) !== expected);
    } catch { return true; }
  });
  const identities = new Set(entries.map(key));
  const extras = trace.filter((row) => !identities.has(key(row))).length;
  console.log(`${entries.length - failures.length}/${entries.length} clauses pass structural evidence checks; ${failures.length} unresolved; ${extras} stale/extra rows.`);
  // Behavioral ownership and real boundary evidence still require review (COMP-004).
  process.exitCode = failures.length || extras || entries.length === 0 ? 1 : 0;
}
