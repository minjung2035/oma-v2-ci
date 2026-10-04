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
import { closeSync, constants, fsyncSync, linkSync, mkdirSync, mkdtempSync, openSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertHostDirectoryLayout } from "../../runtime/assets.js";
import { StoreError } from "../../domain/errors.js";
import { withCleanup } from "../../process/cleanup.js";
import { lockFileDescriptor } from "../../leaf.js";
import { disposeProjectPreparation, type ProjectPreparation } from "../../storage/project-preparation.js";

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
      for (let at = 0, data = typeof bytes === "string" ? Buffer.from(bytes) : bytes; at < data.length;) at += writeSync(temporary.fd, data, at, data.length - at);
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

/** DR25 (C20): staging a local package for `oma pi install` on the Mac host.
 * The store sits in the app's own support directory, outside any society's
 * state tree, and the host lock serializes its writers -- the effects are
 * the Linux staging's, spelled by path. */
export function createHostStagingDirectory(parent: string, prefix: string): string {
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

/** `made` becomes `<dir>/<name>` whole: a dead copy goes first, the rename
 * lands the new one, the directory is flushed. */
export function publishHostStaged(made: string, dir: string, name: string): void {
  const dest = join(dir, name);
  ensureHostUserDirectory(dirname(dest));
  rmSync(dest, { recursive: true, force: true });
  renameSync(made, dest);
  fsyncDirectory(dirname(dest));
}

/** A staging root given back unpublished, or a dead copy being pruned. */
export function removeHostStaged(path: string): void {
  rmSync(path, { recursive: true, force: true });
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
        rmSync(path, { recursive: true, force: true });
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
      openContent: () => openSync(join(path, "content"), constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600),
      dispose() { disposeProjectPreparation(release, collect); },
    };
  } catch (error) {
    try { disposeProjectPreparation(release, () => { if (made) collect(); else unlinkSync(leasePath); }); }
    catch (cleanup) { throw new AggregateError([error, cleanup], "host snapshot preparation and cleanup failed"); }
    throw error;
  }
}
