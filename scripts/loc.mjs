// LOC-001..007: pinned language-aware source inventory; never silently omit files.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { collectProductionFiles, writeProductionInventory } from "./production-inventory.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const args = process.argv.slice(2);
if (args.some(arg => arg !== "--inventory-only")) throw new Error("usage: loc.mjs [--inventory-only]");
const files = collectProductionFiles(root);
if (args.includes("--inventory-only")) {
  writeProductionInventory(root);
  console.log(JSON.stringify({ status: "SOURCE_LIST_GENERATED", files: files.length,
    loc: "STALE_NOT_RUN", hashes: "STALE_NOT_RUN", runtimeProof: false }));
} else {
  const version = execFileSync("cloc", ["--version"], { encoding: "utf8" }).trim();
  if (version !== "2.08") throw new Error(`cloc 2.08 required, got ${version}`);
  writeProductionInventory(root);
  execFileSync("cloc", ["--list-file=production-files.txt", "--by-file", "--skip-uniqueness",
    "--read-lang-def=implementation/cloc-systemd.lang", "--json", "--out=production-loc.json"], { cwd: root });
  const report = JSON.parse(readFileSync(join(root, "production-loc.json"), "utf8"));
  let sum = 0;
  for (const file of files) {
    const row = report[file] ?? report[`./${file}`];
    if (!row || !Number.isSafeInteger(row.code) || row.code < 0) throw new Error(`cloc omitted or misclassified ${file}`);
    sum += row.code;
    if (!Number.isSafeInteger(sum)) throw new Error("LOC sum exceeds safe integer range");
    console.log(String(row.code).padStart(5), file);
  }
  if (!report.SUM || report.SUM.code !== sum) throw new Error("cloc total differs from the complete source inventory");
  // These hashes bind actual measured sources; inventory-only never creates them.
  writeFileSync(join(root, "production-loc-hashes.json"), JSON.stringify({
    cloc: version, manifest: hash(files.join("\n") + "\n"),
    // The report these hashes were measured with, so neither can change alone.
    report: hash(readFileSync(join(root, "production-loc.json"))),
    files: files.map(file => ({ path: file, sha256: hash(readFileSync(join(root, file))) })),
  }, null, 2) + "\n");
  console.log("TOTAL production LOC (code lines):", report.SUM.code);
  if (report.SUM.code > 10000) console.log("A-008: architecture review required before release");
}
