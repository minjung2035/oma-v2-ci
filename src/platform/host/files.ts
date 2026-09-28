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
import { closeSync, constants, fsyncSync, linkSync, openSync, readdirSync, renameSync, rmSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { StoreError } from "../../domain/errors.js";

const TEMPORARY = /^\..+\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.partial$/;

export interface HostTemporary { readonly path: string; readonly fd: number }

/** A temporary for `name` in `dir`, open for writing, made here and nowhere else. */
export function createTemporary(dir: string, name: string): HostTemporary {
  const path = temporaryPath(dir, name);
  return { path, fd: openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600) };
}

/** A temporary's name for `name`, for a writer that makes the file itself
 * (a clone, which needs a name that does not exist yet). */
export function temporaryPath(dir: string, name: string): string {
  if (name.length === 0 || name.includes("/") || name.startsWith(".")) throw new StoreError("INTERNAL_ERROR", "a host file name is a plain name");
  return join(dir, `.${name}.${randomUUID()}.partial`);
}

export function fsyncDirectory(dir: string): void {
  const fd = openSync(dir, constants.O_RDONLY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

/** Publishes a written temporary as `name` without replacing one: "existing"
 * when the name is already there (the temporary is removed). The temporary's
 * descriptor is flushed and closed here. */
export function publishTemporary(temporary: HostTemporary, dir: string, name: string): "created" | "existing" {
  try { fsyncSync(temporary.fd); } finally { closeSync(temporary.fd); }
  return linkInto(temporary.path, dir, name);
}

/** Publishes a temporary its maker wrote and closed (a clone): flushed here. */
export function publishMade(path: string, dir: string, name: string): "created" | "existing" {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
  return linkInto(path, dir, name);
}

function linkInto(path: string, dir: string, name: string): "created" | "existing" {
  try { linkSync(path, join(dir, name)); }
  catch (error) {
    rmSync(path, { force: true });
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return "existing";
    throw error;
  }
  unlinkSync(path);
  fsyncDirectory(dir);
  return "created";
}

/** Discards a temporary that will not be published. Its descriptor, if the
 * caller still holds it, is closed. */
export function discardTemporary(temporary: HostTemporary | string): void {
  if (typeof temporary !== "string") { try { closeSync(temporary.fd); } catch { /* already closed */ } }
  rmSync(typeof temporary === "string" ? temporary : temporary.path, { force: true });
}

/** Replaces the file at `path` whole (the host record, which is rewritten
 * in place): a temporary, flushed, renamed over it, the directory flushed. */
export function replaceFile(dir: string, name: string, bytes: string | Uint8Array): void {
  const temporary = createTemporary(dir, name);
  try {
    for (let at = 0, data = typeof bytes === "string" ? Buffer.from(bytes) : bytes; at < data.length;) at += writeSync(temporary.fd, data, at, data.length - at);
    fsyncSync(temporary.fd);
  } catch (error) { discardTemporary(temporary); throw error; }
  closeSync(temporary.fd);
  renameSync(temporary.path, join(dir, name));
  fsyncDirectory(dir);
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
