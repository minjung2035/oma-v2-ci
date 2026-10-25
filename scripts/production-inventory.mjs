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
    if (entry.endsWith(".in") && !entry.startsWith("packages/platform-linux/src/systemd/")) throw new Error(`unsupported .in language: ${entry}`);
    return [slash(entry)];
  };
  const files = manifest.flatMap(expand).sort();
  if (new Set(files.map(file => realpathSync(join(root, file)))).size !== files.length)
    throw new Error("duplicate production source identity");
  // These are fixed runtime source roots, not a previous generated file list.
  // Removing a root from the input manifest cannot silently lower coverage/LOC.
  const workspaces = readdirSync(join(root, "packages"), { withFileTypes: true }).filter(entry => entry.isDirectory());
  const required = ["apps/oma/src", "apps/oma/package.json",
    ...workspaces.flatMap(entry => [`packages/${entry.name}/src`, `packages/${entry.name}/package.json`])].flatMap(expand);
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
export function writeSourceDigests(root = process.cwd(), files = assertProductionInventory(root)) {
  const records = { kind: "oma-production-source-digests-v1", manifest: sha256(`${files.join("\n")}\n`),
    files: files.map(path => ({ path, sha256: sha256(readFileSync(join(root, path))) })) };
  writeFileSync(join(root, "production-loc-hashes.json"), JSON.stringify(records, null, 2) + "\n");
  return records;
}
export function assertSourceDigests(root = process.cwd(), files = assertProductionInventory(root)) {
  const records = JSON.parse(readFileSync(join(root, "production-loc-hashes.json"), "utf8"));
  if (records.kind !== "oma-production-source-digests-v1" || Object.keys(records).sort().join() !== "files,kind,manifest" ||
    !Array.isArray(records.files) || records.files.length !== files.length ||
    records.files.some((entry, index) => !entry || Object.keys(entry).sort().join() !== "path,sha256" ||
      entry.path !== files[index] || typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(entry.sha256)))
    throw new Error("invalid production source digests; regenerate with node scripts/loc.mjs --source-digests");
  if (records.manifest !== sha256(`${files.join("\n")}\n`))
    throw new Error("production source digests name a different file list");
  const changed = files.filter((file, index) => records.files[index].sha256 !== sha256(readFileSync(join(root, file))));
  if (changed.length) throw new Error(`stale production source digests; changed=[${changed.join(", ")}]; regenerate with node scripts/loc.mjs --source-digests`);
  return { files: files.length, status: "SOURCE_DIGESTS_CURRENT" };
}

/** The pinned measuring tool. A different version counts differently, so any
 * other version is treated as no tool at all rather than as a second opinion. */
export const CLOC_VERSION = "2.08";

/** The ignored-file verdicts cloc can emit under the pinned invocation that
 * mean "this inventory entry is not countable source": empty, binary, no
 * known language, a name cloc's own non-code tables list, or a `~`-suffixed
 * editor backup a vendored payload may carry. Verdicts outside this set are
 * tool-filter answers that cannot occur here (there is no
 * --exclude/--include filter and --skip-uniqueness suppresses the duplicate
 * verdict), a cloc anomaly ("undefined: Filters_by_Language{...}" -- a
 * script whose language was recognized but has no counter), or an
 * observation anomaly that must stay an accounting failure rather than a
 * classification: `file size of ... exceeds max file size` (a >100 MB
 * member), `not file, not directory` (a member that changed kind between
 * listing and stat), `no longer readable` (it vanished mid-measurement),
 * `unable to associate with a language` (classify raced), `cannot read`
 * (the tool could not open it). An unrecognized verdict is still an
 * accounting failure, not a classification. */
export const CLOC_NON_CODE_REASON =
  /^(?:zero sized file|binary file|language unknown \(#\d+\)|listed in \$Not_Code_(?:Extension|Filename)\{[^}]*\}|temporary editor file)$/;

/** The two halves of a measurement's accounting, checked together: every
 * inventory file either has a cloc code row in the report or is named in the
 * report's `nonCode` block with a verdict CLOC_NON_CODE_REASON accepts.
 * LOC-001..007: a file that is neither counted nor classified is still an
 * accounting failure -- vendored payloads carry licenses, dotfiles,
 * sourcemaps and binaries cloc declines to count, so a missing row alone is
 * not misclassification; it has to be explicitly classified or it throws.
 * An incoherent report throws too: a non-code name outside the inventory or
 * one that also has a row, an unrecognized verdict, a malformed block. */
/** The cloc report's own members, never file rows: a root-level inventory
 * file sharing one of these names falls through to its `./`-spelled row
 * (or to the non-code accounting) rather than reading the structure. */
const CLOC_REPORT_STRUCTURE_KEYS = new Set(["header", "SUM", "nonCode"]);

export function clocCoverage(report, files) {
  if (report === null || typeof report !== "object" || Array.isArray(report))
    throw new Error("cloc report is not an object");
  const classified = report.nonCode ?? {};
  if (typeof classified !== "object" || classified === null || Array.isArray(classified))
    throw new Error("cloc non-code classification is malformed");
  const listed = new Set(files);
  // A row or verdict is an own property only: `report` and `classified` are
  // plain parsed objects, so an inventory file literally named
  // `constructor` or `hasOwnProperty` would otherwise read back an
  // Object.prototype member -- the file would look counted or declined
  // while cloc never measured it. A root-level file literally named
  // `header`, `SUM` or `nonCode` would read a structure row the same way,
  // so structure keys answer for no file -- the `./` spelling a report
  // gives relative paths can never be a structure key or a prototype
  // member, and reads directly.
  const rowAt = file =>
    (Object.hasOwn(report, file) && !CLOC_REPORT_STRUCTURE_KEYS.has(file) ? report[file] : report[`./${file}`]);
  for (const [file, reason] of Object.entries(classified)) {
    if (!listed.has(file))
      throw new Error(`cloc non-code classification names a file outside the inventory: ${file}`);
    if (rowAt(file) !== undefined)
      throw new Error(`cloc report both counts and classifies ${file} as non-code`);
    if (typeof reason !== "string" || !CLOC_NON_CODE_REASON.test(reason))
      throw new Error(`cloc non-code verdict for ${file} is not a recognized non-code reason: ${String(reason)}`);
  }
  const rows = new Map(), nonCode = new Map();
  for (const file of files) {
    const row = rowAt(file);
    if (row !== undefined) { rows.set(file, row); continue; }
    const verdict = Object.hasOwn(classified, file) ? classified[file] : undefined;
    if (verdict !== undefined) { nonCode.set(file, verdict); continue; }
    throw new Error(`cloc omitted or misclassified ${file}`);
  }
  return { rows, nonCode };
}

/** Measures the given files with the pinned cloc, or returns null when that
 * tool is not on this host. Null is an answer the caller must report as such:
 * a report that was not re-measured is not a measured report.
 *
 * The returned report is cloc's JSON plus a `nonCode` member: the --ignored
 * record folded in under one key so the written evidence and its digest
 * cover both halves of the accounting -- the rows cloc produced and the
 * per-file verdicts for everything it declined to count. */
export function measureWithCloc(root, files, cloc = "cloc") {
  let version;
  try { version = execFileSync(cloc, ["--version"], { encoding: "utf8", timeout: 10000, killSignal: "SIGKILL" }).trim(); }
  catch { return null; }
  if (version !== CLOC_VERSION) return null;
  const scratch = mkdtempSync(join(tmpdir(), "oma-cloc-"));
  try {
    const list = join(scratch, "files.txt");
    const out = join(scratch, "loc.json");
    const ignored = join(scratch, "ignored.json");
    writeFileSync(list, `${files.join("\n")}\n`);
    execFileSync(cloc, [`--list-file=${list}`, "--by-file", "--skip-uniqueness",
      "--read-lang-def=implementation/cloc-systemd.lang", "--force-lang=OMA systemd,conf", `--ignored=${ignored}`, "--json", `--out=${out}`], { cwd: root, stdio: "ignore", timeout: 600000, killSignal: "SIGKILL" });
    const report = JSON.parse(readFileSync(out, "utf8"));
    report.nonCode = {};
    for (const entry of JSON.parse(readFileSync(ignored, "utf8"))) {
      // With nothing ignored cloc emits `[{}]`, not `[]` -- non-entries are
      // skipped, real entries name the list-file path verbatim.
      if (entry === null || typeof entry !== "object" || typeof entry.file !== "string") continue;
      report.nonCode[entry.file.replace(/^\.\//, "")] = String(entry.reason ?? "").trim();
    }
    return report;
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
  assertSourceDigests(root, files);
  const evidenceRoot = options.evidenceRoot ?? root;
  const records = JSON.parse(readFileSync(join(evidenceRoot, "production-measurement-hashes.json"), "utf8"));
  if (records.manifest !== sha256(`${files.join("\n")}\n`))
    throw new Error("production-measurement-hashes.json was taken from a different file list; regenerate with node scripts/loc.mjs --out <evidence-directory>");
  if (!Array.isArray(records.files) || records.files.length !== files.length ||
    new Set(records.files.map(entry => entry?.path)).size !== files.length)
    throw new Error("invalid production measurement source digests");
  const measured = new Map(records.files.map(entry => [entry.path, entry.sha256]));
  const changed = files.filter(file => measured.get(file) !== sha256(readFileSync(join(root, file))));
  const dropped = [...measured.keys()].filter(file => !files.includes(file));
  if (changed.length || dropped.length)
    throw new Error(`stale production-measurement-hashes.json; changed=[${changed.join(", ")}]; removed=[${dropped.join(", ")}]; ` +
      "regenerate with node scripts/loc.mjs");
  const counted = JSON.parse(readFileSync(join(evidenceRoot, "production-loc.json"), "utf8"));
  // The recorded report must account for every inventory file the same way
  // the generator did: a code row, or a recognized non-code verdict in the
  // report's nonCode block. Anything else is stale or forged, not coverage.
  const coverage = (() => {
    try { return clocCoverage(counted, files); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`production-loc.json does not account for every production file: ${message}; regenerate with node scripts/loc.mjs`);
    }
  })();
  // cloc's header counts the files it measured -- the code rows. Files it
  // declined to count are the nonCode half, not part of n_files.
  if (counted.header?.n_files !== coverage.rows.size)
    throw new Error(`stale production-loc.json; counted ${counted.header?.n_files} of ${files.length} files; ` +
      "regenerate with node scripts/loc.mjs");
  // The informational total must still agree with what was measured:
  // every row present and a header that counts them is not the same as a total
  // that is the sum of those rows. A report whose SUM disagrees with its own
  // rows, or that has no SUM, is not a measurement this gate will pass on.
  const rows = Object.entries(counted).filter(([key]) => key !== "header" && key !== "SUM" && key !== "nonCode");
  const extra = rows.map(([key]) => key).filter(file => !files.includes(file));
  if (extra.length) throw new Error(`production-loc.json counts files outside the manifest: [${extra.join(", ")}]`);
  const sum = counted.SUM;
  if (!sum || typeof sum.code !== "number" || typeof sum.nFiles !== "number")
    throw new Error("production-loc.json has no SUM; regenerate with node scripts/loc.mjs");
  const totals = { code: 0, comment: 0, blank: 0 };
  for (const [file, row] of rows) {
    for (const field of ["code", "comment", "blank"]) {
      if (!Number.isSafeInteger(row[field]) || row[field] < 0)
        throw new Error(`production-loc.json has no ${field} count for ${file}`);
      totals[field] += row[field];
    }
  }
  if (sum.nFiles !== rows.length || sum.code !== totals.code ||
      sum.comment !== totals.comment || sum.blank !== totals.blank)
    throw new Error(`production-loc.json SUM disagrees with its own rows ` +
      `(SUM.code ${sum.code} vs ${totals.code}, SUM.nFiles ${sum.nFiles} vs ${rows.length}); ` +
      "regenerate with node scripts/loc.mjs");
  // Both artifacts must come from the same measuring run; a count taken by one
  // cloc and hashes taken beside another is two observations, not one.
  if (records.cloc !== counted.header?.cloc_version)
    throw new Error(`production-loc.json (cloc ${counted.header?.cloc_version}) and its hashes (cloc ${records.cloc}) ` +
      "are from different runs; regenerate with node scripts/loc.mjs");
  if (records.cloc !== CLOC_VERSION) throw new Error(`CI LOC evidence requires pinned cloc ${CLOC_VERSION}`);
  // The hashes name the exact report they were written beside, so the report
  // cannot be edited on its own: changing a count means changing this digest.
  if (records.report !== sha256(readFileSync(join(evidenceRoot, "production-loc.json"))))
    throw new Error("production-loc.json is not the report its hashes were recorded with; regenerate with node scripts/loc.mjs");
  // Everything above holds for a report whose numbers were typed in by hand,
  // provided they add up. Only measuring the source again shows the numbers are
  // the source's. That needs the pinned tool; without it the result says so.
  const fresh = options.measure === undefined ? measureWithCloc(root, files) : options.measure(root, files);
  if (fresh === null) return { files: files.length, code: sum.code, status: "CONSISTENT_NOT_REMEASURED" };
  // The fresh report owes the same accounting, or this is not comparing
  // against a measurement at all.
  const freshCoverage = (() => {
    try { return clocCoverage(fresh, files); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`a fresh measurement did not account for every production file: ${message}`);
    }
  })();
  const drifted = [...coverage.rows.keys()].filter(file =>
    ["code", "comment", "blank"].some(field => freshCoverage.rows.get(file)?.[field] !== coverage.rows.get(file)[field]));
  // The classification is part of the measurement: a file recorded as
  // non-code must still be declined, with the same verdict.
  const classificationDrift =
    JSON.stringify([...coverage.nonCode].sort()) !== JSON.stringify([...freshCoverage.nonCode].sort());
  if (drifted.length || classificationDrift || fresh.SUM?.code !== sum.code)
    throw new Error(`production-loc.json does not match a fresh measurement of the source; ` +
      `differs for [${drifted.join(", ")}]${classificationDrift ? "; non-code classification differs" : ""}; ` +
      "regenerate with node scripts/loc.mjs");
  return { files: files.length, code: sum.code, status: "SOURCE_BOUND" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.some(value => value !== "--write")) throw new Error("usage: production-inventory.mjs [--write]");
    const write = args.includes("--write");
    const files = write ? writeProductionInventory() : assertProductionInventory();
    // Writing the list is deliberately not a measurement; only the check reads
    // the source digests, so `--write` can never mark them current.
    const measured = write ? null : assertSourceDigests(process.cwd(), files);
    console.log(JSON.stringify({ status: write ? "SOURCE_LIST_GENERATED" : "SOURCE_LIST_CURRENT", files: files.length,
      sourceDigests: measured?.status ?? "NOT_CHECKED", loc: "CI_ARTIFACT_ONLY", runtimeProof: false }));
    // A gate that could not re-measure has not bound the numbers to the source.
    // Say so in the exit status, not only in the text, so CI cannot read it as a pass.
    if (process.env.OMA_REQUIRE_MEASUREMENT === "1")
      throw new Error("LOC is CI-generated evidence; run node scripts/loc.mjs --out <evidence-directory> to measure with the pinned cloc");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
