#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const slash = value => value.split(sep).join("/");
function repositoryPath(value) {
  if (typeof value !== "string" || !value || isAbsolute(value) || value.includes("\\") || value.includes("\0") ||
      value.split("/").some(part => !part || part === "." || part === ".."))
    throw new Error(`invalid production manifest path: ${String(value)}`);
  return value;
}
export function collectProductionFiles(rootInput = process.cwd()) {
  const root = realpathSync(rootInput);
  const manifest = JSON.parse(readFileSync(join(root, "production-manifest.json"), "utf8"));
  if (!Array.isArray(manifest) || manifest.length === 0) throw new Error("production manifest must be a nonempty array");
  const expand = entry => {
    const file = join(root, repositoryPath(entry));
    const stat = lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error(`symlink in production source: ${entry}`);
    const canonical = relative(root, realpathSync(file));
    if (canonical === ".." || canonical.startsWith(`..${sep}`) || isAbsolute(canonical)) throw new Error(`production source escapes root: ${entry}`);
    if (stat.isDirectory()) return readdirSync(file).sort().flatMap(name => expand(`${entry}/${name}`));
    if (!stat.isFile()) throw new Error(`nonregular production source: ${entry}`);
    if (entry.endsWith(".md")) return [];
    if (entry.endsWith(".in") && !entry.startsWith("implementation/systemd/")) throw new Error(`unsupported .in language: ${entry}`);
    return [slash(entry)];
  };
  const files = manifest.flatMap(expand).sort();
  if (new Set(files.map(file => realpathSync(join(root, file)))).size !== files.length)
    throw new Error("duplicate production source identity");
  // These are fixed runtime source roots, not a previous generated file list.
  // Removing a root from the input manifest cannot silently lower coverage/LOC.
  const required = ["src", "implementation/contracts.ts", "implementation/schema-v3.sql", "implementation/systemd"].flatMap(expand);
  const listed = new Set(files);
  const missing = required.filter(file => !listed.has(file));
  if (missing.length) throw new Error(`production manifest omits current runtime sources: ${missing.join(", ")}`);
  return files;
}
export function writeProductionInventory(root = process.cwd()) {
  const files = collectProductionFiles(root);
  writeFileSync(join(root, "production-files.txt"), `${files.join("\n")}\n`);
  return files;
}
export function assertProductionInventory(root = process.cwd()) {
  const current = collectProductionFiles(root);
  const bytes = readFileSync(join(root, "production-files.txt"), "utf8");
  const recorded = bytes.split(/\r?\n/).filter(Boolean);
  if (bytes !== `${current.join("\n")}\n`) {
    const present = new Set(recorded), expected = new Set(current);
    throw new Error(`stale production-files.txt; missing=[${current.filter(file => !present.has(file)).join(", ")}]; ` +
      `extra=[${recorded.filter(file => !expected.has(file)).join(", ")}]; regenerate with node scripts/loc.mjs --inventory-only; LOC/hash remain separately unverified`);
  }
  return current;
}
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

/** The pinned measuring tool. A different version counts differently, so any
 * other version is treated as no tool at all rather than as a second opinion. */
export const CLOC_VERSION = "2.08";

/** Measures the given files with the pinned cloc, or returns null when that
 * tool is not on this host. Null is an answer the caller must report as such:
 * a report that was not re-measured is not a measured report. */
export function measureWithCloc(root, files, cloc = "cloc") {
  let version;
  try { version = execFileSync(cloc, ["--version"], { encoding: "utf8" }).trim(); }
  catch { return null; }
  if (version !== CLOC_VERSION) return null;
  const scratch = mkdtempSync(join(tmpdir(), "oma-cloc-"));
  try {
    const list = join(scratch, "files.txt");
    const out = join(scratch, "loc.json");
    writeFileSync(list, `${files.join("\n")}\n`);
    execFileSync(cloc, [`--list-file=${list}`, "--by-file", "--skip-uniqueness",
      "--read-lang-def=implementation/cloc-systemd.lang", "--json", `--out=${out}`], { cwd: root, stdio: "ignore" });
    return JSON.parse(readFileSync(out, "utf8"));
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

/** The measured artifacts must describe the source that is here now.
 *
 * The file list on its own cannot catch this: it stayed current while the LOC
 * and hash records described a set of files 21 smaller, so a reader checking
 * the inventory saw a pass and a LOC figure from another commit. Binding the
 * records to the bytes they were taken from makes the drift a failure at the
 * moment it happens, and costs one hash per file rather than another cloc run.
 */
export function assertMeasurementCurrent(root = process.cwd(), files = collectProductionFiles(root), options = {}) {
  const records = JSON.parse(readFileSync(join(root, "production-loc-hashes.json"), "utf8"));
  if (records.manifest !== sha256(`${files.join("\n")}\n`))
    throw new Error("production-loc-hashes.json was taken from a different file list; regenerate with node scripts/loc.mjs");
  const measured = new Map((records.files ?? []).map(entry => [entry.path, entry.sha256]));
  const changed = files.filter(file => measured.get(file) !== sha256(readFileSync(join(root, file))));
  const dropped = [...measured.keys()].filter(file => !files.includes(file));
  if (changed.length || dropped.length)
    throw new Error(`stale production-loc-hashes.json; changed=[${changed.join(", ")}]; removed=[${dropped.join(", ")}]; ` +
      "regenerate with node scripts/loc.mjs");
  const counted = JSON.parse(readFileSync(join(root, "production-loc.json"), "utf8"));
  const missing = files.filter(file => counted[file] === undefined);
  if (missing.length || counted.header?.n_files !== files.length)
    throw new Error(`stale production-loc.json; counted ${counted.header?.n_files} of ${files.length} files; ` +
      `missing=[${missing.join(", ")}]; regenerate with node scripts/loc.mjs`);
  // The informational total must still agree with what was measured:
  // every row present and a header that counts them is not the same as a total
  // that is the sum of those rows. A report whose SUM disagrees with its own
  // rows, or that has no SUM, is not a measurement this gate will pass on.
  const rows = Object.entries(counted).filter(([key]) => key !== "header" && key !== "SUM");
  const extra = rows.map(([key]) => key).filter(file => !files.includes(file));
  if (extra.length) throw new Error(`production-loc.json counts files outside the manifest: [${extra.join(", ")}]`);
  const sum = counted.SUM;
  if (!sum || typeof sum.code !== "number" || typeof sum.nFiles !== "number")
    throw new Error("production-loc.json has no SUM; regenerate with node scripts/loc.mjs");
  const totals = { code: 0, comment: 0, blank: 0 };
  for (const [file, row] of rows) {
    for (const field of ["code", "comment", "blank"]) {
      if (typeof row[field] !== "number" || !Number.isFinite(row[field]) || row[field] < 0)
        throw new Error(`production-loc.json has no ${field} count for ${file}`);
      totals[field] += row[field];
    }
  }
  if (sum.nFiles !== files.length || sum.code !== totals.code ||
      sum.comment !== totals.comment || sum.blank !== totals.blank)
    throw new Error(`production-loc.json SUM disagrees with its own rows ` +
      `(SUM.code ${sum.code} vs ${totals.code}, SUM.nFiles ${sum.nFiles} vs ${files.length}); ` +
      "regenerate with node scripts/loc.mjs");
  // Both artifacts must come from the same measuring run; a count taken by one
  // cloc and hashes taken beside another is two observations, not one.
  if (records.cloc !== counted.header?.cloc_version)
    throw new Error(`production-loc.json (cloc ${counted.header?.cloc_version}) and its hashes (cloc ${records.cloc}) ` +
      "are from different runs; regenerate with node scripts/loc.mjs");
  // The hashes name the exact report they were written beside, so the report
  // cannot be edited on its own: changing a count means changing this digest.
  if (records.report !== sha256(readFileSync(join(root, "production-loc.json"))))
    throw new Error("production-loc.json is not the report its hashes were recorded with; regenerate with node scripts/loc.mjs");
  // Everything above holds for a report whose numbers were typed in by hand,
  // provided they add up. Only measuring the source again shows the numbers are
  // the source's. That needs the pinned tool; without it the result says so.
  const fresh = options.measure === undefined ? measureWithCloc(root, files) : options.measure(root, files);
  if (fresh === null) return { files: files.length, code: sum.code, status: "CONSISTENT_NOT_REMEASURED" };
  const drifted = files.filter(file => ["code", "comment", "blank"].some(field => fresh[file]?.[field] !== counted[file][field]));
  if (drifted.length || fresh.SUM?.code !== sum.code)
    throw new Error(`production-loc.json does not match a fresh measurement of the source; ` +
      `differs for [${drifted.join(", ")}]; regenerate with node scripts/loc.mjs`);
  return { files: files.length, code: sum.code, status: "SOURCE_BOUND" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.some(value => value !== "--write")) throw new Error("usage: production-inventory.mjs [--write]");
    const write = args.includes("--write");
    const files = write ? writeProductionInventory() : assertProductionInventory();
    // Writing the list is deliberately not a measurement; only the check reads
    // the measured artifacts, so `--write` can never mark them current.
    const measured = write ? null : assertMeasurementCurrent(process.cwd(), files);
    console.log(JSON.stringify({ status: write ? "SOURCE_LIST_GENERATED" : "SOURCE_LIST_CURRENT", files: files.length,
      loc: measured === null ? "NOT_MEASURED" : measured.status, codeLines: measured?.code ?? null, runtimeProof: false }));
    // A gate that could not re-measure has not bound the numbers to the source.
    // Say so in the exit status, not only in the text, so CI cannot read it as a pass.
    if (measured !== null && measured.status !== "SOURCE_BOUND" && process.env.OMA_REQUIRE_MEASUREMENT === "1")
      throw new Error("the pinned cloc is required here and was not available");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
