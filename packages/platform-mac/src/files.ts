/** P0V-103 (F-02, F-08, G12 §4): how the Mac host makes a file durable under
 * a name -- the one owner of it, for the record, archives and snapshots.
 *
 * The Linux core's primitives resolve every name through a held directory
 * (openat2), which macOS does not have; the host's own files live in its
 * support directory, which only this user and the one `omahostd` (its
 * lock, `omahostd.lock`) write. The contract is the core's all the same:
 *
 * - a new name appears only whole: its bytes are written to a temporary in
 *   the same directory, flushed (F_FULLFSYNC, which Node's fsync is on
 *   macOS), linked to the name without replacing one, and the directory is
 *   flushed -- so a name that exists is a finished publication, and an
 *   interrupted one leaves a temporary, never a partial file under the name;
 * - a temporary is its writer's alone, and the only writer is the process
 *   holding the host lock: at start, the temporaries a dead writer left are
 *   removed (`collectTemporaries`).
 */
import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, constants, fsyncSync, linkSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, renameSync, rmdirSync, rmSync, unlinkSync, writeFileSync, writeSync,
  type Dirent, type Stats } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { assertHostDirectoryLayout } from "@oma/native/directory-layout";
import { StoreError } from "@oma/domain/errors";
import { withCleanup } from "@oma/native/cleanup";
import { lockFileDescriptor } from "@oma/native/linux";
import { disposeProjectPreparation, projectContentName, type ProjectPreparation } from "@oma/git/project-preparation";

/** Write every byte on the caller-owned descriptor. A zero-byte write is
 * an unconfirmed I/O failure, never completion and never an infinite retry. */
export function writeHostBytes(fd: number, bytes: Uint8Array): void {
  for (let at = 0; at < bytes.byteLength;) {
    const count = writeSync(fd, bytes, at, bytes.byteLength - at);
    if (!Number.isSafeInteger(count) || count <= 0 || count > bytes.byteLength - at)
      throw Object.assign(new Error("host file write made no progress"), { code: "EIO" });
    at += count;
  }
}

const TEMPORARY = /^\..+\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.partial$/;

export interface HostTemporary { readonly path: string; readonly fd: number; close(): void }

/** Private host metadata, outside a Society's state tree. Mutable files still
 * require their caller's writer lock; this does not grant a sandbox boundary. */
export function ensureHostUserDirectory(path: string): void {
  assertHostDirectoryLayout(path, true);
  let current = "/";
  for (const component of path.slice(1).split("/").filter(Boolean)) {
    current = join(current, component);
    try { mkdirSync(current, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    assertHostDirectoryLayout(current);
  }
  // A retry must flush names left visible by a failed earlier mkdir, too.
  for (let current = path; ; current = dirname(current)) {
    fsyncDirectory(current);
    if (dirname(current) === current) break;
  }
}

/** A temporary for `name` in `dir`, open for writing, made here and nowhere else. */
export function createTemporary(dir: string, name: string): HostTemporary {
  const path = temporaryPath(dir, name);
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  let closed = false;
  return { path, fd, close() { if (closed) return; closed = true; closeSync(fd); } };
}

/** A temporary's name for `name`, for a writer that makes the file itself
 * (a clone, which needs a name that does not exist yet). */
export function temporaryPath(dir: string, name: string): string {
  if (name.length === 0 || name.includes("/") || name.startsWith(".")) throw new StoreError("INTERNAL_ERROR", "a host file name is a plain name");
  return join(dir, `.${name}.${randomUUID()}.partial`);
}

export function fsyncDirectory(dir: string): void {
  const fd = openSync(dir, constants.O_RDONLY);
  withCleanup(() => fsyncSync(fd), () => closeSync(fd));
}

/** Publishes a written temporary as `name` without replacing one: "existing"
 * when the name is already there (the temporary is removed). The temporary's
 * descriptor is flushed and closed here. */
export function publishTemporary(temporary: HostTemporary, dir: string, name: string): "created" | "existing" {
  withCleanup(() => fsyncSync(temporary.fd), () => temporary.close());
  return linkInto(temporary.path, dir, name);
}

/** Publishes a temporary its maker wrote and closed (a clone): flushed here. */
export function publishMade(path: string, dir: string, name: string): "created" | "existing" {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  withCleanup(() => fsyncSync(fd), () => closeSync(fd));
  return linkInto(path, dir, name);
}

function linkInto(path: string, dir: string, name: string): "created" | "existing" {
  try { linkSync(path, join(dir, name)); }
  catch (error) {
    return withCleanup(() => {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return "existing" as const;
      throw error;
    }, () => rmSync(path, { force: true }));
  }
  unlinkSync(path);
  fsyncDirectory(dir);
  return "created";
}

/** Discards a temporary that will not be published. Its descriptor, if the
 * caller still holds it, is closed. */
export function discardTemporary(temporary: HostTemporary | string): void {
  withCleanup(() => { if (typeof temporary !== "string") temporary.close(); },
    () => rmSync(typeof temporary === "string" ? temporary : temporary.path, { force: true }));
}

/** Replaces the file at `path` whole (the host record, which is rewritten
 * in place): a temporary, flushed, renamed over it, the directory flushed. */
export function replaceFile(dir: string, name: string, bytes: string | Uint8Array): void {
  const temporary = createTemporary(dir, name);
  withCleanup(() => {
    withCleanup(() => {
      writeHostBytes(temporary.fd, typeof bytes === "string" ? Buffer.from(bytes) : bytes);
      fsyncSync(temporary.fd);
    }, () => temporary.close());
    renameSync(temporary.path, join(dir, name));
    fsyncDirectory(dir);
  }, () => discardTemporary(temporary));
}

/** The temporaries in `dir`: at start, under the host lock, they are a dead
 * writer's, and are removed. Answers their names. */
export function collectTemporaries(dir: string): string[] {
  const removed: string[] = [];
  for (const name of readdirSync(dir)) {
    if (!TEMPORARY.test(name)) continue;
    rmSync(join(dir, name), { force: true });
    removed.push(name);
  }
  return removed;
}

/** The owner-bits repair `removeOwnedPath` makes inside a tree, applied to
 * the components of `path` at or below `ownedFrom` -- the directories oma
 * itself made (its support directory, the store, `local/` and its scopes),
 * where a same-UID stray or an interrupted writer could have dropped the
 * bits an open, a listing or a mkdir beneath needs. And a file or a link
 * strictly below the boundary where a directory must be is a stray -- the
 * slot can hold nothing oma made beneath it -- so it is unlinked for what
 * it is, never followed. The components above `ownedFrom` are the user's
 * and are never touched -- and the boundary component itself is never
 * collected, since its parent is not oma's to write; one of them being
 * unreadable is a fact, not a wedge this repair may fix. */
export function repairHostOwnedPath(path: string, ownedFrom: string): void {
  // Component-wise, as the Linux twin's `componentsOf`: a `.`/`..` in either
  // spelling makes a path that textually starts with the boundary while
  // walking above it -- `oma/../victim` passed the lexical `startsWith` and
  // the walk then chmod'd the boundary's own parent, which is the user's,
  // never this product's.
  const split = (value: string): string[] => {
    if (!isAbsolute(value) || value.includes("\0"))
      throw new StoreError("INTERNAL_ERROR", "an owned path must be absolute");
    const components = value.slice(1).split("/").filter(Boolean);
    if (components.some(component => component === "." || component === ".."))
      throw new StoreError("INTERNAL_ERROR", "an owned path must be canonical");
    return components;
  };
  const components = split(path);
  const boundary = split(ownedFrom);
  if (boundary.length === 0 || boundary.length > components.length ||
      boundary.some((part, index) => components[index] !== part))
    throw new StoreError("INTERNAL_ERROR", "an owned path must be its boundary or beneath it");
  let current = "/";
  for (const [index, component] of components.entries()) {
    current = join(current, component);
    const observed = lstatSync(current, { throwIfNoEntry: false });
    if (observed === undefined) return;
    if (!observed.isDirectory()) {
      // A file or a link where an owned component must be a directory can
      // hold nothing oma made beneath it -- the same stray the staging
      // collection and the sweep answer for the store's slots. It is
      // unlinked as the entry it is, never followed -- but only strictly
      // below the boundary: the boundary component's own parent is the
      // user's, not oma's to write, so there the failure stands.
      if (index >= boundary.length) {
        try { unlinkSync(current); } catch { /* the ensured mkdir reports it */ }
      }
      return;
    }
    if (index >= boundary.length - 1 && (observed.mode & 0o700) !== 0o700)
      chmodSync(current, (observed.mode & 0o7777) | 0o700);
  }
}

/** `ensureHostUserDirectory` for a path whose tail oma owns: the owned
 * components' owner bits are put back before the layout walk needs them --
 * a mode-000 support directory or store cannot wedge the ensure. */
export function ensureHostOwnedDirectory(path: string, ownedFrom: string): void {
  repairHostOwnedPath(path, ownedFrom);
  ensureHostUserDirectory(path);
}

/** DR25 (C20): staging a local package for `oma pi install` on the Mac host.
 * The store sits in the app's own support directory, outside any society's
 * state tree, and the host lock serializes its writers -- the effects are
 * the Linux staging's, spelled by path. `ownedFrom` names the first
 * component of `parent` oma made, so the owned tail is repaired before the
 * mkdtemp needs its parent's bits. */
export function createHostStagingDirectory(parent: string, prefix: string, ownedFrom: string): string {
  repairHostOwnedPath(parent, ownedFrom);
  assertHostDirectoryLayout(parent, true);
  return mkdtempSync(join(parent, prefix));
}

/** `rel` is a directory beneath the staging root, its parents made too. */
export function makeHostStagedDirectories(root: string, rel: string): void {
  mkdirSync(join(root, rel), { recursive: true });
}

/** `bytes` is the file `rel` beneath the staging root, its parents made. */
export function writeHostStagedFile(root: string, rel: string, bytes: Buffer, mode: number): void {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes, { mode });
}

/** Removes a tree this owner wrote, by path. A directory whose mode lost its
 * owner read/write/search bits -- a stray or an interrupted writer -- gets
 * them back before it is listed or emptied, the same repair listHostStaged
 * makes (bits are added, never stripped: the special bits are kept), so a
 * mode-000 directory cannot wedge the removal the way rmSync's blind listing
 * did. Links and other non-directories are unlinked as the entries they are,
 * never followed. */
function removeOwnedPath(path: string): void {
  const observed = lstatSync(path, { throwIfNoEntry: false });
  if (observed === undefined) return;
  if (!observed.isDirectory()) { unlinkSync(path); return; }
  if ((observed.mode & 0o700) !== 0o700) chmodSync(path, (observed.mode & 0o7777) | 0o700);
  for (const name of readdirSync(path)) removeOwnedPath(join(path, name));
  rmdirSync(path);
}

/** The first entry the staged `name`'s path needs beneath `dir` -- `dir`
 * itself first, then each strict-prefix slot -- that is present and not a
 * directory is the stray the publish's ensure wedged on: a file, a link,
 * anything a copy cannot sit beneath. It is removed for what it is, as the
 * sweep does (a link is unlinked, never followed); false when there is no
 * such stray, so the publish's own failure stands. */
function collectHostStageStray(dir: string, name: string): boolean {
  let current = dir;
  for (const part of ["", ...name.split("/").slice(0, -1)]) {
    if (part !== "") current = join(current, part);
    const observed = (() => {
      try { return lstatSync(current, { throwIfNoEntry: false }); } catch { return undefined; }
    })();
    if (observed === undefined) return false;
    if (!observed.isDirectory()) {
      try { removeOwnedPath(current); } catch { return false; }
      return true;
    }
  }
  return false;
}

/** `fsyncFile` spelled by path, the way this owner spells everything on a
 * host without openat2: the renamed staged file's own bytes flushed. */
function fsyncStagedFile(path: string): void {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  withCleanup(() => fsyncSync(fd), () => closeSync(fd));
}

/** `fsyncTree`'s regular-files policy spelled by path: every regular file of
 * the arrived tree is flushed and every directory that names one is flushed
 * -- the staged copy's bytes and the names that reach them must outlive a
 * crash the way the index naming them does, the same durability the Linux
 * publish gives the renamed name. Anything else in the tree is the
 * corruption the held walk's regular-file pin refuses, never followed. */
function fsyncStagedTree(dir: string): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const observed = lstatSync(path);
    if (observed.isDirectory()) { fsyncStagedTree(path); continue; }
    if (!observed.isFile()) throw new StoreError("STORE_CORRUPT", `a staged tree holds an entry that is not a file or a directory: ${path}`);
    fsyncStagedFile(path);
  }
  fsyncDirectory(dir);
}

/** `made` becomes `<dir>/<name>` whole: a dead copy goes first, the rename
 * lands the new one, the directory is flushed. `ownedFrom` bounds the
 * owner-bits repair the destination's ancestors get -- a mode-000 `local`
 * or scope directory cannot wedge the lstat and mkdir the publish needs. A
 * stray non-directory in `local/` or in the staged name's strict-prefix
 * slots fails the owned ensure (ENOTDIR, or the layout refusal) -- and the
 * sweep that collects it only runs after a successful change, so the
 * install wedged on every retry until an unrelated `oma pi` mutation.
 * The blocking entry is collected here, once, the way the sweep collects
 * it. */
export function publishHostStaged(made: string, dir: string, name: string, ownedFrom: string): void {
  const dest = join(dir, name);
  try { ensureHostOwnedDirectory(dirname(dest), ownedFrom); }
  catch (error) {
    if (!collectHostStageStray(dir, name)) throw error;
    ensureHostOwnedDirectory(dirname(dest), ownedFrom);
  }
  removeOwnedPath(dest);
  renameSync(made, dest);
  // The staged copy's own bytes are renamed, never rewritten on this side
  // of the name: nothing else flushed them, so a crash here could keep
  // `dest`'s dirent while losing the file contents the index goes on to
  // name -- the window the Linux publish's fsyncTree closes. Every regular
  // file of the arrived tree and every directory that names one is flushed,
  // then the parent that holds the name, then the name's old home in the
  // staging root -- the order the held-descriptor publish keeps.
  const arrived = lstatSync(dest);
  if (arrived.isDirectory()) fsyncStagedTree(dest);
  else if (arrived.isFile()) fsyncStagedFile(dest);
  else throw new StoreError("STORE_CORRUPT", `the published stage is not a file or a directory: ${dest}`);
  fsyncDirectory(dirname(dest));
  fsyncDirectory(dirname(made));
}

/** A staging root given back unpublished, or a dead copy being pruned. */
export function removeHostStaged(path: string): void {
  removeOwnedPath(path);
}

/** The entries of one host store directory a prune is sweeping, or null
 * when it cannot be listed -- absent, another entry type, or unreadable
 * even after its owner read/write/search bits are put back (the repair
 * adds bits where a stray dropped them, never strips). By path, like the
 * rest of this owner: the Mac store is in the app's own support
 * directory, outside any society's state tree. */
export function listHostStaged(dir: string): Dirent[] | null {
  try {
    const observed = lstatSync(dir);
    if (!observed.isDirectory()) return null;
    if ((observed.mode & 0o700) !== 0o700) chmodSync(dir, (observed.mode & 0o7777) | 0o700);
    return readdirSync(dir, { withFileTypes: true });
  } catch { return null; }
}

/** The same repair for one staged-store entry that is only being observed,
 * by path like the rest of this owner: a directory gets its owner
 * read/write/search bits, a regular file its owner read/write bits --
 * added only, never stripped, the special bits kept. Answers the entry's
 * stat, or null when it cannot be observed or repaired. */
export function repairHostStagedEntryMode(path: string): Stats | null {
  try {
    const observed = lstatSync(path);
    const need = observed.isDirectory() ? 0o700 : observed.isFile() ? 0o600 : 0;
    if (need !== 0 && (observed.mode & need) !== need)
      chmodSync(path, (observed.mode & 0o7777) | need);
    return observed;
  } catch { return null; }
}

/** DR27: a private snapshot tree in the host's transfer directory, never a
 * society state tree. The host lock owns this namespace. The inherited flock
 * additionally prevents cleanup while an orphaned Git child still writes. */
export function prepareHostProjectDirectory(path: string): ProjectPreparation {
  const leasePath = `${path}.lease`;
  const descriptor = openSync(leasePath, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  let closed = false;
  const release = (): void => { if (!closed) { closed = true; closeSync(descriptor); } };
  const collect = (): void => {
    const check = openSync(leasePath, constants.O_RDWR | constants.O_NOFOLLOW);
    withCleanup(() => {
      if (lockFileDescriptor(check).kind === "held") {
        removeOwnedPath(path);
        unlinkSync(leasePath);
      }
    }, () => closeSync(check));
  };
  let made = false;
  try {
    if (lockFileDescriptor(descriptor).kind !== "held")
      throw new StoreError("BROKER_UNAVAILABLE", "snapshot preparation could not hold its lease");
    mkdirSync(path, { mode: 0o700 }); made = true;
    return { path, descriptor,
      openContent: (index = 0) => openSync(join(path, projectContentName(index)), constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600),
      dispose() { disposeProjectPreparation(release, collect); },
    };
  } catch (error) {
    try { disposeProjectPreparation(release, () => { if (made) collect(); else unlinkSync(leasePath); }); }
    catch (cleanup) { throw new AggregateError([error, cleanup], "host snapshot preparation and cleanup failed"); }
    throw error;
  }
}
