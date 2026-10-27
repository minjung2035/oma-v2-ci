// Static review artifact only. Neither classification nor source inventory is proof.
import fs from "node:fs";
import ts from "typescript";
import { runtimeImportClosure } from "./architecture-check.mjs";
import { loadTraceInventory, normativeSources, traceIdentity, indexTrace, inventoryAcceptance } from "./traceability.mjs";
const { entries, rows: recorded, linkedRows, extras } = loadTraceInventory();
const previous = indexTrace(recorded);
const missingTrace = entries.filter(entry => !previous.has(traceIdentity(entry)));
const scopeRules = [
  [/^(N-(002|003|004|005|006)|POL-(001|003|008)|PACK-00[124]|VAL-00[123])$/, "document", "Normative interpretation, reporting or sender/Principal practice; no workflow engine is authorized."],
  [/^(N-001|A-00[489]|M-00[12]|POL-00[57]|TRACE-.+|COMP-.+|LOC-.+|TEST-.+|SP-.+|VAL-00[45])$/, "build", "Release/source/testing contract; a runtime suite alone is not full proof."],
  [/^(A-005|OPT-INDEX|VERIFY-.+)$/, "optional", "Optional capability; non-applicability still requires real disabled-profile rejection evidence."],
  [/^(A-.+|M-.+|ID-.+|CFG-.+|AUTH-.+|FS-.+|DB-.+|IPC-.+|MAIL-.+|BATCH-.+|PI-.+|RUN-.+|PR-.+|GIT-.+|INT-.+|APP-.+|CTX-.+|UNIT-.+|CREATE-.+|LIFE-.+|SB-.+|INF-.+|CLI-.+|VIEW-.+|ERR-.+|REC-.+|ORDER-.+|NEG-.+|POL-.+|TIER-.+|PUB-.+|CHAL-.+|SEM-.+|PACK-003|SEQ-.+|TUI-.+|TSP-.+)$/, "runtime", "Runtime boundary, including forbidden paths; an OPEN gate is not an exemption."],
];
const rows = linkedRows.map(row => {
  const rule = scopeRules.find(([pattern]) => pattern.test(row.requirement.split(";")[0].trim()));
  if (!rule) throw new Error(`Unreviewed scope: ${row.requirement}`);
  if (!["unclassified", "runtime", "build", "document", "optional"].includes(row.applicability))
    throw new Error(`Unknown applicability: ${row.requirement}`);
  return row.applicability === "unclassified" ? { ...row, applicability: rule[1], rationale: rule[2] } : row;
});
// The report does NOT write traceability.json. --inventory is an explicit,
// separate operation and must not silently discard an extra/stale trace here.
const manifest = fs.readFileSync("production-files.txt", "utf8").trim().split(/\r?\n/);
if (manifest.some(file => !file) || new Set(manifest).size !== manifest.length) throw new Error("invalid production manifest inventory");
const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd()).options;
const roots = ["apps/oma/src/entry/broker.ts", "apps/oma/src/entry/runner.ts", "apps/oma/src/entry/candidate-check.ts", "apps/oma/src/entry/quarantine.ts", "apps/oma/src/cli.ts", "packages/extension/src/index.ts"];
const { reachable, findings, external } = runtimeImportClosure({ rootDir: process.cwd(), roots, manifest, compilerOptions: options });
const notReached = manifest.filter(file => file.endsWith(".ts") && !reachable.has(file));
const acceptance = inventoryAcceptance([...normativeSources, "docs/architecture.md"].map(source => ({ source, text: fs.readFileSync(source, "utf8") })));
const cell = value => String(value ?? "UNLINKED").replaceAll("|", "\\|").replaceAll("\n", " ");
const lines = [
  "# Whole-scope adversarial audit ledger", "",
  "**Release verdict: NOT CERTIFIED.** This invocation is a static inventory, not a build/test run. Runtime evidence is NOT_RUN here. No requirement is promoted.", "",
  `Inventory: ${rows.length} labelled clauses across ${new Set(rows.map(row => row.source)).size} documents; ${missingTrace.length} missing/stale fingerprints; ${extras.length} extra/stale trace rows.`, "",
  "Unlabelled prose, tables, declaration contracts and transitive dependencies still require whole-source proof pins.",
  "The authored source-owners.json overlay supplies reviewed implementation paths; a changed path invalidates any old record's evidence.", "",
  "## Production dependency closure", "",
  ...findings.map(finding => `- FAIL: ${finding}`),
  ...(findings.length ? [] : ["- No literal relative runtime import escaped this manifest or reached tests in this static invocation."]),
  `- Non-entry-reachable TS files: ${notReached.join(", ") || "none"}. Type-only declarations and host-loaded extensions need separate review.`,
  `- External imports: ${[...external].sort().join(", ")}.`,
  "- This scan does not prove SDK callbacks, kernel budgets, reflective loading or runtime semantics.", "",
  "## Requirement-by-requirement linkage", "",
  "| Source | Requirement | Scope | Status | Owner | Entrypoint | Call path | Negative oracle | Evidence |",
  "|---|---|---|---|---|---|---|---|---|",
];
for (const row of rows) lines.push(`| ${cell(row.source)} | ${cell(row.requirement)} | ${cell(row.applicability)} | ${cell(row.status)} | ${cell(row.owner)} | ${cell(row.entrypoint)} | ${cell(row.callPath?.join(" → ") || null)} | ${cell(row.negativeTests?.join("; ") || null)} | ${row.evidence ? "Recorded claim; run compliance for current source validation" : "UNVERIFIED / fresh execution NOT_RUN"} |`);
const gates = new Map();
for (const [ids, reason] of [
  [[28,29,30,31,33,34,35,41], "S-03: actual Pi consumption/lifecycle proof required"],
  [[43,44,47,52], "S-02: isolated existing Human Pi attach/security proof required"],
  [[45,46], "S-01: actual Pi/FD/PID-reuse/storage-cap proof required"],
  [[48,49,50,51], "INF-001 assigns inference to the engine; OMA keeps no inference reservation or settlement (the confined Resident's byte relay, INF-005, settles no cost), so these rows have no OMA path to discharge"],
  [[72], "S-06: separate authorized VM power-loss proof; SIGKILL is insufficient"],
  [[76], "S-08/S-10: attestation/floor contracts OPEN; base is not tiered"],
  [[77], "S-09: fixed evaluation corpus and real multi-condition results required"],
]) for (const id of ids) gates.set(id, reason);
for (const scope of [acceptance.core, acceptance.tiered, acceptance.product]) {
  lines.push("", `## ${scope.name}: T${scope.first}–T${scope.last}`, "",
    `Actual parsed rows: ${scope.rows.length}; missing: ${scope.missing.map(id => `T${id}`).join(", ") || "none"}; duplicate: ${scope.duplicate.map(id => `T${id}`).join(", ") || "none"}; empty oracle: ${scope.empty.join(", ") || "none"}.`, "",
    "| ID | Source locator | Execution disposition | Required oracle |", "|---|---|---|---|");
  for (const row of scope.rows) lines.push(`| ${cell(row.label)} | ${cell(`${row.source}:${row.line}`)} | NOT_RUN here; ${cell(gates.get(row.id) ?? (row.id >= 91 ? "product surface scope (TEST-008); run through the verification lanes" : row.id >= 78 ? "target tiered scope; S-08/S-10/S-11 gates are not discharged" : "require a fresh scope-matched execution record"))} | ${cell(row.oracle)} |`);
  for (const id of scope.missing) lines.push(`| T${id} | MISSING | NOT_RUN / missing authoritative matrix row | Do not invent an oracle or lower the required count |`);
}
if (acceptance.extra.length) lines.push("", `FAIL: out-of-scope matrix rows: ${acceptance.extra.map(row => row.id).join(", ")}`);
lines.push("", "## Proof and source-pin disposition", "",
  "Historical runtime-tests, CLI logs, audit-source-pins and LOC artifacts are not rewritten or re-bound by this report.",
  "Only fresh build/test execution on the named source closure can support new runtime evidence. A static report's successful exit is not that evidence.",
  "Use the explicit verification lanes and preserve their raw logs, execution status, full source digests, skip accounting and scope limitations.",
  "Unlinked rows and OPEN adapters remain unverified; no similarity-based test-name match fills them.");
fs.mkdirSync("docs/archive", { recursive: true });
fs.writeFileSync("docs/archive/adversarial-review.md", lines.join("\n") + "\n");
console.log(`Classified ${rows.length} clauses; ${findings.length} static import-closure findings; runtime NOT_RUN; historical proof pins unchanged.`);
process.exitCode = findings.length || missingTrace.length || extras.length || !acceptance.complete || rows.length === 0 ? 1 : 0;
