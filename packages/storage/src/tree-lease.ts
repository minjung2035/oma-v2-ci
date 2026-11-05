/** R6-04 (P0-4, P0-5): a lease retains cooperating users of disposable staging.
 * It is acquired before the tree exists and inherited as an open-file-
 * description lock. Every retained copy keeps collection blocked, including
 * across parent death. A descendant can close the FD while remaining alive:
 * a free lock alone never proves arbitrary-descendant death. Owners of
 * untrusted execution must independently confirm the complete scope is dead
 * before collection/reuse. An absent or unobservable lease remains unknown.
 */
import { closeSync, constants, fsyncSync } from "node:fs";
import { basename } from "node:path";
import { unlinkAt } from "@oma/file-descriptors";
import { lockFileDescriptor } from "@oma/native/linux";
import { StoreError } from "@oma/domain/errors";
import { openBeneath, withinDirectory } from "@oma/native/files";
import { removeOwnedFile, removeOwnedTree, removeOwnedTreeAt } from "./directory.js";

export function leasePathOf(tree: string): string { return `${tree}.lease`; }

/** Trusted composition's borrowed parent cursor; never a model field. */
export interface TreeDirectoryControl { readonly directoryFd?: number }
function openLease(tree: string, create: boolean, exclusive = false, control: TreeDirectoryControl = {}): number {
  const open = (parent: number, name: string) =>
    // openat2 refuses a mode without O_CREAT.
    create ? openBeneath(parent, name, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_CREAT | (exclusive ? constants.O_EXCL : 0), 0o600)
      : openBeneath(parent, name, constants.O_RDWR | constants.O_NOFOLLOW);
  return control.directoryFd === undefined ? withinDirectory(leasePathOf(tree), open)
    : open(control.directoryFd, basename(leasePathOf(tree)));
}

export class TreeLease {
  private closed = false;
  private constructor(private readonly fd: number, readonly tree: string) {}

  /** Taken before the tree is made or worked in by a child. A lease another
   * process still holds is a tree someone is still working in. */
  static take(tree: string, exclusive = false, control: TreeDirectoryControl = {}): TreeLease {
    const fd = openLease(tree, true, exclusive, control);
    const lock = lockFileDescriptor(fd);
    if (lock.kind === "held") return new TreeLease(fd, tree);
    closeSync(fd);
    if (lock.kind === "contended") throw new StoreError("REF_STATE_UNKNOWN", "a native preparation is still working in this tree");
    throw new StoreError("BROKER_UNAVAILABLE", `a preparation lease could not be evaluated (errno ${lock.errno})`);
  }

  /** The descriptor every child working in the tree inherits. */
  get descriptor(): number {
    if (this.closed) throw new StoreError("INTERNAL_ERROR", "the preparation lease is released");
    return this.fd;
  }

  /** This process's hold ends; children still holding it keep the lock. */
  release(): void {
    if (this.closed) return;
    this.closed = true;
    closeSync(this.fd);
  }
}

export type TreeQuiescence =
  | { readonly kind: "quiescent" }
  | { readonly kind: "active" }
  | { readonly kind: "unknown"; readonly reason: string };

/** Lock observation only; execution scope death belongs to its own owner. */
export function treeQuiescence(tree: string, control: TreeDirectoryControl = {}): TreeQuiescence {
  let fd: number;
  try { fd = openLease(tree, false, false, control); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "unknown", reason: "it has no lease: made before leases existed, or before its lease" };
    return { kind: "unknown", reason: "its lease could not be opened" };
  }
  try {
    const lock = lockFileDescriptor(fd);
    if (lock.kind === "held") return { kind: "quiescent" };
    return lock.kind === "contended" ? { kind: "active" } : { kind: "unknown", reason: "its lease could not be evaluated" };
  } finally { closeSync(fd); }
}

/** Removes a tree while holding its uncontended lease. The caller must first
 * establish any required independent execution-scope death. */
export function collectLeasedTree(tree: string, control: TreeDirectoryControl = {}): TreeQuiescence {
  let fd: number;
  try { fd = openLease(tree, false, false, control); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "unknown", reason: "it has no lease: made before leases existed, or before its lease" };
    return { kind: "unknown", reason: "its lease could not be opened" };
  }
  try {
    const lock = lockFileDescriptor(fd);
    if (lock.kind === "contended") return { kind: "active" };
    if (lock.kind === "failed") return { kind: "unknown", reason: "its lease could not be evaluated" };
    if (control.directoryFd === undefined) {
      removeOwnedTree(tree); removeOwnedFile(leasePathOf(tree));
    } else {
      removeOwnedTreeAt(control.directoryFd, basename(tree));
      try { unlinkAt(control.directoryFd, basename(leasePathOf(tree))); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      fsyncSync(control.directoryFd);
    }
    return { kind: "quiescent" };
  } finally { closeSync(fd); }
}

