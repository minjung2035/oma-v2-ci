#!/usr/bin/env node
/** Vendored pi-hashline-edit-pro bundle maintenance — the only writer of
 * `apps/oma/src/extension/vendor/pi-hashline-edit-pro/runtime/` and `manifest.json`.
 *
 * `upstream/` is the exact npm tarball snapshot of pi-hashline-edit-pro
 * (verified against `package/npm integrity` and `shasum` at vendoring
 * time) and is never touched here. `upstream-tests/` is the repository's
 * `test/` tree at the same commit — the npm tarball ships no tests — kept
 * for provenance and porting; they are not wired into `npm test` (they
 * need vitest and the upstream `../src` layout). `node_modules/` is the
 * pinned runtime dependency closure, byte-exact to the npm tarballs named
 * in DEPENDENCIES, kept separate from anything a user-installed Pi package
 * would resolve.
 *
 * `runtime/` is tsc's emit of the upstream `apps/oma/src/` modules the adapter
 * loads, compiled with upstream's own flags (module ESNext +
 * moduleResolution bundler — upstream ships extensionless imports), with
 * two mechanical steps applied on top:
 *
 *  1. `rewriteModuleSpecifiers`: every relative import/export specifier is
 *     rewritten to the emitted file it resolves to (`./x` -> `./x.js`,
 *     `./dir` -> `./dir/index.js`, `./x.json` keeps its extension and gains
 *     `with { type: "json" }`) because Node's ESM loader requires explicit
 *     specifiers upstream's bundler resolution did not. This is not an OMA
 *     divergence — it is derived entirely from the vendored source tree and
 *     applies to emitted .js and .d.ts alike. A specifier that resolves to
 *     nothing upstream holds is a regeneration failure.
 *  2. OMA_DIVERGENCES: the only semantic difference between upstream emit
 *     and runtime/. Each splice is an exact-once anchor replacement over
 *     the post-rewrite bytes; a drifted anchor fails loudly.
 *
 * Upstream's entry file (index.ts) and the excluded feature modules
 * (copy-move, grep, glob, config-ui, auto-read-all) are vendored but never
 * compiled or loaded: they register upstream's own tool/command surface,
 * which OMA does not expose. `auto-read-all-state.ts` stays compiled
 * because read.ts imports its (inert) snapshot getter.
 *
 * This script never reaches the network: npm integrity/shasum/commit are
 * recorded metadata, verified once at vendoring time.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import {
  applyDivergences, bundleDigest, bundleRecordProblems, bundleRecords, canonical,
  divergenceMetadata, divergenceProblems, emittedRuntimeProblems, filesUnder, sha256,
  slash, writeRuntimeTree,
} from "./vendor-bundle-lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE_DIR = join(root, "packages/tool-hashline/src/vendor/pi-hashline-edit-pro");
const UPSTREAM_DIR = join(BUNDLE_DIR, "upstream");
const UPSTREAM_SRC = join(UPSTREAM_DIR, "src");
const RUNTIME_DIR = join(BUNDLE_DIR, "runtime");
const UPSTREAM_TESTS_DIR = join(BUNDLE_DIR, "upstream-tests");
const MANIFEST_PATH = join(BUNDLE_DIR, "manifest.json");

/** Upstream modules the OMA adapter never compiles: the extension entry and
 * the feature surfaces OMA does not expose (copy/move, anchor_grep, glob,
 * config UI, auto-read-all). Everything else under upstream/src is emitted;
 * the exclusion is by name so a new upstream module file fails the emit
 * manifest rather than being silently picked up. */
const EXCLUDED_MODULES = Object.freeze([
  "auto-read-all.ts", "config-ui.ts", "copy-move.ts", "glob.ts", "grep.ts",
]);

const EXPECTED_PACKAGE = Object.freeze({
  name: "pi-hashline-edit-pro",
  version: "5.1.0",
  // The commit whose tree the npm tarball was published from: every tarball
  // file — index.ts, LICENSE, package.json, README.md, src/, prompts/ —
  // matches `git archive` of this commit byte-for-byte (the 5.1.0 version
  // bump is 9219047d144b0d36dc76f313527259006b6103af, four commits earlier).
  // upstream-tests/ is this commit's test/ tree, byte-exact.
  commit: "49f61eb203acb5bedec476c182f2b3f5e5b3fc04",
  npmIntegrity: "sha512-CZu7BIqwmQKdxbJgE/LvIMIPKnk4OeeSofrecPtQ+edFxpN6Y1mUA7Pusv6NwkQJeGMCr4bK3aPQYyzWTCCpGw==",
  npmShasum: "2f54e35be2fff21ebad85a90c16bab98960027ad",
});

/** The runtime dependency closure vendored under node_modules/, pinned to
 * the exact npm tarballs extracted at vendoring time. Every name+version is
 * verified against the vendored package.json on --check, and every file's
 * bytes are bound by manifest.files and the bundle digest. Peer deps
 * (@earendil-works/pi-coding-agent, @earendil-works/pi-tui, typebox)
 * resolve to OMA's own install — they are the host API, not payload. */
const DEPENDENCIES = Object.freeze({
  "diff": { version: "9.0.0", integrity: "sha512-svtcdpS8CgJyqAjEQIXdb3OjhFVVYjzGAPO8WGCmRbrml64SPw/jJD4GoE98aR7r25A0XcgrK3F02yw9R/vhQw==", shasum: "297c31cd7c280f13dfe335791ec2063bd4a73a6f" },
  "file-type": { version: "22.1.1", integrity: "sha512-sEB0oStmeLGtpmSAD88RDNuLsvhv4iC3u0lE25CUvfCULvj49xoQ3l3K525Vn+ZzsZ6DOLajQCV6RmhwwhqiJg==", shasum: "5d9b20bd514657440379e57ff64ba06d3822c2a3" },
  "xxhash-wasm": { version: "1.1.0", integrity: "sha512-147y/6YNh+tlp6nd/2pWq38i9h6mz/EuQ6njIrmW8D1BS5nCqs0P6DG+m6zTGnNz5I+uhZ0SHxBs9BsPrwcKDA==", shasum: "ffe7f0b98220a4afac171e3fb9b6d1f8771f015e" },
  "strtok3": { version: "10.3.5", integrity: "sha512-ki4hZQfh5rX0QDLLkOCj+h+CVNkqmp/CMf8v8kZpkNVK6jGQooMytqzLZYUVYIZcFZ6yDB70EfD8POcFXiF5oA==", shasum: "7213285da0dc3dec0fc8ce5df4b8b7a733f14360" },
  "token-types": { version: "6.1.2", integrity: "sha512-dRXchy+C0IgK8WPC6xvCHFRIWYUbqqdEIKPaKo/AcTUNzwLTK6AH7RjdLWsEZcAN/TBdtfUw3PYEgPr5VPr6ww==", shasum: "18d0fd59b996d421f9f83914d6101c201bd08129" },
  "uint8array-extras": { version: "1.6.0", integrity: "sha512-8iAasVS4wUx0gPLjH8Xtz2PeDzTSiy8QiLGu2DT3X5GU+egFEQhpnbtkehbAwjvDcxIERmCYcysiODFmE3Ud0Q==", shasum: "ab895526255bddd698e75a02992ee73f1b112ebe" },
  "@tokenizer/inflate": { version: "0.4.1", integrity: "sha512-2mAv+8pkG6GIZiF1kNg1jAjh27IDxEPKwdGul3snfztFerfPGI1LjDezZp3i7BElXompqEtPmoPx6c2wgtWsOA==", shasum: "fa6cdb8366151b3cc8426bf9755c1ea03a2fba08" },
  "@tokenizer/token": { version: "0.3.0", integrity: "sha512-OvjF+z51L3ov0OyAU0duzsYuvO01PH7x4t6DJx+guahgTnBHkhJdG7soQeTSFLWN3efnHyibZ4Z8l2EuWwJN3A==", shasum: "fe98a93fe789247e998c75e74e9c7c63217aa276" },
  "@borewit/text-codec": { version: "0.2.2", integrity: "sha512-DDaRehssg1aNrH4+2hnj1B7vnUGEjU6OIlyRdkMd0aUdIUvKXrJfXsy8LVtXAy7DRvYVluWbMspsRhz2lcW0mQ==", shasum: "75025f735c0983b3a871668804a57387e3649375" },
  "ieee754": { version: "1.2.1", integrity: "sha512-dcyqhDvX1C46lXZcVqCpK+FtMRQVdIMN6/Df5js2zouUsqG7I6sFxitIC+7KYK29KdXOLHdu9zL4sFnoVQnqaA==", shasum: "8eb7a10a63fff25d15a57b001586d177d1b0d352" },
  "debug": { version: "4.4.3", integrity: "sha512-RGwwWnwQvkVfavKVt22FGLw+xYSdzARwm0ru6DhTVA3umU5hZc28V3kO4stgYryrTlLpuvgI9GiijltAjNbcqA==", shasum: "c6ae432d9bd9662582fce08709b038c58e9e3d6a" },
  "ms": { version: "2.1.3", integrity: "sha512-6FlzubTLZG3J2a/NVCAleEhjzq5oxgHyaCU9yYXvcLsvoVaHJq/s5xXI6/XXP6tz7R9xAOtHnSO/tXtF3WRTlA==", shasum: "574c8138ce1d2b5861f0b44579dbadd60c6615b2" },
});

/** The bounds OMA's adapter needs inside the vendored sources, written as
 * exact-once text splices over the post-rewrite tsc emit. upstream/ stays
 * the byte-exact npm snapshot; runtime/ carries these and only these edits
 * (plus the mechanical specifier rewrite, which is not semantic). Anchors
 * quote the emitted source verbatim: each `find` must occur exactly once
 * or the regeneration fails instead of emitting a partially patched
 * runtime.
 *
 * Divergence policy: OMA boundary seams only — the read path's file open
 * and the write path's commit+re-read become injectable so the adapter can
 * route them through OMA's contained admission and the serialized
 * quota-deciding writer. The read seam keeps upstream's plain open as its
 * uninstalled default (a Resident's sandbox installs no opener — the mount
 * plan is the boundary); the commit seam is fail-closed instead: with no
 * channel installed it throws, and direct writeAtomic use is confined to
 * the bundle's own state directory, so a mutation-target write outside
 * the channel cannot happen silently. Nothing about anchors, hashing,
 * parsing, diffing or payload validation is touched. */
const OMA_DIVERGENCES = Object.freeze({
  "file-kind.js": {
    reason:
      "OMA read seam: the whole file load — sniff sample and body — goes " +
      "through one injectable opener. In a host engine the adapter installs " +
      "the contained opener (workspace/readable-root admission plus the " +
      "descriptor-relative no-follow walk), so a hashline read cannot reach " +
      "a path the workspace guard would refuse. Uninstalled, upstream's " +
      "plain fs open is the behavior — the seam adds authority routing, " +
      "never weakens it.",
    edits: [
      {
        find: `import { open as fsOpen, stat as fsStat } from "node:fs/promises";`,
        replace: `import { open as fsOpen, stat as fsStat } from "node:fs/promises";
// OMA divergence (applied by scripts/vendor-pi-hashline.mjs; recorded
// under generated.divergences in manifest.json): the file open is an
// injectable seam. OMA's adapter installs a contained opener so every
// byte read -- sniff sample and body alike -- is admitted through the
// same boundary the workspace guard applies. With no opener installed
// the vendored code opens exactly as upstream does.
let omaReadOpener;
/** Install OMA's contained file opener (host engines). A Resident's
 * sandbox is itself the boundary, so no opener is installed there and
 * upstream's fs open is used. Passing undefined restores the default. */
export function omaInstallFileReader(opener) {
    omaReadOpener = opener;
}
function openForRead(path) {
    return omaReadOpener !== undefined ? omaReadOpener(path) : fsOpen(path, "r");
}`,
      },
      {
        find: `    const fileHandle = await fsOpen(filePath, "r");`,
        replace: `    const fileHandle = await openForRead(filePath);`,
      },
    ],
  },
  "file-kind.d.ts": {
    reason:
      "Declaration for the file-kind.js OMA read seam (see the .js " +
      "divergence) so the adapter's installer call type-checks under " +
      "NodeNext.",
    edits: [
      {
        find: `export declare function loadFileKindAndText(`,
        replace: `/** OMA divergence: installs the contained file opener (see file-kind.js). */
export declare function omaInstallFileReader(opener: ((path: string) => Promise<import("node:fs/promises").FileHandle>) | undefined): void;
export declare function loadFileKindAndText(`,
      },
    ],
  },
  "fs-write.js": {
    reason:
      "OMA write seam, fail-closed: the two commit paths (commit.js and " +
      "batch.js's multi-edit close) are rerouted from upstream's " +
      "writeAtomic to an installed writer, and the read-back verification " +
      "read is rerouted to the same seam's read. OMA's adapter installs " +
      "the contained serialized writer — quota decided inside the " +
      "serialization, no-follow descriptor walks, inode-identity check " +
      "against the read snapshot. With no channel installed the seam " +
      "throws instead of falling back to readFile/writeAtomic — a missing " +
      "channel means the contained boundary was never wired, and a silent " +
      "fallback would read or write the mutation target outside it. " +
      "writeAtomic itself is kept but confined to the bundle's own state " +
      "directory (config.js's configPath() under configDir(), redirected " +
      "by the adapter into OMA-owned space via PI_HASHLINE_DIR — a " +
      "different ownership domain); any other direct writeAtomic target — " +
      "e.g. replace-undo.js's undo write, were that tool ever registered — " +
      "refuses closed instead of writing uncontained. The identity " +
      "contract is upstream's: a missing or replaced inode refuses before " +
      "a byte is written.",
    edits: [
      {
        find: `import { toCwd } from "./paths.js";`,
        replace: `import { configDir, toCwd } from "./paths.js";`,
      },
      {
        find: `export async function writeAtomic(path, content, expectedIdentity, restoreMode) {
    const targetPath = await resolveTarget(path);`,
        replace: `// OMA divergence (applied by scripts/vendor-pi-hashline.mjs; recorded
// under generated.divergences in manifest.json): the commit write and the
// verification re-read are injectable and fail-closed. The seam is one
// object -- reads and writes of the mutation target route together so a
// caller cannot split them across boundaries. Installed by the adapter at
// registration, after bundle verification. With no channel installed the
// seam refuses rather than falling back to upstream's readFile/writeAtomic:
// a missing channel means the contained boundary was never wired, and a
// silent fallback would read or write the mutation target outside it.
let omaCommitChannel;
/** Install OMA's commit channel: { read(path) -> utf8 text,
 * write(path, content, expectedIdentity) -> contained write }. Passing
 * undefined restores the fail-closed default. */
export function omaInstallCommitChannel(channel) {
    omaCommitChannel = channel;
}
function omaRequiredChannel() {
    if (omaCommitChannel === undefined)
        throw new Error("[E_OMA_NO_COMMIT_CHANNEL] no OMA commit channel is installed; refusing to read or write a mutation target outside the contained boundary");
    return omaCommitChannel;
}
export async function omaReadFileText(path) {
    return omaRequiredChannel().read(path);
}
export async function omaWriteCommit(path, content, expectedIdentity) {
    return omaRequiredChannel().write(path, content, expectedIdentity);
}
export async function writeAtomic(path, content, expectedIdentity, restoreMode) {
    // OMA divergence: direct writeAtomic use is confined to the bundle's
    // own state directory -- config.js writes configPath() under
    // configDir(), which the adapter redirects into OMA-owned space via
    // PI_HASHLINE_DIR. Mutation targets are the commit channel's domain,
    // so a direct writeAtomic call on anything else -- replace-undo.js's
    // undo write, were that tool ever registered -- refuses closed here
    // instead of writing uncontained.
    const omaStateDir = resolve(configDir());
    if (!resolve(path).startsWith(omaStateDir + sep))
        throw new Error(\`[E_OMA_STATE_DOMAIN] writeAtomic serves the bundle's own state directory only; a mutation target goes through the OMA commit channel: \${path}\`);
    const targetPath = await resolveTarget(path);`,
      },
    ],
  },
  "fs-write.d.ts": {
    reason:
      "Declarations for the fs-write.js OMA commit seam (see the .js " +
      "divergence): the installed channel's read/write pair and the " +
      "commit/verification entry points the rerouted callers use.",
    edits: [
      {
        find: `export declare function writeAtomic(`,
        replace: `/** OMA divergence: the commit channel the adapter installs -- the
 * contained re-read and the serialized quota-deciding write. The seam is
 * fail-closed: with no channel installed omaReadFileText/omaWriteCommit
 * throw, and writeAtomic itself is confined to the bundle's own state
 * directory (the config.js domain) -- a direct mutation-target caller
 * refuses closed instead of writing uncontained. */
export interface OmaCommitChannel {
    read(path: string): Promise<string>;
    write(path: string, content: string, expectedIdentity?: FileIdentity): Promise<void>;
}
export declare function omaInstallCommitChannel(channel: OmaCommitChannel | undefined): void;
export declare function omaReadFileText(path: string): Promise<string>;
export declare function omaWriteCommit(path: string, content: string, expectedIdentity?: FileIdentity): Promise<void>;
export declare function writeAtomic(`,
      },
    ],
  },
  "commit.js": {
    reason:
      "Commit reroute: the unchanged-since-plan verification read and the " +
      "final write go through the installed OMA commit channel instead of " +
      "node:fs readFile and upstream writeAtomic. Semantics kept: the " +
      "content is compared after stripBOM/toLF exactly as upstream, and the " +
      "write still carries the read snapshot's inode identity so a replaced " +
      "or deleted target refuses before writing.",
    edits: [
      {
        find: `import { readFile } from "node:fs/promises";`,
        replace: `import { omaReadFileText } from "./fs-write.js";`,
      },
      {
        find: `import { writeAtomic } from "./fs-write.js";`,
        replace: `import { omaWriteCommit } from "./fs-write.js";`,
      },
      {
        find: `        currentRaw = await readFile(mutationTargetPath, "utf-8");`,
        replace: `        currentRaw = await omaReadFileText(mutationTargetPath);`,
      },
      {
        find: `        await writeAtomic(absolutePath, finalFileBytes, pipe.identity);`,
        replace: `        await omaWriteCommit(absolutePath, finalFileBytes, pipe.identity);`,
      },
    ],
  },
  "batch.js": {
    reason:
      "Batch commit reroute: the multi-edit close's verification re-read " +
      "and final write take the same OMA commit channel as commit.js — " +
      "contained admission, serialized quota decision, inode-identity " +
      "check — rather than node:fs readFile and upstream writeAtomic.",
    edits: [
      {
        find: `import { readFile } from "node:fs/promises";`,
        replace: `import { omaReadFileText } from "./fs-write.js";`,
      },
      {
        find: `import { resolveInCwd, writeAtomic } from "./fs-write.js";`,
        replace: `import { resolveInCwd, omaWriteCommit } from "./fs-write.js";`,
      },
      {
        find: `        currentRaw = await readFile(runtime.target, "utf-8");`,
        replace: `        currentRaw = await omaReadFileText(runtime.target);`,
      },
      {
        find: `        await writeAtomic(paths.absolutePath, base.bom + joinSeparators(composed, resultSeparators), base.identity);`,
        replace: `        await omaWriteCommit(paths.absolutePath, base.bom + joinSeparators(composed, resultSeparators), base.identity);`,
      },
    ],
  },
});

/** Every upstream src module the runtime emits: the vendored tree minus the
 * excluded feature/entry files, so upstream's exports compile wholesale and
 * the emit set drifts loudly when upstream grows a module. */
function runtimeModules() {
  const out = [];
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && entry.name.endsWith(".ts")) {
        const rel = slash(relative(UPSTREAM_SRC, absolute));
        if (!EXCLUDED_MODULES.includes(rel)) out.push(rel);
      }
    }
  };
  walk(UPSTREAM_SRC);
  return out.sort();
}

/** The expected emitted file set: one .js + one .d.ts per module plus the
 * JSON module tsc copies for resolveJsonModule imports. A surprise file —
 * or a missing one — is a regeneration failure, not a partial runtime. */
function expectedEmit(modules) {
  const out = modules.flatMap(name => [name.replace(/\.ts$/, ".js"), name.replace(/\.ts$/, ".d.ts")]);
  out.push("hashline/anchor-table.json");
  return out.sort();
}

/** Node's ESM loader needs explicit relative specifiers; upstream's bundler
 * resolution emitted none. Rewrites every relative specifier in the emitted
 * .js/.d.ts to the emitted target it resolves to under upstream/src, and
 * gives JSON imports their required `with { type: "json" }` attribute. A
 * specifier that resolves to nothing in the vendored sources fails the
 * regeneration — there is no guessing. */
function rewriteModuleSpecifiers(outDir) {
  const specifier = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(["'])(\.{1,2}\/[^"']+)\2/g;
  let rewrites = 0;
  for (const name of filesUnder(outDir)) {
    if (!name.endsWith(".js") && !name.endsWith(".d.ts")) continue;
    const file = join(outDir, name);
    const dir = dirname(name);
    const text = readFileSync(file, "utf8");
    const next = text.replace(specifier, (_match, head, quote, spec) => {
      const target = join(outDir, dir, spec);
      const source = join(UPSTREAM_SRC, dir, spec);
      if (spec.endsWith(".json")) {
        if (!existsSync(source)) throw new Error(`specifier ${spec} in ${name} resolves to no vendored source`);
        return `${head}${quote}${spec}${quote} with { type: "json" }`;
      }
      if (existsSync(`${source}.ts`) || existsSync(`${target}.js`)) {
        rewrites += 1;
        return `${head}${quote}${spec}.js${quote}`;
      }
      if (existsSync(join(source, "index.ts")) || existsSync(join(target, "index.js"))) {
        rewrites += 1;
        return `${head}${quote}${spec}/index.js${quote}`;
      }
      throw new Error(`specifier ${spec} in emitted ${name} resolves to nothing under upstream/src`);
    });
    if (next !== text) writeFileSync(file, next);
  }
  return rewrites;
}

/** Compile the vendored library modules with the repository's own tsc and
 * upstream's own compiler options (module ESNext + moduleResolution
 * bundler — see upstream/tsconfig.json), then rewrite specifiers for
 * Node's loader and apply OMA's declared divergence splices. */
function emitRuntime(outDir) {
  const require = createRequire(import.meta.url);
  const tsc = join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");
  const modules = runtimeModules();
  const args = [
    ...modules.map(name => join(UPSTREAM_SRC, name)),
    "--outDir", outDir, "--rootDir", UPSTREAM_SRC,
    "--declaration", "--target", "esnext", "--module", "esnext",
    "--moduleResolution", "bundler", "--strict", "--skipLibCheck",
    "--esModuleInterop", "--resolveJsonModule", "--isolatedModules",
    "--types", "node", "--noEmitOnError",
  ];
  execFileSync(process.execPath, [tsc, ...args], { cwd: root, stdio: "pipe", timeout: 120000, killSignal: "SIGKILL" });
  const emitted = filesUnder(outDir);
  const expected = expectedEmit(modules);
  if (JSON.stringify(emitted) !== JSON.stringify(expected))
    throw new Error(`tsc emit mismatch: got [${emitted.join(", ")}]`);
  rewriteModuleSpecifiers(outDir);
  applyDivergences(outDir, OMA_DIVERGENCES);
  return emitted;
}

function packageMetadata() {
  const pkg = JSON.parse(readFileSync(join(UPSTREAM_DIR, "package.json"), "utf8"));
  if (pkg.name !== EXPECTED_PACKAGE.name || pkg.version !== EXPECTED_PACKAGE.version)
    throw new Error(`upstream/package.json is not ${EXPECTED_PACKAGE.name}@${EXPECTED_PACKAGE.version}`);
  return {
    name: EXPECTED_PACKAGE.name,
    version: EXPECTED_PACKAGE.version,
    license: pkg.license ?? "MIT",
    repository: pkg.repository?.url ?? "git+https://github.com/YuGiMob/pi-hashline-edit-pro.git",
    commit: EXPECTED_PACKAGE.commit,
    npm: {
      tarball: `https://registry.npmjs.org/${EXPECTED_PACKAGE.name}/-/pi-hashline-edit-pro-${EXPECTED_PACKAGE.version}.tgz`,
      integrity: EXPECTED_PACKAGE.npmIntegrity,
      shasum: EXPECTED_PACKAGE.npmShasum,
    },
  };
}

/** The manifest's own words, compared against what this script would
 * declare today: the divergence table must equal OMA_DIVERGENCES (reason
 * text and edit count), package.* must equal the pinned upstream identity,
 * and the dependency table must equal DEPENDENCIES. A regenerated or
 * hand-edited manifest that drifted from the declared pins fails --check
 * even when every file record and the bundle digest still match. Exported
 * so the regression test can drive the same function the check runs. */
export function manifestMetadataProblems(manifest) {
  const problems = divergenceProblems(manifest, OMA_DIVERGENCES);
  const expectedPackage = packageMetadata();
  if (canonical(manifest?.package) !== canonical(expectedPackage))
    problems.push("manifest package does not match the pinned upstream identity");
  if (canonical(manifest?.generated?.dependencies) !== canonical(DEPENDENCIES))
    problems.push("manifest generated.dependencies does not match the pinned dependency closure");
  return problems;
}

/** The vendored dependency closure's identity half: every declared
 * package's vendored package.json must carry the pinned name and version.
 * (Bytes are bound by manifest.files + bundleSha256; this guards the pin
 * table itself.) */
function dependencyProblems() {
  const problems = [];
  for (const [name, pin] of Object.entries(DEPENDENCIES)) {
    const pkgPath = join(BUNDLE_DIR, "node_modules", ...name.split("/"), "package.json");
    let pkg;
    try { pkg = JSON.parse(readFileSync(pkgPath, "utf8")); }
    catch { problems.push(`vendored dependency ${name} is missing package.json`); continue; }
    if (pkg.name !== name || pkg.version !== pin.version)
      problems.push(`vendored dependency ${name} is ${pkg.name}@${pkg.version}; expected ${pin.version}`);
  }
  return problems;
}

function writeRuntime() {
  writeRuntimeTree(RUNTIME_DIR, emitRuntime, "oma-hashline-emit-");
}

function writeManifest() {
  const records = bundleRecords(BUNDLE_DIR);
  const manifest = {
    kind: "oma-vendored-bundle-v1",
    package: packageMetadata(),
    generated: {
      runtime:
        "tsc emit of upstream/src modules minus the excluded feature " +
        "surfaces (auto-read-all, config-ui, copy-move, glob, grep; the " +
        "package entry index.ts is vendored but never compiled or loaded), " +
        "compiled with upstream's own ESNext/bundler options, then " +
        "mechanically rewritten to Node-loadable ESM specifiers (./x -> " +
        "./x.js, ./dir -> ./dir/index.js, JSON imports gain " +
        "with { type: \"json\" }), then OMA divergence splices applied",
      tool: "scripts/vendor-pi-hashline.mjs",
      divergences: divergenceMetadata(OMA_DIVERGENCES),
      dependencies: DEPENDENCIES,
      upstreamTests:
        "upstream-tests/ is the repository's test/ tree at the vendored " +
        "commit (the npm tarball ships no tests); kept for provenance and " +
        "porting, not wired into npm test — they need vitest and the " +
        "upstream ../src layout",
    },
    files: records,
    bundleSha256: bundleDigest(records),
  };
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function check() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const problems = bundleRecordProblems(manifest, BUNDLE_DIR);
  const pkg = JSON.parse(readFileSync(join(UPSTREAM_DIR, "package.json"), "utf8"));
  if (manifest.package?.name !== pkg.name || manifest.package?.version !== pkg.version)
    problems.push("manifest package identity does not match upstream/package.json");
  if (!statSync(UPSTREAM_TESTS_DIR, { throwIfNoEntry: false })?.isDirectory())
    problems.push("upstream-tests/ is missing (the vendored commit's test/ tree belongs here)");
  problems.push(...dependencyProblems());
  // The manifest's own metadata is verified too: the divergence table must
  // equal this script's OMA_DIVERGENCES, package.* the pinned identity and
  // generated.dependencies the pinned closure, so a regenerated manifest
  // cannot launder a drifted splice or dependency set.
  problems.push(...manifestMetadataProblems(manifest));
  // The emitted runtime must be exactly what tsc produces from the vendored
  // sources plus the specifier rewrite and the declared OMA divergence
  // splices -- a hand-edited runtime/ file fails here even if someone
  // regenerated the manifest to match it, and so does a runtime missing a
  // declared splice.
  const scratch = mkdtempSync(join(tmpdir(), "oma-hashline-check-"));
  try {
    problems.push(...emittedRuntimeProblems(scratch, emitRuntime(scratch), RUNTIME_DIR));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  if (problems.length > 0) throw new Error(`vendored pi-hashline-edit-pro bundle is inconsistent:\n${problems.map(p => `  - ${p}`).join("\n")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const write = process.argv.slice(2).includes("--write");
    if (write) { writeRuntime(); const manifest = writeManifest(); console.log(JSON.stringify({ status: "BUNDLE_WRITTEN", files: manifest.files.length, bundleSha256: manifest.bundleSha256 })); }
    else { check(); console.log(JSON.stringify({ status: "BUNDLE_CURRENT", files: bundleRecords(BUNDLE_DIR).length })); }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
