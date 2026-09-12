/** FS-001..003: syscall ordering, not artifact authority or S-06 evidence.
 * Immutable publication and derived replacement are deliberately separate APIs.
 * These helpers neither modify a ledger nor collect accepted recovery evidence.
 */
import {
  constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readdirSync, renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { StoreError } from "../domain/errors.js";

export function fsyncDir(directory: string): void {
  const fd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

export function fsyncFile(path: string): void {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!fstatSync(fd).isFile()) throw new StoreError("STORE_CORRUPT", `non-regular file: ${path}`);
    fsyncSync(fd);
  } finally { closeSync(fd); }
}

/** The caller owns the unique staging name after success, including its later
 * unlink and parent flush. A partial write is not an accepted immutable object.
 */
export function writeExclusiveFsyncedFile(path: string, bytes: string | Uint8Array, mode = 0o600): void {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
}

/** Derived-only replacement: exclusive temporary -> file fsync -> rename ->
 * parent fsync. This function owns only its random temporary, never a glob or
 * an accepted source. A post-rename flush failure does not prove no replacement.
 */
export function replaceDerivedFile(target: string, bytes: string | Uint8Array, mode = 0o600): void {
  mkdirSync(dirname(target), { recursive: true });
  const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
  let created = false;
  let renamed = false;
  const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
  created = true;
  try {
    try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, target); renamed = true;
    fsyncDir(dirname(target));
  } finally {
    if (created && !renamed) {
      unlinkSync(temporary);
      fsyncDir(dirname(temporary));
    }
  }
}

/** Only a caller-validated tree is admitted. Symlinks, devices and FIFOs are
 * rejected rather than recursively followed; current links need only their
 * own parent's flush. Mail hardlinks remain legal; context adds nlink=1 itself.
 * Parent path checks are observations, not a kernel containment proof.
 */
export function fsyncTree(root: string): void {
  const stat = lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new StoreError("STORE_CORRUPT", `invalid fsync tree root: ${root}`);
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const entry = lstatSync(path);
    if (entry.isDirectory() && !entry.isSymbolicLink()) fsyncTree(path);
    else if (entry.isFile() && !entry.isSymbolicLink()) fsyncFile(path);
    else throw new StoreError("STORE_CORRUPT", `unsupported fsync tree entry: ${path}`);
  }
  fsyncDir(root);
}
