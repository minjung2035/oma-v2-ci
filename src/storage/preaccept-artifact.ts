/** Pre-accept artifact ownership.
 *
 * An immutable artifact published before its acceptance transaction belongs to
 * nobody until that transaction commits. A transaction loser, a rejected
 * request, or a plan that names no artifact must remove exactly the inode this
 * call published, and nothing else. `PreparedSubmitSpool` is the same state
 * machine over a bundle name, so both answer to `PreacceptOwner` and every
 * coordinator settles them through one question.
 */
import { closeSync, fstatSync, fsyncSync, unlinkSync } from "node:fs";
import { basename, dirname } from "node:path";
import { StoreError } from "../domain/errors.js";
import { entryAt, openDirectory, openRegularBeneath } from "./contained-fs.js";

export interface PreacceptOwner {
  /** Called on durable acceptance or uncertainty about whether T committed. */
  retainForOperation(): void;
  /** The caller must first establish that nothing accepted owns this artifact. */
  discardUnaccepted(): void;
}

export interface PublishedIdentity {
  readonly dev: number;
  readonly ino: number;
}

/** Observe the inode a publication put at this name. An unobservable name
 * yields no identity, and an artifact with no identity is never removed.
 */
export function observePublishedIdentity(path: string): PublishedIdentity | null {
  let parent: number | undefined;
  try {
    parent = openDirectory(dirname(path));
    const fd = openRegularBeneath(parent, basename(path));
    try {
      const stat = fstatSync(fd);
      return stat.isFile() ? { dev: stat.dev, ino: stat.ino } : null;
    } finally { closeSync(fd); }
  } catch { return null; }
  finally { if (parent !== undefined) closeSync(parent); }
}

/** Unlink a name only while it still resolves to the inode we published.
 * A replaced or removed name is left alone: absence is already the goal, and a
 * different inode is somebody else's artifact.
 */
function removeOwnedInode(path: string, identity: PublishedIdentity): void {
  const parent = openDirectory(dirname(path));
  try {
    let fd: number;
    try { fd = openRegularBeneath(parent, basename(path)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.dev !== identity.dev || stat.ino !== identity.ino) return;
    } finally { closeSync(fd); }
    try { unlinkSync(entryAt(parent, basename(path))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    fsyncSync(parent);
  } finally { closeSync(parent); }
}

export class PreacceptArtifact implements PreacceptOwner {
  private owner: "preaccept" | "accepted" | "released" = "preaccept";
  constructor(readonly path: string, private readonly identity: PublishedIdentity | null) {}
  retainForOperation(): void {
    if (this.owner === "released")
      throw new StoreError("INTERNAL_ERROR", "released artifact cannot become accepted evidence");
    this.owner = "accepted";
  }
  discardUnaccepted(): void {
    if (this.owner !== "preaccept") return;
    this.owner = "released";
    if (this.identity !== null) removeOwnedInode(this.path, this.identity);
  }
}

/** The artifact a publication just put at this name, owned by nobody yet. */
export function publishedArtifact(path: string): PreacceptArtifact {
  return new PreacceptArtifact(path, observePublishedIdentity(path));
}

/** The common pre-accept question: did the journal accept the operation that
 * would own these artifacts? A journal that cannot be read is not evidence of
 * non-acceptance, so uncertainty retains.
 */
export function settleByAcceptance(
  owners: readonly (PreacceptOwner | null)[],
  accepted: () => boolean,
): void {
  let outcome: boolean | null = null;
  try { outcome = accepted(); } catch { /* DB uncertainty cannot authorize deletion. */ }
  for (const owner of owners) {
    if (owner === null) continue;
    if (outcome === false) owner.discardUnaccepted(); else owner.retainForOperation();
  }
}
