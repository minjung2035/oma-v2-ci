/** CTX-004 / FS-002: staged directories and derived links have distinct owners.
 * The caller serializes publication in a trusted root and validates artifact
 * identity. These syscalls do not establish a new kernel no-replace guarantee.
 */
import { lstatSync, renameSync, symlinkSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join } from "node:path";
import { StoreError } from "../domain/errors.js";
import { fsyncDir, fsyncTree } from "./durable-fs.js";
import { assertDirectory } from "./directory.js";

function requireDirectory(path: string): void {
  assertDirectory(path);
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new StoreError("STORE_CORRUPT", `non-directory staged tree: ${path}`);
}

/** Caller prepares file contents and proves artifact identity. An existing
 * destination is verified and flushed first: staging and its parent may already
 * be gone after an earlier successful rename. ENOENT from verification is damage,
 * NOT proof that the destination is absent. Nothing here merges or removes either
 * tree. On "existing" any surviving staging remains caller-owned. A post-rename
 * error is ambiguous, never permission to overwrite an observed destination.
 * Empty/raced destination handling remains bounded by the caller's trusted
 * serialized publication authority and the S-06 filesystem admission gate.
 */
export function publishStagedDirectory(
  staging: string,
  destination: string,
  verify: (root: string) => void,
): "published" | "existing" {
  if (staging === destination) throw new StoreError("STORE_CORRUPT", "staging and destination must differ");
  assertDirectory(dirname(destination));
  const existing = (): "existing" => {
    requireDirectory(destination);
    verify(destination);
    fsyncTree(destination);
    fsyncDir(dirname(destination));
    return "existing";
  };
  let present = true;
  try { lstatSync(destination); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    present = false;
  }
  if (present) return existing();
  assertDirectory(dirname(staging));
  requireDirectory(staging);
  verify(staging);
  fsyncTree(staging);
  try { renameSync(staging, destination); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST" && code !== "ENOTEMPTY") throw error;
    return existing();
  }
  fsyncDir(dirname(destination));
  if (dirname(staging) !== dirname(destination)) fsyncDir(dirname(staging));
  requireDirectory(destination);
  verify(destination);
  return "published";
}

/** Mutable current link: one owned link -> rename -> parent fsync. No target
 * is opened or recursively flushed. Context retains revision identity policy;
 * this primitive additionally rejects lexical escape in the relative target.
 */
export function replaceDerivedSymlink(path: string, target: string): void {
  assertDirectory(dirname(path));
  if (isAbsolute(target) || target.includes("\0") || target.split("/").some(part => part === "" || part === "." || part === ".."))
    throw new StoreError("STORE_CORRUPT", "derived link target must remain relative and contained");
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  symlinkSync(target, temporary);
  let owned = true;
  try {
    renameSync(temporary, path); owned = false;
    fsyncDir(dirname(path));
  } finally {
    if (owned) {
      try { unlinkSync(temporary); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      fsyncDir(dirname(temporary));
    }
  }
}
