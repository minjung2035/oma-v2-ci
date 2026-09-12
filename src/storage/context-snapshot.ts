/** CTX-004 / FS-002: immutable revision bytes first, derived current link last.
 * Only a new publication's unique temporary tree is cleaned here. The accepted
 * source/commit-work and an existing revision are never removed or regenerated.
 * Publication requires the broker's existing serialized trusted-root authority;
 * these helpers do not manufacture a cross-process no-replace or S-06 proof.
 */
import { chmodSync, lstatSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ContextEntry } from "../../implementation/contracts.js";
import { generateOperationId, isValidFullOid } from "../ids.js";
import { contextRevisionLinkFor } from "../domain/derived.js";
import { contextEntriesCheck } from "../domain/context-policy.js";
import { StoreError } from "../domain/errors.js";
import { contextRevisionPathAt } from "./paths.js";
import { assertContextDirectory, readContextEntry } from "./context-files.js";
import { ensureDurableDirectory, fsyncDir, fsyncTree, writeExclusiveFsyncedFile } from "./durable-fs.js";
import { publishStagedDirectory, replaceDerivedSymlink } from "./staged-tree.js";

/** Verify the complete permitted tree, not merely every advertised filename.
 * Extra entries, special files, links and a mismatched immutable byte are damage.
 */
function verifyRevision(root: string, entries: readonly ContextEntry[]): void {
  assertContextDirectory(root);
  const expected = new Set(entries.map(entry => entry.path));
  const walk = (directory: string, relative = ""): void => {
    for (const name of readdirSync(directory)) {
      const path = relative ? `${relative}/${name}` : name;
      const absolute = join(directory, name);
      const stat = lstatSync(absolute);
      if (stat.isDirectory() && path === "decisions" && entries.some(entry => entry.path.startsWith("decisions/")))
        walk(absolute, path);
      else if (!stat.isFile() || stat.nlink !== 1 || !expected.has(path))
        throw new StoreError("STORE_CORRUPT", `unexpected context entry ${path}`);
    }
  };
  walk(root);
  for (const entry of entries) readContextEntry(root, entry);
}
function sealRevision(root: string, entries: readonly ContextEntry[]): void {
  verifyRevision(root, entries);
  for (const entry of entries) chmodSync(join(root, entry.path), 0o444);
  if (entries.some(entry => entry.path.startsWith("decisions/"))) chmodSync(join(root, "decisions"), 0o555);
  chmodSync(root, 0o555);
  fsyncTree(root, "context-single-link");
}
function cleanupOwnedTree(temporary: string): void {
  const stat = lstatSync(temporary, { throwIfNoEntry: false });
  if (!stat) return;
  if (!stat.isDirectory()) throw new StoreError("STORE_CORRUPT", "owned context temporary changed type");
  assertContextDirectory(temporary);
  chmodSync(temporary, 0o700);
  const decisions = join(temporary, "decisions");
  const child = lstatSync(decisions, { throwIfNoEntry: false });
  if (child) {
    if (!child.isDirectory()) throw new StoreError("STORE_CORRUPT", "owned context temporary child changed type");
    chmodSync(decisions, 0o700);
  }
  rmSync(temporary, { recursive: true });
  fsyncDir(dirname(temporary));
}

export function publishContextRevision(
  worldDir: string, candidate: string, entries: readonly ContextEntry[], source: string,
): void {
  const invalid = contextEntriesCheck(entries, { requireSorted: true });
  if (invalid || !isValidFullOid(candidate)) throw new StoreError("STORE_CORRUPT", invalid ?? "invalid context revision");
  assertContextDirectory(source);
  const revisions = join(worldDir, "context", "revisions");
  ensureDurableDirectory(revisions);
  const destination = contextRevisionPathAt(worldDir, candidate);
  if (!lstatSync(destination, { throwIfNoEntry: false })) {
    const temporary = join(revisions, `.prepare-${candidate}-${generateOperationId()}`);
    ensureDurableDirectory(temporary);
    try {
      for (const entry of entries) {
        const bytes = readContextEntry(source, entry);
        const target = join(temporary, entry.path);
        ensureDurableDirectory(dirname(target));
        writeExclusiveFsyncedFile(target, bytes, 0o444);
      }
      sealRevision(temporary, entries);
      publishStagedDirectory(temporary, destination, root => verifyRevision(root, entries), "context-single-link");
    } finally { cleanupOwnedTree(temporary); }
  }
  sealRevision(destination, entries);
  // Pointer fsync does not traverse or flush an arbitrary symlink target.
  replaceDerivedSymlink(join(worldDir, "context", "current"), contextRevisionLinkFor(candidate));
}
