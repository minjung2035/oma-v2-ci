import { mkdirAt } from "@oma/native/posix-files";
import type { PackageDirectories } from "../ports/package-files.js";
/** DR25/C20: `oma pi install` of a path on this machine.
 *
 * A local package is never used where it lies -- a Resident's sandbox could
 * not see it there, and a store the Human could edit after the fact would pin
 * nothing. Instead the source is copied into the store before the engine's
 * own package manager is asked to install it, so from the engine on it is
 * exactly a remote package:
 *
 * - the copy lives at `local/<name>` beside `npm/` and `git/` -- the store
 *   layout the index, the archive and the read-only mount already know;
 * - the engine is asked to install `local/<name>` and records that source in
 *   its own `settings.json`, store-relative, so the same words name the
 *   package on every machine the store travels to;
 * - the engine's resolver then names the package's extensions, skills,
 *   prompt templates and themes inside the store, which `writePackageIndex`
 *   keeps -- the same validation/store pipeline a remote install takes, with
 *   nothing local left outside the mount or the digest pinning.
 *
 * What a local source may be is what the engine could load from one: a
 * package directory (its package.json -- the manifest a remote package always
 * has -- with a `pi` object or conventional resource directories), a .tar or
 * .tgz archive of one, or a lone JS/TS extension file. Anything else is
 * refused with a reason. Links are never staged: the source's own links are
 * resolved to what they point at, matching the rule the index applies -- an
 * entry reached through a link is no entry a Resident may be shown. A copy
 * no configured source still names (a removed package's, an interrupted
 * install's staging) is dead content and is pruned after each change.
 *
 * Staging and archive inflation use the same held-directory operations.
 * The native leaf must provide the required containment; an unverified
 * substrate refuses before staging and has no pathname fallback.
 */
import { randomUUID } from "node:crypto";
import {
	closeSync, constants, createReadStream, fstatSync,
	lstatSync, openSync,
	readFileSync, readSync,
	readdirSync,
	realpathSync,
	statSync,
	writeSync
} from "node:fs";
import { userInfo } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";
import { PACKAGE_ENTRY_PREFIX, extensionEntryProblem } from "@oma/config/operations";
import { StoreError, unobserved, exceptionText } from "@oma/domain/errors";

import { PACKAGE_ARCHIVE_BOUNDS } from "@oma/domain/package-policy";
import { openBeneath, withinDirectory } from "@oma/native/files";
import { listOwnedDirectory, openOwnedDirectoryPath, removeOwnedFile, removeOwnedTree } from "@oma/storage/directory";
import { STAGING_PREFIX, collectStageStray, ownedStaging, type StageArea } from "@oma/storage/package-staging";
import { extractTar } from "@oma/storage/package-tar";
import { PACKAGE_LOCAL_DIR, configuredPackageSources, escapes, packageStoreRoot, resourceEntryProblem } from "../runtime/packages/index.js";
/** The conventional directories the engine's resolver collects a package's
 * skills, prompt templates, themes and extensions from when its `pi`
 * manifest does not declare them. */
const RESOURCE_DIRECTORIES = Object.freeze(["extensions", "skills", "prompts", "themes"]);

const refuse = (message: string): never => { throw new StoreError("INVALID_REQUEST", message); };

/** The absolute real path the given source names, with the shell conveniences
 * the engine's own resolver also knows (`~` and `file:`). What cannot be
 * reached is refused, not guessed at. */
function localSourcePath(given: string): string {
  let input = given.trim();
  if (input === "~") input = userInfo().homedir;
  else if (input.startsWith(`~${sep}`) || input.startsWith("~/")) input = join(userInfo().homedir, input.slice(2));
  else if (/^file:\/\//.test(input)) {
    try { input = fileURLToPath(input); }
    catch { return refuse(`not a file: path: ${given}`); }
  }
  try { return realpathSync(resolve(input)); }
  catch (error) { throw unobserved(error, "the local package source") ?? refuse(`the local package source does not exist: ${given}`); }
}

/** A source that is inside the store, or holds it, cannot be installed: the
 * first is already what an install would make, the second would copy the
 * store into itself. */
function checkStoreBoundary(store: string, source: string): void {
  const inside = relative(store, source);
  if (!escapes(inside)) refuse("the package is already inside the package store");
  const storeInside = relative(source, store);
  if (!escapes(storeInside)) refuse("the local package source contains the package store itself");
}

/** What the engine's own rule calls a package at `root`: a package.json that
 * parses to an object -- the manifest a remote package always has. When its
 * `pi` object declares nothing, the conventional resource directories are
 * what it holds (a manifest-less directory is none of it, and is refused).
 * The manifest's `name`, a string when it has one, names the staged copy. */
function packageManifest(root: string): { readonly name: string | undefined } {
  const file = join(root, "package.json");
  const observed = lstatSync(file, { throwIfNoEntry: false });
  if (observed === undefined)
    return refuse(`not a package (no package.json, the manifest a package must have): ${root}`);
  if (!observed.isFile()) return refuse(`the local package's package.json is not a file: ${root}`);
  // The manifest is the one member held whole: a JSON document the resolver
  // parses. Generous, not a capacity policy -- everything else in a package
  // is staged a chunk at a time.
  if (observed.size > PACKAGE_MANIFEST_BYTES)
    return refuse(`the local package's package.json exceeds its ${PACKAGE_MANIFEST_BYTES}-byte bound`);
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(file, "utf8")); }
  catch { return refuse(`the local package's package.json is not readable JSON: ${root}`); }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    refuse(`the local package's package.json is not an object: ${root}`);
  const manifest = parsed as { name?: unknown; pi?: unknown };
  if (manifest.pi === undefined && !RESOURCE_DIRECTORIES.some(dir => lstatSync(join(root, dir), { throwIfNoEntry: false })?.isDirectory()))
    refuse(`not a package (its package.json holds no pi manifest and no extensions/, skills/, prompts/ or themes/ directory is present): ${root}`);
  return { name: typeof manifest.name === "string" ? manifest.name : undefined };
}

/** The name under `local/` a staged copy answers to: the package's own name
 * when its manifest says one, else the name of what was pointed at. It must
 * spell a store-relative path the index's own rule accepts. */
function stagedName(manifest: string | undefined, fallback: string): string {
  const candidates = manifest === undefined || manifest === fallback ? [fallback] : [manifest, fallback];
  for (const candidate of candidates)
    if (resourceEntryProblem(`${PACKAGE_ENTRY_PREFIX}${PACKAGE_LOCAL_DIR}/${candidate}`) === null) return candidate;
  return refuse(`the local package has no usable name for the store: ${manifest ?? fallback}`);
}

/** A name a staged tree may carry: the same rule a `packages:` resource
 * entry's components keep, so what lands in the store can be indexed. */
function stagedComponent(name: string): void {
  if (name === "" || name === "." || name === ".." || name.includes("\0") || name.includes("\\") ||
      Buffer.byteLength(name, "utf8") > PACKAGE_ARCHIVE_BOUNDS.componentBytes)
    refuse(`the local package holds a name oma cannot store: ${JSON.stringify(name)}`);
}

/** A manifest read whole is a JSON document, so its bound is the generous
 * document one -- not the carry's old per-file cap, which size alone made
 * refuse packages that only streamed. */
const PACKAGE_MANIFEST_BYTES = 16 * 1024 * 1024;

/** A staged tree's count keeps the carry index's working bound; its bytes are
 * streamed, so size alone is not a refusal. */
interface StageBudget { entries: number }
function budgetFile(budget: StageBudget): void {
  if (++budget.entries > PACKAGE_ARCHIVE_BOUNDS.entries)
    refuse(`the local package holds more than ${PACKAGE_ARCHIVE_BOUNDS.entries} entries`);
}

/** The source tree copied beneath the staging root: links are resolved to
 * what they point at (the store keeps no links), `.git` is left behind as
 * `cpSync`'s filter left it, and anything that is not a file or a directory
 * is refused. */
function copyIntoStage(source: string, area: StageArea, rel: string, budget: StageBudget): void {
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    stagedComponent(entry.name);
    const dest = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (Buffer.byteLength(dest, "utf8") > PACKAGE_ARCHIVE_BOUNDS.pathBytes)
      refuse(`the local package holds a name longer than ${PACKAGE_ARCHIVE_BOUNDS.pathBytes} bytes: ${dest}`);
    const origin = join(source, entry.name);
    let observed;
    try { observed = statSync(origin); }
    catch (error) { throw unobserved(error, "the local package") ?? refuse(`the local package holds a link to nothing: ${dest}`); }
    if (observed.isDirectory()) {
      budgetFile(budget);
      area.make(dest);
      copyIntoStage(origin, area, dest, budget);
      continue;
    }
    if (!observed.isFile()) refuse(`the local package holds something that is not a file or a directory: ${dest}`);
    budgetFile(budget);
    // The copy is chunked and the file is checked before and after it is read:
    // a file that grows or is swapped mid-copy stages what the size named, and
    // the mismatch is the honest failure, not a partial copy.
    const fd = openSync(origin, constants.O_RDONLY);
    try {
      const before = fstatSync(fd);
      area.writeFrom(dest, fd, 0, before.size, (observed.mode & 0o111) !== 0);
      const after = statSync(origin);
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
        throw new StoreError("POLICY_CHANGED", `the local package's ${dest} changed while it was read`);
    } finally { closeSync(fd); }
  }
}

/** One staging area inside the store (a rename must stay on one file system),
 * always given back; what it produced is renamed out before it goes. */
function staging(root: string, fill: (area: StageArea) => { readonly made: string; readonly name: string }): string {
  const area = ownedStaging(root);
  try {
    const { made, name } = fill(area);
    area.publish(made, name);
    return `${PACKAGE_LOCAL_DIR}/${name}`;
  } finally { area.close(); }
}

function stageDirectory(store: string, source: string): string {
  const { name: manifest } = packageManifest(source);
  const name = stagedName(manifest, basename(source));
  return staging(store, area => {
    copyIntoStage(source, area, "", { entries: 0 });
    return { made: "", name };
  });
}

function stageFile(store: string, source: string): string {
  const name = basename(source);
  return staging(store, area => {
    const fd = openSync(source, constants.O_RDONLY);
    try {
      const before = fstatSync(fd);
      area.writeFrom(name, fd, 0, before.size, false);
      const after = statSync(source);
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
        throw new StoreError("POLICY_CHANGED", `the local file changed while it was read: ${name}`);
    } finally { closeSync(fd); }
    return { made: name, name };
  });
}

/** `oma pi install <path>`: copy the local package into the store and answer
 * the store-relative source (`local/<name>`) the engine is then asked to
 * install -- never the path the Human gave. */
export async function stageLocalPackage(store: string, given: string): Promise<string> {
  const source = localSourcePath(given);
  // The store's own slot is oma's: a file or a link where the store root
  // must be a directory can hold no staged copies -- the same stray the
  // collection answers inside `local/`. Left standing, realpath would carry
  // every staging open into a link's target and the ensured open would
  // wedge on a file there. Collected for what it is -- the slot alone, its
  // parent held -- the store then answers absent and the caller's `oma pi`
  // ensure remakes it.
  const slot = (() => {
    try { return lstatSync(store, { throwIfNoEntry: false }); } catch { return undefined; }
  })();
  if (slot !== undefined && !slot.isDirectory()) {
    withinDirectory(store, (parent, name) => collectStageStray(parent, dirname(store), [name]));
    // A stray the collection could not take stands as the corruption it is
    // -- never resolved through to whatever a link names.
    const held = (() => {
      try { return lstatSync(store, { throwIfNoEntry: false }); } catch { return undefined; }
    })();
    if (held !== undefined && !held.isDirectory())
      throw new StoreError("STORE_CORRUPT", "the package store is not a directory");
  }
  const root = packageStoreRoot(store) ?? refuse("the package store does not exist");
  checkStoreBoundary(root, source);
  const observed = lstatSync(source);
  if (observed.isDirectory()) return stageDirectory(root, source);
  if (observed.isFile()) {
    if (extensionEntryProblem(basename(source)) === null) return stageFile(root, source);
    return await stageArchive(root, source);
  }
  return refuse(`not a package source (not a directory, an archive or a JS/TS file): ${given}`);
}

/** A `.tar` or `.tgz` of one package directory, as `npm pack` writes it: ustar
 * entries under a single top directory. Read by this code rather than shelled
 * to `tar`, because both ends of the format are then this product's own and
 * closed -- regular files and directories only, within the archive bounds the
 * carried store already keeps. A link, a device, an absolute or escaping
 * name is refused, as is anything that is not ustar.
 *
 * Nothing about the archive is held whole: a `.tgz` is inflated to a spool
 * file a chunk at a time (a sibling of the staging areas, which the stage
 * sweep collects if it is left), a `.tar` is read in place, and entries are
 * parsed and copied header by header, member bytes streaming to the staged
 * file. An archive the old whole-buffer path refused on size alone stages. */
async function stageArchive(store: string, source: string): Promise<string> {
  const before = (() => {
    try { return lstatSync(source); }
    catch (error) { throw unobserved(error, "the local package") ?? refuse(`the package archive could not be read (${exceptionText(error)})`); }
  })();
  if (!before.isFile()) return refuse(`the package archive is not a file: ${source}`);
  const gzip = (() => {
    const fd = openSync(source, constants.O_RDONLY);
    try { const head = Buffer.alloc(2); return readSync(fd, head, 0, 2, 0) === 2 && head[0] === 0x1f && head[1] === 0x8b; }
    finally { closeSync(fd); }
  })();
  // A scratch directory for the inflated stream: its name starts with the
  // staging prefix, so the stage sweep collects it if a crash leaves it.
  let spool: string;
  try {
    {
      const storeFd = openOwnedDirectoryPath(store);
      const spoolName = `${STAGING_PREFIX}${randomUUID()}`;
      spool = join(store, spoolName);
      try { mkdirAt(storeFd, spoolName, 0o700); }
      finally { closeSync(storeFd); }
    }
  } catch (error) { throw unobserved(error, "the local package") ?? refuse(`the package archive's staging directory could not be made (${exceptionText(error)})`); }
  const tar = gzip ? join(spool, "archive.tar") : source;
  try {
    if (gzip) {
      try {
        // Resolve once, create exclusively beneath the held parent, and
        // stream the inflated archive without retaining it in memory.
        const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
        const out = withinDirectory(tar, (parent, name) => openBeneath(parent, name, flags, 0o600));
        try {
          await pipeline(createReadStream(source), createGunzip(), async chunks => {
            for await (const chunk of chunks) writeSync(out, chunk as Buffer);
          });
        } finally { closeSync(out); }
      } catch (error) {
        throw unobserved(error, "the local package") ?? refuse(`the package archive is not a gzip stream oma can read (${exceptionText(error)})`);
      }
    }
    const fd = openSync(tar, constants.O_RDONLY);
    let staged: string;
    try {
      staged = staging(store, area => {
        extractTar(fd, area);
        const tops = readdirSync(area.path);
        const made = tops.length === 1 && lstatSync(join(area.path, tops[0]!)).isDirectory() ? tops[0]! : "";
        const { name: manifest } = packageManifest(made === "" ? area.path : join(area.path, made));
        const name = stagedName(manifest, archiveName(source));
        return { made, name };
      });
    } finally { closeSync(fd); }
    // The file that staged the package is checked after the read too: an
    // archive swapped mid-read did not stage what its stat named.
    const after = lstatSync(source, { throwIfNoEntry: false });
    if (after === undefined || before.dev !== after.dev || before.ino !== after.ino ||
        before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
      throw new StoreError("POLICY_CHANGED", "the package archive changed while it was read");
    return staged;
  } finally { removeOwnedTree(spool); }
}

function archiveName(source: string): string {
  return basename(source).replace(/\.(?:tgz|tar\.gz|tar)$/i, "") || "package";
}

/** Staged copies under `local/` -- and staging areas an interrupted install
 * left -- that no configured source still names are dead content. Runs after
 * each `oma pi` change: a removed local package's copy goes with its entry. */
export function pruneLocalStage(store: string, directories: Pick<PackageDirectories, "list"> = { list: listOwnedDirectory }): void {
  /** Dead content that cannot go yet is left for the next change's sweep: a
   * single bad entry -- one that vanished or changed type as the sweep
   * reached it, one a same-UID stray made unremovable -- never aborts the
   * run, because a throw out of this prune is thrown by every later `oma pi`
   * change. */
  const remove = (path: string, directory: boolean): void => {
    try {
      if (directory) removeOwnedTree(path); else removeOwnedFile(path);
    } catch { /* retention beats a wedge */ }
  };
  // The store's own slot is the sweep's too: a file or a link where the
  // store root must be a directory can hold no staged copies -- the same
  // stray a non-directory `local` is collected for below. Left standing,
  // realpath carried the whole sweep (and every ensured open) into whatever
  // a link named. The collection targets the one slot itself -- the store's
  // own position, never the unowned space beside it.
  const slot = (() => {
    try { return lstatSync(store, { throwIfNoEntry: false }); } catch { return undefined; }
  })();
  if (slot === undefined) return;
  if (!slot.isDirectory()) { remove(store, false); return; }
  const root = packageStoreRoot(store);
  if (root === null) return;
  /** `dir`'s entries, or null when it cannot be listed. The store is oma's
   * own tree, so before listing, a directory that lost its owner
   * read/write/search bits -- a mode a stray or an interrupted writer
   * left -- is given them back, the same repair removeOwnedTree makes
   * inside the trees it deletes (a mode-000 copy then answers readdir; a
   * read-only one has children removed from it). Bits are only added, so a
   * directory that stays loses nothing. What still cannot be listed -- an
   * entry that vanished or stopped being a directory as the sweep reached
   * it -- is kept whole: dead content surviving one sweep beats a wedge. */
  const list = directories.list;
  const top = list(root);
  if (top === null) return;
  for (const entry of top)
    if (entry.name.startsWith(STAGING_PREFIX)) {
      // A staging area is a directory, but the prefix is only a name: a
      // regular file or link carrying it is removed for what it is --
      // removeOwnedTree opens its root O_DIRECTORY and a non-directory
      // would abort the whole prune (wedging every later `oma pi` change).
      const path = join(root, entry.name);
      const observed = (() => {
        try { return lstatSync(path, { throwIfNoEntry: false }); } catch { return undefined; }
      })();
      if (observed !== undefined) remove(path, observed.isDirectory());
    }
  const local = join(root, PACKAGE_LOCAL_DIR);
  // A stat that cannot answer -- `local` vanished, or a component of `root`
  // did as the sweep turned to it -- is answered as "no `local`", the way
  // the existsSync this check replaced answered false: nothing below a name
  // that cannot be seen is the sweep's to collect.
  const localEntry = (() => {
    try { return lstatSync(local, { throwIfNoEntry: false }); } catch { return undefined; }
  })();
  if (localEntry === undefined) return;
  if (!localEntry.isDirectory()) {
    // `local/` is only ever a directory staging made: a file, link or socket
    // in its slot holds no staged copies beneath it, and reading it as a
    // directory would throw and wedge every later `oma pi` change. The store
    // root is oma's own, so the stray entry is collected for what it is --
    // the same answer the staging-prefixed non-directories above get. A link
    // is unlinked, never followed: what it pointed at is not the entry's.
    remove(local, false);
    return;
  }
  const inside: string[] = [];
  /** A source that resolves to `local` itself -- `local`, `local/`, `local/.`
   * or the store's absolute `local` path, all of which `relative` answers ""
   * for -- keeps the whole staged area: the `inside` list cannot express it
   * (no component is "" beneath its root), so reading it as naming nothing
   * would sweep every configured copy at once. Keeping everything is the
   * fail-safe reading of a hand edit that names the stage itself -- the same
   * answer an unlistable directory gets: retention beats destruction. */
  let whole = false;
  for (const source of configuredPackageSources(root)) {
    const resolved = isAbsolute(source) ? source : join(root, source);
    const path = relative(local, resolved);
    if (path === "") { whole = true; continue; }
    // `..foo` is a name under `local/`, not an escape from it: the component
    // test, not the two-character prefix, decides (the same `escapes` the
    // store boundary check and the index's preflight share).
    if (!escapes(path)) inside.push(path);
  }
  /** `dir` is `rel` beneath `local/` ("" for `local` itself, which is never
   * removed). A child a configured source names exactly is kept whole -- a
   * staged copy IS its `local/<...>` path, including a bare "@word" scope
   * directory a manifest may name itself (`local/@bare` stages AT the scope
   * dir). A child holding a strict descendant source is descended when it is
   * a directory -- to whatever depth the configured sources reach -- and a
   * directory emptied of dead children goes with them. A prefix that is not
   * a directory holds nothing descendable, so it is dead content collected
   * as the entry it is -- a link is unlinked, never followed -- the same
   * answer `local`-as-non-directory gets above: keeping it wedged every
   * later install of the configured descendant on staging's own descend
   * (ENOTDIR, or ELOOP for the link). Anything else under `local/` is dead
   * content. */
  const sweep = (dir: string, rel: string): void => {
    for (const entry of list(dir) ?? []) {
      const unit = rel === "" ? entry.name : `${rel}${sep}${entry.name}`;
      if (inside.includes(unit)) continue;
      const path = join(dir, entry.name);
      if (inside.some(source => source.startsWith(`${unit}${sep}`))) {
        if (!entry.isDirectory()) { remove(path, false); continue; }
        sweep(path, unit);
        if (list(path)?.length === 0) remove(path, true);
        continue;
      }
      const observed = (() => {
        try { return lstatSync(path, { throwIfNoEntry: false }); } catch { return undefined; }
      })();
      if (observed !== undefined) remove(path, observed.isDirectory());
    }
  };
  if (!whole) sweep(local, "");
}
