/** Shared mechanics for the `oma-vendored-bundle-v1` maintenance scripts
 * (`scripts/vendor-pi-lsp.mjs`, `scripts/vendor-pi-hashline.mjs`).
 *
 * A vendored bundle keeps `upstream/` byte-exact to the npm snapshot and
 * `runtime/` as what the maintenance script emits from those sources plus
 * the script's declared OMA divergence splices. Every splice anchor must
 * occur exactly once in the emitted file: zero means the upstream emit
 * drifted and the splice lost its anchor; more than one means the anchor
 * was ambiguous. Both are regeneration failures, not silently skipped
 * edits. The manifest's `generated.divergences` table must equal the
 * script's table (reason text and edit count, not just file names) so a
 * regenerated manifest cannot launder a drifted splice set.
 *
 * None of this reaches the network: upstream identity (integrity, shasum,
 * commit) is recorded metadata, verified once at vendoring time.
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, lstatSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";

export const slash = value => value.split(sep).join("/");
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

/** Canonical JSON: key order is not a difference, content is. */
export const canonical = value => JSON.stringify(value, (_key, v) =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]]))
    : v);

/** Every regular file under `base`, relative and sorted. Directories are
 * walked; anything that is neither a directory nor a file (symlink, fifo,
 * socket) makes the bundle malformed rather than silently skipped. */
export function filesUnder(base) {
  const out = [];
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) out.push(slash(relative(base, absolute)));
      else throw new Error(`vendored bundle holds a non-regular entry: ${absolute}`);
    }
  };
  walk(base);
  return out.sort();
}

/** Every bundle file except the manifest itself, sorted; the manifest is
 * the index over this set, never a member of it. */
export function bundleFiles(bundleDir, manifestName = "manifest.json") {
  return filesUnder(bundleDir).filter(path => path !== manifestName);
}

export function bundleRecords(bundleDir, manifestName = "manifest.json") {
  return bundleFiles(bundleDir, manifestName).map(path => {
    const bytes = readFileSync(join(bundleDir, path));
    return { path, bytes: bytes.length, sha256: sha256(bytes) };
  });
}

/** The multi-file digest is over the sorted (path, sha256) pairs so the
 * set is bound as a whole, not per file. */
export function bundleDigest(records) {
  const hash = createHash("sha256");
  for (const { path, sha256: digest } of records) hash.update(`${path}\0${digest}\n`);
  return hash.digest("hex");
}

/** Apply OMA's declared splices to an emitted runtime tree in place. Every
 * `find` anchor must occur exactly once in the emitted file. */
export function applyDivergences(dir, divergences) {
  for (const [name, divergence] of Object.entries(divergences)) {
    const target = join(dir, name);
    let text = readFileSync(target, "utf8");
    divergence.edits.forEach((edit, index) => {
      const occurrences = text.split(edit.find).length - 1;
      if (occurrences !== 1)
        throw new Error(`divergence ${name}#${index + 1}: anchor occurs ${occurrences} times in tsc emit; expected exactly 1`);
      text = text.replace(edit.find, edit.replace);
    });
    writeFileSync(target, text);
  }
}

/** The manifest's divergence table compared against the script's own
 * declared splices (reason text and edit count, not just file names). */
export function divergenceProblems(manifest, divergences) {
  const problems = [];
  const expectedDivergences = Object.fromEntries(
    Object.entries(divergences).map(([file, { reason, edits }]) => [file, { reason, edits: edits.length }]));
  const declaredDivergences = manifest?.generated?.divergences;
  const shape = value => Object.keys(value ?? {}).sort();
  if (JSON.stringify(shape(declaredDivergences)) !== JSON.stringify(shape(expectedDivergences)))
    problems.push("manifest generated.divergences names a different divergent-file set than OMA_DIVERGENCES");
  else {
    for (const [file, expected] of Object.entries(expectedDivergences)) {
      const declared = declaredDivergences[file];
      if (declared?.reason !== expected.reason || declared?.edits !== expected.edits)
        problems.push(`manifest generated.divergences["${file}"] does not match OMA_DIVERGENCES`);
    }
  }
  return problems;
}

export function divergenceMetadata(divergences) {
  return Object.fromEntries(Object.entries(divergences).map(([file, { reason, edits }]) => [file, { reason, edits: edits.length }]));
}

/** Deterministic runtime write: build into a scratch dir, delete the old
 * tree only after the new emit is complete, then copy files in sorted
 * order. */
export function writeRuntimeTree(runtimeDir, emitRuntime, scratchPrefix) {
  const scratch = mkdtempSync(join(tmpdir(), scratchPrefix));
  try {
    emitRuntime(scratch);
    rmSync(runtimeDir, { recursive: true, force: true });
    mkdirSync(runtimeDir, { recursive: true });
    for (const name of filesUnder(scratch)) {
      mkdirSync(dirname(join(runtimeDir, name)), { recursive: true });
      copyFileSync(join(scratch, name), join(runtimeDir, name));
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The emitted-runtime comparison every --check runs: each emitted file
 * must equal the vendored runtime file byte-for-byte. Returns problem
 * strings; callers add their own structural checks. */
export function emittedRuntimeProblems(scratch, emitted, runtimeDir) {
  const problems = [];
  for (const name of emitted) {
    const emittedBytes = readFileSync(join(scratch, name));
    const vendoredPath = join(runtimeDir, name);
    const vendored = lstatSync(vendoredPath, { throwIfNoEntry: false })?.isFile() ? readFileSync(vendoredPath) : null;
    if (vendored === null || sha256(vendored) !== sha256(emittedBytes)) problems.push(`runtime/${name} differs from tsc emit of vendored upstream`);
  }
  return problems;
}

/** The file-list half of every --check: manifest.files must be exactly the
 * bundle's current regular files, byte counts and hashes included, and
 * bundleSha256 must cover the set. */
export function bundleRecordProblems(manifest, bundleDir, manifestName = "manifest.json") {
  const problems = [];
  const records = bundleRecords(bundleDir, manifestName);
  const listed = new Map((manifest.files ?? []).map(entry => [entry.path, entry]));
  for (const { path, bytes, sha256: digest } of records) {
    const entry = listed.get(path);
    if (!entry) problems.push(`unlisted bundle file: ${path}`);
    else if (entry.bytes !== bytes || entry.sha256 !== digest) problems.push(`bundle file changed: ${path}`);
  }
  for (const path of listed.keys()) if (!records.some(record => record.path === path)) problems.push(`manifest names missing file: ${path}`);
  if (manifest.bundleSha256 !== bundleDigest(records)) problems.push("bundle digest does not cover current files");
  return problems;
}

/** npm omits .npmignore from tarballs. Preserve this non-runtime npm metadata
 * under a stored name, with original bytes and provenance explicitly pinned. */
export const NPM_METADATA_PACKAGING = Object.freeze([Object.freeze({
  upstreamPath: "node_modules/isexe/.npmignore",
  storedPath: "node_modules/isexe/npmignore.oma-vendor",
  sha256: "ca06e7ce01ccdd1f477910e1cd1339c23119ecf2386350b8ad876983e1da92ea",
})]);

export function vendorPackagingProblems(manifest, directory) {
  const problems = [];
  if (canonical(manifest?.generated?.packaging) !== canonical(NPM_METADATA_PACKAGING))
    problems.push("manifest generated.packaging differs from the declared npm metadata preservation");
  for (const entry of NPM_METADATA_PACKAGING) {
    if (lstatSync(join(directory, entry.upstreamPath), { throwIfNoEntry: false }))
      problems.push(`npm-omitted metadata still uses its unpublished name: ${entry.upstreamPath}`);
    const path = join(directory, entry.storedPath);
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.isSymbolicLink() || sha256(readFileSync(path)) !== entry.sha256)
      problems.push(`preserved npm metadata differs: ${entry.storedPath}`);
  }
  return problems;
}

export function preserveNpmMetadata(directory) {
  for (const entry of NPM_METADATA_PACKAGING) {
    const source = join(directory, entry.upstreamPath), stored = join(directory, entry.storedPath);
    const stat = lstatSync(source, { throwIfNoEntry: false });
    if (!stat) continue;
    if (!stat.isFile() || stat.isSymbolicLink() || sha256(readFileSync(source)) !== entry.sha256 ||
        lstatSync(stored, { throwIfNoEntry: false })) throw new Error("refuse to replace unknown npm metadata");
    renameSync(source, stored);
  }
  const problems = vendorPackagingProblems({ generated: { packaging: NPM_METADATA_PACKAGING } }, directory);
  if (problems.length) throw new Error(problems.join("\n"));
}
