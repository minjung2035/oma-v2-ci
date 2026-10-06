// LOC-001..007: pinned language-aware source inventory; never silently omit files.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { assertMeasurementCurrent, assertProductionInventory, assertSourceDigests, CLOC_VERSION, clocCoverage, collectProductionFiles,
  measureWithCloc, writeProductionInventory, writeSourceDigests } from "./production-inventory.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const args = process.argv.slice(2);
const outAt = args.indexOf("--out");
const output = outAt < 0 ? root : resolve(args[outAt + 1] ?? "");
const flags = outAt < 0 ? args : args.filter((_, index) => index !== outAt && index !== outAt + 1);
if (outAt >= 0 && (!args[outAt + 1] || args[outAt + 1].startsWith("--")) ||
  flags.some(arg => !["--inventory-only", "--source-digests"].includes(arg)) || flags.length > 1 || outAt >= 0 && flags.length)
  throw new Error("usage: loc.mjs [--inventory-only | --source-digests | --out <evidence-directory>]");
const files = collectProductionFiles(root);
if (args.includes("--inventory-only")) {
  writeProductionInventory(root);
  console.log(JSON.stringify({ status: "SOURCE_LIST_GENERATED", files: files.length,
    loc: "STALE_NOT_RUN", hashes: "STALE_NOT_RUN", runtimeProof: false }));
} else if (args.includes("--source-digests")) {
  writeProductionInventory(root);
  writeSourceDigests(root, files);
  console.log(JSON.stringify({ status: "SOURCE_DIGESTS_GENERATED", files: files.length, loc: "CI_ARTIFACT_ONLY", runtimeProof: false }));
} else {
  assertProductionInventory(root);
  assertSourceDigests(root, files);
  const version = CLOC_VERSION;
  const report = measureWithCloc(root, files);
  if (report === null) throw new Error(`cloc ${version} required; LOC evidence NOT_RUN`);
  mkdirSync(output, { recursive: true });
  // cloc's elapsed/rate fields differ on every run and are not measurements.
  // Remove them before the report is hashed so the same source and tool produce
  // the same measurement artifact rather than one tied to wall-clock noise.
  if (report.header) {
    report.header.report_file = "production-loc.json";
    delete report.header.elapsed_seconds;
    delete report.header.files_per_second;
    delete report.header.lines_per_second;
  }
  writeFileSync(join(output, "production-loc.json"), JSON.stringify(report, null, 2) + "\n");
  // LOC-001..007: every inventory file is accounted for -- a code row, or
  // cloc's own non-code verdict recorded under nonCode. clocCoverage throws
  // on anything else, so the loop below never sees an unaccounted file.
  const { rows, nonCode } = clocCoverage(report, files);
  let sum = 0;
  for (const file of files) {
    const row = rows.get(file);
    if (row === undefined) { console.log("    -", file, `(${nonCode.get(file)})`); continue; }
    if (!Number.isSafeInteger(row.code) || row.code < 0) throw new Error(`cloc omitted or misclassified ${file}`);
    sum += row.code;
    if (!Number.isSafeInteger(sum)) throw new Error("LOC sum exceeds safe integer range");
    console.log(String(row.code).padStart(5), file);
  }
  if (!report.SUM || report.SUM.code !== sum) throw new Error("cloc total differs from the complete source inventory");
  // These hashes bind actual measured sources; inventory-only never creates them.
  writeFileSync(join(output, "production-measurement-hashes.json"), JSON.stringify({
    cloc: version, manifest: hash(files.join("\n") + "\n"),
    // The report these hashes were measured with, so neither can change alone.
    report: hash(readFileSync(join(output, "production-loc.json"))),
    files: files.map(file => ({ path: file, sha256: hash(readFileSync(join(root, file))) })),
  }, null, 2) + "\n");
  const verified = assertMeasurementCurrent(root, files, { evidenceRoot: output });
  if (verified.status !== "SOURCE_BOUND") throw new Error("CI LOC evidence could not be re-measured");
  console.log("TOTAL production LOC (code lines):", report.SUM.code);
  console.log("LOC is informational; source inventory and measurement integrity remain checked.");
}
