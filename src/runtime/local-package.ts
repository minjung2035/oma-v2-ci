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
 * Staging writes are FS-005's shape: on Linux the store is inside a society's
 * state tree, so every name under it is made through a directory held open
 * once; on the Mac the store lives in the app's own support directory, which
 * the host's file owner writes by path under the host lock.
 */
import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { closeSync, constants, existsSync, fsyncSync, lstatSync, mkdirSync, readdirSync, readFileSync,
  realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { userInfo } from "node:os";
import { fileURLToPath } from "node:url";
import { StoreError, unobserved } from "../domain/errors.js";
import { PACKAGE_ENTRY_PREFIX, extensionEntryProblem } from "../config/operations.js";
import { PACKAGE_LOCAL_DIR, packageStoreRoot, resourceEntryProblem } from "./pi-packages.js";
import { ensureUserDirectory, readUserFile } from "./user-files.js";
import { entryAt, openBeneath, openDirectory } from "../storage/contained-fs.js";
import { removeOwnedFile, removeOwnedTree } from "../storage/directory.js";
import { fsyncFile, fsyncTree } from "../storage/durable-fs.js";
import { PACKAGE_ARCHIVE_BOUNDS } from "../platform/package-archive.js";
import { createHostStagingDirectory, makeHostStagedDirectories, publishHostStaged, removeHostStaged,
  writeHostStagedFile } from "../platform/host/files.js";
/** An interrupted staging area the next change removes. */
const STAGING_PREFIX = ".staging-local-";
/** The conventional directories the engine's resolver collects a package's
 * skills, prompt templates, themes and extensions from when its `pi`
 * manifest does not declare them. */
const RESOURCE_DIRECTORIES = Object.freeze(["extensions", "skills", "prompts", "themes"]);

/** UX-20: how large the engine's package list (`settings.json` in the store)
 * may be when pruning asks it what stays. The file names one line per
 * installed package; this is a DoS ceiling, never the size a real store is
 * meant to reach. */
export const PACKAGE_SETTINGS_BYTES = 1024 * 1024;

const refuse = (message: string): never => { throw new StoreError("INVALID_REQUEST", message); };
const errorWordsOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** What staging a local package needs of the filesystem beneath the store: a
 * scratch directory to fill, then one rename into `local/`. The two platforms
 * implement it their own way (the file's header says why); the readers of the
 * staged tree use `path`, which is never written through. */
interface StageArea {
  /** The staging root's own path -- for reading it back, not writing it. */
  readonly path: string;
  /** `rel` is a directory beneath the staging root, its parents made too. */
  make(rel: string): void;
  /** `bytes` is the file `rel` beneath the staging root, its parents made. */
  write(rel: string, bytes: Buffer, executable: boolean): void;
  /** `made` -- a leaf name under the staging root, "" for the root itself --
   * becomes `local/<name>` whole, replacing a dead copy. */
  publish(made: string, name: string): void;
  /** The staging root is given back; a published name is unaffected. */
  close(): void;
}

const DIRECTORY = constants.O_RDONLY | constants.O_DIRECTORY;

/** `rel`'s components beneath the held `dir`, each named through its held
 * parent; the deepest is answered held for the caller (which is `dir` itself
 * when `rel` names nothing). */
function descendBeneath(dir: number, rel: string, create: boolean): number {
  let current = dir;
  for (const part of rel.split("/")) {
    if (part === "") continue;
    if (create) {
      try { mkdirSync(entryAt(current, part)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    }
    const child = openBeneath(current, part, DIRECTORY);
    if (current !== dir) closeSync(current);
    current = child;
  }
  return current;
}

/** Linux staging: the store root and the scratch directory are held open for
 * the whole operation and every write names an entry through them. */
function linuxStaging(root: string): StageArea {
  const store = openDirectory(root);
  let dir: number | undefined;
  const tmp = `${STAGING_PREFIX}${randomUUID()}`;
  const path = join(root, tmp);
  try {
    mkdirSync(entryAt(store, tmp), { mode: 0o700 });
    dir = openBeneath(store, tmp, DIRECTORY);
  } catch (error) {
    if (dir !== undefined) closeSync(dir);
    closeSync(store);
    throw error;
  }
  const held = dir;
  const release = (fd: number): void => { if (fd !== held && fd !== store) closeSync(fd); };
  let closed = false;
  return {
    path,
    make(rel) {
      release(descendBeneath(held, rel, true));
    },
    write(rel, bytes, executable) {
      const parent = descendBeneath(held, dirname(rel) === "." ? "" : dirname(rel), true);
      try { writeFileSync(entryAt(parent, basename(rel)), bytes, { mode: executable ? 0o755 : 0o644 }); }
      finally { release(parent); }
    },
    publish(made, name) {
      const source = made === "" ? store : held;
      const leaf = made === "" ? tmp : made;
      const localPath = join(root, PACKAGE_LOCAL_DIR);
      ensureUserDirectory(localPath);
      const local = openBeneath(store, PACKAGE_LOCAL_DIR, DIRECTORY);
      try {
        const parts = name.split("/");
        const destName = parts.pop()!;
        // `dest` is `local` itself when the name holds no scope.
        const dest = descendBeneath(local, parts.join("/"), true);
        try {
          const destPath = join(localPath, name);
          const observed = lstatSync(destPath, { throwIfNoEntry: false });
          if (observed !== undefined) {
            if (observed.isDirectory()) removeOwnedTree(destPath); else removeOwnedFile(destPath);
          }
          renameSync(entryAt(source, leaf), entryAt(dest, destName));
          // The copy must outlive a crash the way the index naming it does.
          const arrived = lstatSync(destPath);
          if (arrived.isDirectory()) {
            const tree = openBeneath(dest, destName, DIRECTORY);
            try { fsyncTree(tree, "regular-files"); } finally { closeSync(tree); }
          } else fsyncFile(destPath);
          fsyncSync(dest);
        } finally { if (dest !== local) closeSync(dest); }
        fsyncSync(local);
      } finally { closeSync(local); }
      // The name the staging root left behind, so a crash proves nothing half-seen.
      fsyncSync(source === store ? store : held);
    },
    close() {
      if (closed) return;
      closed = true;
      try { removeOwnedTree(path); }
      finally { closeSync(held); closeSync(store); }
    },
  };
}

/** Mac staging: the same effects by path, through the host's file owner --
 * the store is in the app's support directory, outside any state tree. */
function hostStaging(root: string): StageArea {
  const path = createHostStagingDirectory(root, STAGING_PREFIX);
  let closed = false;
  return {
    path,
    make: rel => makeHostStagedDirectories(path, rel),
    write: (rel, bytes, executable) => writeHostStagedFile(path, rel, bytes, executable ? 0o755 : 0o644),
    publish: (made, name) => publishHostStaged(made === "" ? path : join(path, made), join(root, PACKAGE_LOCAL_DIR), name),
    close() { if (closed) return; closed = true; removeHostStaged(path); },
  };
}

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

/** `rel` (what `relative(root, x)` answered) leaves its root when it is
 * absolute or its first component is `..` -- a name merely starting with the
 * two characters ("..foo") stays inside. */
const escapes = (rel: string): boolean => rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);

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
  if (observed.size > PACKAGE_ARCHIVE_BOUNDS.fileBytes)
    return refuse(`the local package's package.json exceeds its ${PACKAGE_ARCHIVE_BOUNDS.fileBytes}-byte bound`);
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

/** A staged tree's size keeps the bounds the carried store's archive keeps. */
interface StageBudget { entries: number; bytes: number }
function budgetFile(budget: StageBudget, rel: string, size: number): void {
  if (++budget.entries > PACKAGE_ARCHIVE_BOUNDS.entries)
    refuse(`the local package holds more than ${PACKAGE_ARCHIVE_BOUNDS.entries} entries`);
  if (size > PACKAGE_ARCHIVE_BOUNDS.fileBytes)
    refuse(`the local package's ${rel} exceeds its ${PACKAGE_ARCHIVE_BOUNDS.fileBytes}-byte file bound`);
  if ((budget.bytes += size) > PACKAGE_ARCHIVE_BOUNDS.bytes)
    refuse(`the local package exceeds its ${PACKAGE_ARCHIVE_BOUNDS.bytes}-byte bound`);
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
      budgetFile(budget, dest, 0);
      area.make(dest);
      copyIntoStage(origin, area, dest, budget);
      continue;
    }
    if (!observed.isFile()) refuse(`the local package holds something that is not a file or a directory: ${dest}`);
    if (observed.size > PACKAGE_ARCHIVE_BOUNDS.fileBytes)
      refuse(`the local package's ${dest} exceeds its ${PACKAGE_ARCHIVE_BOUNDS.fileBytes}-byte file bound`);
    const bytes = readFileSync(origin);
    budgetFile(budget, dest, bytes.length);
    area.write(dest, bytes, (observed.mode & 0o111) !== 0);
  }
}

/** One staging area inside the store (a rename must stay on one file system),
 * always given back; what it produced is renamed out before it goes. */
function staging(root: string, fill: (area: StageArea) => { readonly made: string; readonly name: string }): string {
  const area = process.platform === "darwin" ? hostStaging(root) : linuxStaging(root);
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
    copyIntoStage(source, area, "", { entries: 0, bytes: 0 });
    return { made: "", name };
  });
}

function stageFile(store: string, source: string): string {
  const name = basename(source);
  if (statSync(source).size > PACKAGE_ARCHIVE_BOUNDS.fileBytes)
    refuse(`the local file exceeds its ${PACKAGE_ARCHIVE_BOUNDS.fileBytes}-byte bound`);
  const bytes = readFileSync(source);
  if (bytes.length > PACKAGE_ARCHIVE_BOUNDS.fileBytes)
    refuse(`the local file exceeds its ${PACKAGE_ARCHIVE_BOUNDS.fileBytes}-byte bound`);
  return staging(store, area => {
    area.write(name, bytes, false);
    return { made: name, name };
  });
}

/** `oma pi install <path>`: copy the local package into the store and answer
 * the store-relative source (`local/<name>`) the engine is then asked to
 * install -- never the path the Human gave. */
export function stageLocalPackage(store: string, given: string): string {
  const source = localSourcePath(given);
  const root = packageStoreRoot(store) ?? refuse("the package store does not exist");
  checkStoreBoundary(root, source);
  const observed = lstatSync(source);
  if (observed.isDirectory()) return stageDirectory(root, source);
  if (observed.isFile()) {
    if (extensionEntryProblem(basename(source)) === null) return stageFile(root, source);
    return stageArchive(root, source);
  }
  return refuse(`not a package source (not a directory, an archive or a JS/TS file): ${given}`);
}

/** A `.tar` or `.tgz` of one package directory, as `npm pack` writes it: ustar
 * entries under a single top directory. Read by this code rather than shelled
 * to `tar`, because both ends of the format are then this product's own and
 * closed -- regular files and directories only, within the archive bounds the
 * carried store already keeps. A link, a device, an absolute or escaping
 * name is refused, as is anything that is not ustar. */
function stageArchive(store: string, source: string): string {
  if (statSync(source).size > PACKAGE_ARCHIVE_BOUNDS.fileBytes)
    refuse(`the package archive exceeds its ${PACKAGE_ARCHIVE_BOUNDS.fileBytes}-byte bound`);
  let data: Buffer;
  try { data = readFileSync(source); }
  catch (error) { throw unobserved(error, "the local package") ?? refuse(`the package archive could not be read (${errorWordsOf(error)})`); }
  if (data.length > PACKAGE_ARCHIVE_BOUNDS.fileBytes)
    refuse(`the package archive exceeds its ${PACKAGE_ARCHIVE_BOUNDS.fileBytes}-byte bound`);
  const bytes = isGzip(data) ? inflate(data) : data;
  return staging(store, area => {
    extractTar(bytes, area);
    const tops = readdirSync(area.path);
    const made = tops.length === 1 && lstatSync(join(area.path, tops[0]!)).isDirectory() ? tops[0]! : "";
    const { name: manifest } = packageManifest(made === "" ? area.path : join(area.path, made));
    const name = stagedName(manifest, archiveName(source));
    return { made, name };
  });
}

function isGzip(bytes: Buffer): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function inflate(data: Buffer): Buffer {
  try { return gunzipSync(data, { maxOutputLength: PACKAGE_ARCHIVE_BOUNDS.bytes }); }
  catch { return refuse("the package archive is not a gzip stream oma can read"); }
}

function archiveName(source: string): string {
  return basename(source).replace(/\.(?:tgz|tar\.gz|tar)$/i, "") || "package";
}

const USTAR = "ustar";
const BLOCK = 512;

/** The NUL-terminated text of one header field. */
function tarString(field: Buffer): string {
  const end = field.indexOf(0);
  return field.subarray(0, end < 0 ? field.length : end).toString("utf8");
}

/** An octal (or GNU base-256) header number. */
function tarNumber(field: Buffer): number {
  if (field.length > 0 && (field[0]! & 0x80)) {
    let value = 0;
    for (let index = 1; index < field.length; index++) value = value * 256 + field[index]!;
    return value;
  }
  const text = tarString(field).trim();
  return text === "" ? 0 : Number.parseInt(text, 8);
}

/** A header's own checksum, with the checksum field read as spaces per ustar. */
function tarChecksum(header: Buffer): boolean {
  let sum = 0;
  for (let index = 0; index < BLOCK; index++) sum += index >= 148 && index < 156 ? 0x20 : header[index]!;
  return sum === tarNumber(header.subarray(148, 156));
}

/** One `len key=value\n` pax record; the length includes itself. */
function* paxRecords(content: Buffer, fail: (words: string) => never): Generator<{ key: string; value: string }> {
  let at = 0;
  while (at < content.length) {
    const space = content.indexOf(0x20, at);
    if (space < 0) fail("a pax record has no length");
    const length = Number.parseInt(content.subarray(at, space).toString("ascii"), 10);
    if (!Number.isInteger(length) || length < 3 || at + length > content.length) fail("a pax record length is wrong");
    const record = content.subarray(space + 1, at + length - 1).toString("utf8");
    const equal = record.indexOf("=");
    if (equal > 0) yield { key: record.slice(0, equal), value: record.slice(equal + 1) };
    at += length;
  }
}

/** Writes every entry of a ustar stream into the staging area; nothing that
 * is not a regular file or a directory, and no name that is not a normalized
 * relative path -- the same rule a `packages:` entry keeps. */
function extractTar(bytes: Buffer, area: StageArea): void {
  const fail = (words: string): never => { throw new StoreError("INVALID_REQUEST", `the package archive is not a tar oma can install: ${words}`); };
  const made = new Set<string>();
  /** `rel` (a directory) and its parents exist beneath the staging root. */
  const ensure = (rel: string): void => {
    let at = "";
    for (const part of rel.split("/")) {
      at = at === "" ? part : `${at}/${part}`;
      if (part !== "" && !made.has(at)) { area.make(at); made.add(at); }
    }
  };
  /** The directories `rel`'s parent names, made; a root-level name has none
   * (`lastIndexOf` answers -1, which `slice` would read as "drop the last
   * character"). */
  const ensureParents = (rel: string): void => {
    const cut = rel.lastIndexOf("/");
    ensure(cut < 0 ? "" : rel.slice(0, cut));
  };
  let position = 0, entries = 0, written = 0;
  let longName: string | undefined;
  let paxPath: string | undefined, paxSize: number | undefined;
  /** A directory member's name ends in one `/` (as `npm pack` writes it);
   * that trailing mark is stripped before the normalized-path rule runs --
   * every other shape (`//`, embedded empties, `.`, `..`, absolute) fails. */
  const entryName = (raw: string, directory: boolean): string => {
    let name = raw.startsWith("./") ? raw.slice(2) : raw;
    if (directory && name.endsWith("/")) name = name.slice(0, -1);
    if (Buffer.byteLength(name, "utf8") === 0 || Buffer.byteLength(name, "utf8") > PACKAGE_ARCHIVE_BOUNDS.pathBytes ||
        name.includes("\0") || name.includes("\\") || isAbsolute(name) ||
        name.split("/").some(part => !part || part === "." || part === ".." || Buffer.byteLength(part, "utf8") > PACKAGE_ARCHIVE_BOUNDS.componentBytes))
      fail(`an entry name is not a normalized relative path: ${JSON.stringify(raw)}`);
    return name;
  };
  for (;;) {
    if (position + BLOCK > bytes.length) {
      if (bytes.subarray(position).every(byte => byte === 0)) break;
      fail("it ends inside a header");
    }
    const header = bytes.subarray(position, position + BLOCK);
    if (header.every(byte => byte === 0)) break;
    if (tarString(header.subarray(257, 262)) !== USTAR) fail("a header is not ustar");
    if (!tarChecksum(header)) fail("a header checksum does not hold");
    if (++entries > PACKAGE_ARCHIVE_BOUNDS.entries) fail(`it holds more than ${PACKAGE_ARCHIVE_BOUNDS.entries} entries`);
    const type = header[156]!;
    const size = tarNumber(header.subarray(124, 136));
    if (!Number.isSafeInteger(size) || size < 0 || size > PACKAGE_ARCHIVE_BOUNDS.fileBytes)
      fail(`an entry exceeds the ${PACKAGE_ARCHIVE_BOUNDS.fileBytes}-byte file bound`);
    if ((written += size) > PACKAGE_ARCHIVE_BOUNDS.bytes) fail(`it holds more than ${PACKAGE_ARCHIVE_BOUNDS.bytes} bytes`);
    position += BLOCK;
    const content = bytes.subarray(position, position + size);
    if (content.length !== size) fail("it ends inside a file");
    position += Math.ceil(size / BLOCK) * BLOCK;
    const name = paxPath ?? longName ?? (() => {
      const leaf = tarString(header.subarray(0, 100));
      const prefix = tarString(header.subarray(345, 500));
      return prefix ? `${prefix}/${leaf}` : leaf;
    })();
    const sizeOverride = paxSize;
    paxPath = undefined; paxSize = undefined; longName = undefined;
    if (sizeOverride !== undefined && sizeOverride !== size) fail("a pax size does not match its header");
    switch (type) {
      case 0x78: // 'x' — pax per-entry metadata
        for (const record of paxRecords(content, fail)) {
          if (record.key === "path") paxPath = record.value;
          else if (record.key === "size") paxSize = Number.parseInt(record.value, 10);
        }
        continue;
      case 0x67: continue; // 'g' — pax globals; none apply per entry
      case 0x4c: longName = tarString(content); continue; // 'L' — GNU long name
      case 0x4b: continue; // 'K' — a long link name; the link itself is refused below
      case 0x35: { // '5' — directory
        const rel = entryName(name, true);
        ensureParents(rel);
        if (made.has(rel)) fail(`a duplicate entry: ${rel}`);
        area.make(rel);
        made.add(rel);
        continue;
      }
      case 0x00: case 0x30: case 0x37: { // regular file
        const rel = entryName(name, false);
        ensureParents(rel);
        if (made.has(rel)) fail(`a duplicate entry: ${rel}`);
        area.write(rel, content, (tarNumber(header.subarray(100, 108)) & 0o111) !== 0);
        made.add(rel);
        continue;
      }
      default:
        fail(`an entry that is not a file or a directory (type ${JSON.stringify(String.fromCharCode(type))}): ${name}`);
    }
  }
}

/** The package sources the store's own `settings.json` names -- the package
 * manager's list, which is the authority on what staged copies stay. */
function configuredPackageSources(store: string): readonly string[] {
  const file = readUserFile(join(store, "settings.json"), PACKAGE_SETTINGS_BYTES);
  if (file === null) return Object.freeze([]);
  let value: unknown;
  try { value = JSON.parse(file); } catch { throw new StoreError("STORE_CORRUPT", "the package store's settings are malformed"); }
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new StoreError("STORE_CORRUPT", "the package store's settings are malformed");
  const packages = (value as { packages?: unknown }).packages;
  if (packages === undefined) return Object.freeze([]);
  if (!Array.isArray(packages)) throw new StoreError("STORE_CORRUPT", "the package store's settings are malformed");
  return Object.freeze(packages.map(pkg =>
    typeof pkg === "string" ? pkg
      : pkg !== null && typeof pkg === "object" && typeof (pkg as { source?: unknown }).source === "string" ? (pkg as { source: string }).source
      : null).filter((source): source is string => source !== null));
}

/** Staged copies under `local/` -- and staging areas an interrupted install
 * left -- that no configured source still names are dead content. Runs after
 * each `oma pi` change: a removed local package's copy goes with its entry. */
export function pruneLocalStage(store: string): void {
  const root = packageStoreRoot(store);
  if (root === null) return;
  const darwin = process.platform === "darwin";
  const remove = (path: string, directory: boolean): void => {
    if (darwin) return removeHostStaged(path);
    if (directory) removeOwnedTree(path); else removeOwnedFile(path);
  };
  for (const entry of readdirSync(root, { withFileTypes: true }))
    if (entry.name.startsWith(STAGING_PREFIX)) {
      // A staging area is a directory, but the prefix is only a name: a
      // regular file or link carrying it is removed for what it is --
      // removeOwnedTree opens its root O_DIRECTORY and a non-directory
      // would abort the whole prune (wedging every later `oma pi` change).
      const path = join(root, entry.name);
      remove(path, lstatSync(path).isDirectory());
    }
  const local = join(root, PACKAGE_LOCAL_DIR);
  if (!existsSync(local)) return;
  const inside: string[] = [];
  for (const source of configuredPackageSources(root)) {
    const resolved = isAbsolute(source) ? source : join(root, source);
    const path = relative(local, resolved);
    // `..foo` is a name under `local/`, not an escape from it: the component
    // test, not the two-character prefix, decides (the same `escapes` the
    // store boundary check uses).
    if (path !== "" && !escapes(path)) inside.push(path);
  }
  const kept = (unit: string): boolean => inside.some(path => path === unit || path.startsWith(`${unit}${sep}`));
  for (const entry of readdirSync(local, { withFileTypes: true })) {
    if (entry.name.startsWith("@") && entry.isDirectory()) {
      // A bare "@word" is a name the resource rule accepts, so a manifest
      // may name the package itself `@bare`: the staged copy IS the scope
      // directory, and a configured source naming it keeps it whole. A
      // source naming a child (`local/@scope/pkg`) keeps that child only --
      // its dead siblings are still collected below.
      if (inside.includes(entry.name)) continue;
      for (const child of readdirSync(join(local, entry.name))) {
        const path = join(local, entry.name, child);
        if (!kept(`${entry.name}${sep}${child}`)) remove(path, lstatSync(path).isDirectory());
      }
      if (readdirSync(join(local, entry.name)).length === 0) remove(join(local, entry.name), true);
    } else if (!kept(entry.name)) remove(join(local, entry.name), entry.isDirectory());
  }
}
