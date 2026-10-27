import { directoryNames, renameAt, symlinkAt, statAt, unlinkAt } from "@oma/native/posix-files";
/** CTX-004 / FS-002: staged directories and derived links have distinct owners.
 * The caller serializes publication in a trusted root and validates artifact
 * identity. These syscalls do not establish a new kernel no-replace guarantee.
 */
import { lstatSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute } from "node:path";
import { StoreError } from "@oma/domain/errors";
import { fsyncDir, fsyncHeldDir, fsyncTree, type TreeFlushPolicy } from "./durable-fs.js";
import { assertDirectory } from "./directory.js";
import { withinDirectory } from "@oma/native/files";

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
 * The explicit flush policy distinguishes context single-link entries from
 * legitimate workspace symlinks; it never enables following a link target.
 */
export function publishStagedDirectory(
  staging: string,
  destination: string,
  verify: (root: string) => void,
  policy: TreeFlushPolicy = "regular-files",
): "published" | "existing" {
  if (staging === destination) throw new StoreError("STORE_CORRUPT", "staging and destination must differ");
  assertDirectory(dirname(destination));
  const existing = (): "existing" => {
    requireDirectory(destination);
    verify(destination);
    fsyncTree(destination, policy);
    fsyncDir(dirname(destination));
    return "existing";
  };
  let present = true;
  try { withinDirectory(destination, (parent, name) => statAt(parent, name)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    present = false;
  }
  if (present) return existing();
  assertDirectory(dirname(staging));
  requireDirectory(staging);
  verify(staging);
  fsyncTree(staging, policy);
  // Both ends of the rename are addressed through descriptors this call holds.
  // Naming them by path again would mean the directory just verified and the
  // directory published into need not be the same one: at this UID a component
  // of either path can be replaced between the check and the rename, and the
  // accepted tree would land outside the state tree under a name the product
  // then reports as published.
  const moved = withinDirectory(staging, (from, fromName) =>
    withinDirectory(destination, (to, toName) => {
      try { renameAt(from, fromName, to, toName); }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EEXIST" && code !== "ENOTEMPTY") throw error;
        return false;
      }
      fsyncHeldDir(to, dirname(destination));
      if (dirname(staging) !== dirname(destination)) fsyncHeldDir(from, dirname(staging));
      return true;
    }));
  if (!moved) return existing();
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
  // Same rule as the derived file: the parent is resolved once and the link is
  // created, renamed and cleaned up through that descriptor only.
  withinDirectory(path, (parent, name) => {
    // P0V-111 (G01r2-02): a link cannot carry a lock, so the proof that a
    // leftover link temporary of this name is dead is who writes it: this
    // synchronous call is its only writer, and the caller serializes
    // publication in its root (above). What a killed one left is removed
    // before the next link is made; a file, or another name's, is not.
    for (const entry of directoryNames(parent)) {
      if (!entry.startsWith(`.${name}.`) || !/\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/.test(entry)) continue;
      try { if (statAt(parent, entry).isSymbolicLink()) unlinkAt(parent, entry); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    const temporaryName = `.${name}.${randomUUID()}.tmp`;
    symlinkAt(target, parent, temporaryName);
    let owned = true;
    try {
      renameAt(parent, temporaryName, parent, name); owned = false;
      fsyncHeldDir(parent, dirname(path));
    } finally {
      if (owned) {
        try { unlinkAt(parent, temporaryName); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        fsyncHeldDir(parent, dirname(path));
      }
    }
  });
}
