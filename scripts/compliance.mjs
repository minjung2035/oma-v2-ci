// COMP-001..008: inventory, source linkage and executed proof are distinct.
import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";
import { runtimeImportClosure } from "./architecture-check.mjs";
import { digest, normativeSources, traceIdentity, indexTrace, loadTraceInventory, inventoryAcceptance, sourceFiles } from "./traceability.mjs";
const textValue = value => typeof value === "string" && value.trim().length > 0;
const textList = value => Array.isArray(value) && value.length > 0 && value.every(textValue);
const fileOf = locator => locator.split("#")[0];
const { entries, rows, linkedRows, extras } = loadTraceInventory();
const previous = indexTrace(rows);
if (process.argv.includes("--inventory")) {
  writeFileSync("implementation/traceability.json", JSON.stringify(linkedRows, null, 2) + "\n");
  console.log(`Inventoried ${entries.length} normative clauses; same fingerprints and unchanged links preserved; changed clauses/owners unverified. No source evidence regenerated.`);
} else {
  const production = readFileSync("production-files.txt", "utf8").trim().split(/\r?\n/);
  if (production.length === 0 || production.some(file => !textValue(file)) || new Set(production).size !== production.length)
    throw new Error("production inventory is empty or duplicated");
  const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
  const roots = ["apps/oma/src/entry/broker.ts", "apps/oma/src/entry/runner.ts", "apps/oma/src/entry/candidate-check.ts", "apps/oma/src/entry/quarantine.ts", "apps/oma/src/cli.ts", "packages/extension/src/index.ts"];
  const { findings } = runtimeImportClosure({ rootDir: process.cwd(), roots, manifest: production, compilerOptions: parsed.options });
  const acceptance = inventoryAcceptance([...normativeSources, "docs/architecture.md"].map(source => ({ source, text: readFileSync(source, "utf8") })));
  // The generated inventory is not a complete dependency closure after a move.
  // Include ALL current source/test/tool inputs so an added helper or changed
  // negative test cannot hide behind an old production-files.txt snapshot.
  const authoredImplementation = sourceFiles(".", "implementation").filter(file =>
    file !== "implementation/traceability.json");
  const authoredDocuments = sourceFiles(".", "docs");
  const closure = [...new Set([...normativeSources, ...production, ...authoredImplementation, ...authoredDocuments,
    ...["apps", "packages", "test", "scripts"].flatMap(directory => sourceFiles(".", directory)),
    "docs/architecture.md", "production-files.txt", "production-manifest.json", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"] )];
  const failures = linkedRows.filter((row, index) => {
    const entry = entries[index];
    if (!previous.has(traceIdentity(entry)) || !["runtime", "build", "document", "optional"].includes(row.applicability) ||
      !["proven", "not_applicable"].includes(row.status) || !textValue(row.rationale) ||
      !textValue(row.owner) || !textValue(row.entrypoint) || !textList(row.callPath) ||
      !textList(row.negativeTests) || !row.evidence) return true;
    if (row.status === "not_applicable" && row.applicability !== "optional") return true;
    if (!/^.+#[^#]+$/.test(row.owner) || row.negativeTests.some(test => !/^.+#[^#]+$/.test(test))) return true;
    if (!row.callPath.includes(row.owner) || !row.callPath.includes(row.entrypoint)) return true;
    const evidence = row.evidence;
    if (evidence.specDigest !== entry.digest || evidence.buildExit !== 0 || evidence.testExit !== 0 ||
      ![evidence.buildCommand, evidence.testCommand, evidence.environmentPin, evidence.logPath, evidence.logDigest].every(textValue) ||
      !evidence.sourceDigests || typeof evidence.sourceDigests !== "object" || Array.isArray(evidence.sourceDigests)) return true;
    try {
      if (digest(readFileSync(evidence.logPath)) !== evidence.logDigest) return true;
      const required = [...closure, fileOf(row.owner), fileOf(row.entrypoint), ...row.callPath.map(fileOf), ...row.negativeTests.map(fileOf)];
      if (required.some(file => !Object.hasOwn(evidence.sourceDigests, file))) return true;
      return Object.entries(evidence.sourceDigests).some(([file, expected]) => !/^[0-9a-f]{64}$/.test(expected) || digest(readFileSync(file)) !== expected);
    } catch { return true; }
  });
  for (const finding of findings) console.error(`Import closure: ${finding}`);
  for (const scope of [acceptance.core, acceptance.tiered, acceptance.product]) console.log(`${scope.name}: ${scope.rows.length} matrix rows; missing=[${scope.missing.join(",")}]; duplicates=[${scope.duplicate.join(",")}]; empty=[${scope.empty.join(",")}]`);
  console.log(`${entries.length - failures.length}/${entries.length} clauses pass structural evidence checks; ${failures.length} unresolved; ${extras.length} stale/extra rows; ${findings.length} import-closure findings.`);
  console.log("Structural checks do not certify full-clause behavior, disabled-profile rejection or kernel isolation.");
  process.exitCode = failures.length || extras.length || findings.length || entries.length === 0 || !acceptance.complete ? 1 : 0;
}
