// LOC-001..007: pinned language-aware source inventory; never silently omit files.
import { readFileSync, readdirSync, lstatSync, realpathSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifest = JSON.parse(readFileSync(join(root, "production-manifest.json"), "utf8"));
function expand(entry) {
  const path = join(root, entry);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(`symlink in production manifest: ${entry}`);
  if (stat.isDirectory()) return readdirSync(path).sort().flatMap((name) => expand(join(entry, name)));
  return entry.endsWith(".md") ? [] : [entry];
}
const files = manifest.flatMap(expand).sort();
if (new Set(files.map((file) => realpathSync(join(root, file)))).size !== files.length)
  throw new Error("duplicate production source");
for (const file of files) {
  if (file.endsWith(".in") && !file.startsWith("implementation/systemd/"))
    throw new Error(`unsupported .in language: ${file}`);
}
const version = execFileSync("cloc", ["--version"], { encoding: "utf8" }).trim();
if (version !== "2.08") throw new Error(`cloc 2.08 required, got ${version}`);
writeFileSync(join(root, "production-files.txt"), files.join("\n") + "\n");
execFileSync("cloc", ["--list-file=production-files.txt", "--by-file", "--skip-uniqueness",
  "--read-lang-def=implementation/cloc-systemd.lang", "--json", "--out=production-loc.json"], { cwd: root });
const report = JSON.parse(readFileSync(join(root, "production-loc.json"), "utf8"));
for (const file of files) {
  const row = report[file] ?? report[`./${file}`];
  if (!row || !Number.isSafeInteger(row.code)) throw new Error(`cloc omitted ${file}`);
  console.log(String(row.code).padStart(5), file);
}
writeFileSync(join(root, "production-loc-hashes.json"), JSON.stringify({
  cloc: version, manifest: hash(files.join("\n") + "\n"),
  files: Object.fromEntries(files.map((file) => [file, hash(readFileSync(join(root, file)))])),
}, null, 2) + "\n");
console.log("TOTAL production LOC (code lines):", report.SUM.code);
if (report.SUM.code > 10000) console.log("A-008: architecture review required before release");
