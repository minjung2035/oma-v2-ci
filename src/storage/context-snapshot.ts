/** CTX-004 / FS-002: revision bytes first, derived current link last.
 * Only a new publication's unique temporary tree is cleaned here. The accepted
 * source/commit-work and an existing revision are never removed or regenerated.
 * Context files use fixed 0644; mail's immutable-file 0444 policy is separate.
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

/** Complete permitted tree verification; no writes or silent byte repair.
 * Mode validation is explicit because a new temporary has not been sealed yet.
 */
export function verifyContextRevision(root: string, entries: readonly ContextEntry[], fixedModes = false): void {
  const invalid = contextEntriesCheck(entries, { requireSorted: true });
  if (invalid) throw new StoreError("STORE_CORRUPT", invalid);
  assertContextDirectory(root);
  if (fixedModes && (lstatSync(root).mode & 0o777) !== 0o555) throw new StoreError("STORE_CORRUPT", "context revision directory mode differs");
  const expected = new Set(entries.map(entry => entry.path));
  const walk = (directory: string, relative = ""): void => {
    assertContextDirectory(directory);
    for (const name of readdirSync(directory)) {
      const path = relative ? `${relative}/${name}` : name;
      const absolute = join(directory, name);
      const stat = lstatSync(absolute);
      if (stat.isDirectory() && path === "decisions" && entries.some(entry => entry.path.startsWith("decisions/"))) {
        if (fixedModes && (stat.mode & 0o777) !== 0o555) throw new StoreError("STORE_CORRUPT", "context decisions directory mode differs");
        walk(absolute, path);
      } else if (!stat.isFile() || stat.nlink !== 1 || !expected.has(path) || (fixedModes && (stat.mode & 0o777) !== 0o644)) {
        throw new StoreError("STORE_CORRUPT", `unexpected context entry or mode ${path}`);
      }
    }
  };
  walk(root);
  for (const entry of entries) readContextEntry(root, entry);
}
function sealRevision(root: string, entries: readonly ContextEntry[]): void {
  verifyContextRevision(root, entries);
  // View metadata can be re-applied only after exact existing bytes are verified.
  for (const entry of entries) chmodSync(join(root, entry.path), 0o644);
  if (entries.some(entry => entry.path.startsWith("decisions/"))) chmodSync(join(root, "decisions"), 0o555);
  chmodSync(root, 0o555);
  fsyncTree(root, "context-single-link");
  verifyContextRevision(root, entries, true);
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

/** Mechanism only. The context coordinator must validate the accepted plan and
 * fresh canonical-ref evidence before calling this trusted-root materializer.
 */
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
        writeExclusiveFsyncedFile(target, bytes, 0o644);
      }
      sealRevision(temporary, entries);
      publishStagedDirectory(temporary, destination, root => verifyContextRevision(root, entries, true), "context-single-link");
    } finally { cleanupOwnedTree(temporary); }
  }
  sealRevision(destination, entries);
  replaceDerivedSymlink(join(worldDir, "context", "current"), contextRevisionLinkFor(candidate));
}
