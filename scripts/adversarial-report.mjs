// Review artifact only. This does not turn a test-name match into compliance proof.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import ts from "typescript";
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const tracePath = "implementation/traceability.json";
const rows = JSON.parse(fs.readFileSync(tracePath, "utf8"));
const scopeRules = [
  [/^(N-(002|003|004|005|006)|POL-(001|003|008)|PACK-00[124]|VAL-00[123])$/, "document", "Normative interpretation, reporting, or sender/Principal reading practice; no semantic workflow engine is authorized."],
  [/^(N-001|A-00[489]|M-00[12]|POL-00[57]|TRACE-.+|COMP-.+|LOC-.+|TEST-.+|SP-.+|VAL-00[45])$/, "build", "Release/source/testing contract; runtime suite success alone does not establish this obligation."],
  [/^(A-005|OPT-INDEX|VERIFY-.+)$/, "optional", "Optional capability; not_applicable still requires an actual disabled-profile rejection oracle."],
  [/^(A-.+|M-.+|ID-.+|CFG-.+|AUTH-.+|FS-.+|DB-.+|IPC-.+|MAIL-.+|BATCH-.+|PI-.+|RUN-.+|PR-.+|GIT-.+|INT-.+|APP-.+|CTX-.+|UNIT-.+|CREATE-.+|LIFE-.+|SB-.+|INF-.+|CLI-.+|VIEW-.+|ERR-.+|REC-.+|ORDER-.+|NEG-.+|POL-.+|TIER-.+|PUB-.+|CHAL-.+|SEM-.+|PACK-003|SEQ-.+)$/, "runtime", "Applies to the implemented or required runtime boundary, including forbidden paths; no exemption inferred from an OPEN gate."],
];
for (const row of rows) {
  const id = row.requirement.split(";")[0];
  const rule = scopeRules.find(([pattern]) => pattern.test(id));
  if (!rule) throw new Error(`Unreviewed scope: ${row.requirement}`);
  if (row.applicability === "unclassified") {
    row.applicability = rule[1];
    row.rationale = rule[2];
  }
}
fs.writeFileSync(tracePath, JSON.stringify(rows, null, 2) + "\n");

const manifest = fs.readFileSync("production-files.txt", "utf8").trim().split(/\r?\n/);
const manifestSet = new Set(manifest);
const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd()).options;
const roots = ["src/entry/broker.ts", "src/entry/runner.ts", "src/entry/host.ts", "src/cli.ts", "src/pi-extension.ts"];
const reachable = new Set();
const findings = [];
const external = new Set();
function visit(file) {
  if (reachable.has(file)) return;
  reachable.add(file);
  if (!manifestSet.has(file)) findings.push(`Runtime import outside production manifest: ${file}`);
  if (/(^|\/)test(s)?\//.test(file)) findings.push(`Production imports a test: ${file}`);
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  function walk(node) {
    const declaration = ts.isImportDeclaration(node) || ts.isExportDeclaration(node);
    const dynamic = ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === "require");
    const value = declaration ? node.moduleSpecifier : dynamic ? node.arguments[0] : undefined;
    const typeOnly = declaration && (node.isTypeOnly || node.importClause?.isTypeOnly);
    if (value && !typeOnly) {
      if (!ts.isStringLiteral(value)) findings.push(`Nonliteral runtime import: ${file}:${source.getLineAndCharacterOfPosition(node.pos).line + 1}`);
      else if (!value.text.startsWith(".")) external.add(value.text);
      else {
        const resolved = ts.resolveModuleName(value.text, path.resolve(file), options, ts.sys).resolvedModule;
        if (!resolved) findings.push(`Unresolved runtime import: ${file} -> ${value.text}`);
        else visit(path.relative(process.cwd(), resolved.resolvedFileName));
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(source);
}
roots.forEach(visit);
const notReached = manifest.filter(file => file.endsWith(".ts") && !reachable.has(file));
const lines = [
  "# Whole-scope adversarial audit ledger", "",
  "**Release verdict: FAIL.** Scope classification is not executable proof. No requirement is promoted here.", "",
  `Inventory: ${rows.length} labelled MUST/MUST NOT/SHOULD/OPTIONAL clauses across ${new Set(rows.map(row => row.source)).size} documents. Unlabelled prose, tables and code contracts remain covered by whole-file pins, not silently counted as individually proven.`, "",
  "## Production dependency closure", "",
  ...findings.map(x => `- FAIL: ${x}`),
  ...(findings.length ? [] : ["- No literal relative runtime import outside the manifest or into tests was found."]),
  `- Non-entry-reachable TS files: ${notReached.join(", ")}. Type-only contracts and host-loaded extensions need separate treatment; non-reachability alone is not proof of dead code.`,
  `- External imports: ${[...external].sort().join(", ")}.`,
  "- This static scan does not prove SDK callbacks, resource enforcement or reflective loading safe.", "",
  "## Requirement-by-requirement disposition", "",
  "| Source | Requirement | Scope | Status | Missing full proof |", "|---|---|---|---|---|",
];
for (const row of rows) {
  const missing = [!row.owner && "reviewed final owner", !row.entrypoint && "entrypoint", !row.negativeTests?.length && "negative oracle", !row.evidence && "fresh bound evidence"].filter(Boolean);
  lines.push(`| ${row.source} | ${row.requirement} | ${row.applicability} | ${row.status} | ${missing.join(", ") || "full-clause behavioral review still required"} |`);
}
const gateRows = new Map();
for (const [ids, why] of [
  [[28,29,30,31,33,34,35,41], "S-03/S-04: no verified actual Pi consumption/provider lifecycle"],
  [[43,44,47,52], "S-02: no isolated existing Human Pi attach/security acceptance"],
  [[45,46], "S-01: full real Pi/FD/PID-reuse/storage-cap profile not verified"],
  [[48,49,50,51], "S-04: production provider codec/inference wiring not established"],
  [[72], "S-06: no isolated VM, hypervisor tools or /dev/kvm available; host power-off is not authorized"],
  [[76], "S-08/S-10: attestation/floor contracts OPEN; base is not tiered"],
  [[77], "S-09: no fixed evaluation corpus/real multi-condition results"],
]) for (const id of ids) gateRows.set(id, why);
const primitiveKills = new Set([18,19,20,21,22,27]);
lines.push("", "## All 77 acceptance rows", "", "A passing similarly named test is only a candidate link, not full oracle coverage. The complete contract is retained below.", "", "| ID | Disposition | Required oracle |", "|---|---|---|");
let acceptanceRows = 0;
for (const match of fs.readFileSync("implementation/test-matrix.md", "utf8").matchAll(/^\| (T(\d+) \/ [^|]+) \| ([^\n]+) \|$/gm)) {
  const id = Number(match[2]);
  if (id !== ++acceptanceRows) throw new Error("Acceptance matrix has a gap or duplicate");
  const disposition = gateRows.get(id) ?? (primitiveKills.has(id) ? "Real SIGKILL primitive harness executed; actual entrypoint/full oracle remains unproven" : "Existing runtime/regression suite executed; full row oracle not certified");
  lines.push(`| ${match[1]} | ${disposition} | ${match[3]} |`);
}
if (acceptanceRows !== 77) throw new Error(`Expected all 77 acceptance rows, got ${acceptanceRows}`);
const testSources = fs.readdirSync("test", { recursive: true }).filter(file => file.endsWith(".ts")).map(file => `test/${file}`);
const runArtifacts = ["implementation/evidence/runtime-tests.txt", "implementation/evidence/environment.txt", "implementation/evidence/dependency-audit.json"].filter(file => fs.existsSync(file));
const pins = [...new Set([...manifest, ...testSources, ...runArtifacts, ...rows.map(row => row.source), "architecture.md", "package.json", "package-lock.json", "scripts/compliance.mjs", "scripts/adversarial-report.mjs"])];
fs.writeFileSync("implementation/evidence/audit-source-pins.json", JSON.stringify(Object.fromEntries(pins.map(file => [file, hash(file)])), null, 2) + "\n");
fs.writeFileSync("implementation/adversarial-review.md", lines.join("\n") + "\n");
console.log(`Classified ${rows.length} clauses; ${findings.length} static import-closure findings; no proof promotion.`);
