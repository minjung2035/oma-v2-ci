/** CTX-004 / FS-002: staged directories and derived links have distinct owners.
 * The caller serializes publication in a trusted root and validates artifact
 * identity. These syscalls do not establish a new kernel no-replace guarantee.
 */
import { lstatSync, renameSync, symlinkSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { StoreError } from "../domain/errors.js";
import { fsyncDir, fsyncTree } from "./durable-fs.js";

function requireDirectory(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new StoreError("STORE_CORRUPT", `non-directory staged tree: ${path}`);
}

/** Caller prepares/fsyncs file contents and verifies identity. The primitive
 * rechecks the tree, flushes it, then renames and flushes both affected parents.
 * An existing destination is verified, not merged, overwritten, or cleaned up.
 * On "existing" the staging tree remains caller-owned. On a post-rename error,
 * recovery must observe both names; the exception does not imply no publication.
 * Empty or raced destination handling is still bounded by the caller's trusted
 * serialized publication authority and the S-06 filesystem admission gate.
 */
export function publishStagedDirectory(
  staging: string,
  destination: string,
  verify: (root: string) => void,
): "published" | "existing" {
  requireDirectory(staging); verify(staging); fsyncTree(staging);
  try {
    lstatSync(destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    try { renameSync(staging, destination); }
    catch (renameError) {
      const code = (renameError as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "ENOTEMPTY") throw renameError;
      requireDirectory(destination); verify(destination); fsyncDir(dirname(destination));
      return "existing";
    }
    fsyncDir(dirname(destination));
    if (dirname(staging) !== dirname(destination)) fsyncDir(dirname(staging));
    return "published";
  }
  requireDirectory(destination); verify(destination); fsyncDir(dirname(destination));
  return "existing";
}

/** Mutable current link: create one owned link -> rename -> flush its parent.
 * Neither the link's target nor an old target is opened, traversed or removed.
 * Target identity/relative-path policy remains with the context owner.
 */
export function replaceDerivedSymlink(path: string, target: string): void {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  symlinkSync(target, temporary);
  let owned = true;
  try {
    renameSync(temporary, path); owned = false;
    fsyncDir(dirname(path));
  } finally {
    if (owned) { unlinkSync(temporary); fsyncDir(dirname(temporary)); }
  }
}
