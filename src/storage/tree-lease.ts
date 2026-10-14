/** R6-04 (P0-4, P0-5): a tree a native child works in carries a proof of
 * that child's death.
 *
 * Before a tree is made, a lease file beside it (`<tree>.lease`) is opened
 * through its held parent and flock'ed. Every child that works in the tree is
 * handed that descriptor. flock belongs to the open file description, which
 * the children share, so the lock is free only when this process and every
 * child are gone -- whatever killed them, SIGKILL and a power cut included.
 * Whoever finds the tree later (startup recovery, the next provision) tries
 * the lock: free is the proof the tree's makers are all dead, so it and its
 * lease are removed; held is a maker still alive, so both are kept. A tree
 * with no lease was made before leases existed (or crashed in the instant
 * before its lease): nothing proves anything about it, and it is kept as
 * before.
 */
import { closeSync, constants } from "node:fs";
import { lockFileDescriptor } from "../leaf.js";
import { StoreError } from "../domain/errors.js";
import { openBeneath, withinDirectory } from "./contained-fs.js";
import { removeOwnedFile, removeOwnedTree } from "./directory.js";

export function leasePathOf(tree: string): string { return `${tree}.lease`; }

function openLease(tree: string, create: boolean, exclusive = false): number {
  return withinDirectory(leasePathOf(tree), (parent, name) =>
    // openat2 refuses a mode without O_CREAT.
    create ? openBeneath(parent, name, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_CREAT | (exclusive ? constants.O_EXCL : 0), 0o600)
      : openBeneath(parent, name, constants.O_RDWR | constants.O_NOFOLLOW));
}

export class TreeLease {
  private closed = false;
  private constructor(private readonly fd: number, readonly tree: string) {}

  /** Taken before the tree is made or worked in by a child. A lease another
   * process still holds is a tree someone is still working in. */
  static take(tree: string, exclusive = false): TreeLease {
    const fd = openLease(tree, true, exclusive);
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

/** Whether everything that worked in a leased tree is dead, as the lock says. */
export function treeQuiescence(tree: string): TreeQuiescence {
  let fd: number;
  try { fd = openLease(tree, false); }
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

/** Removes a leased tree and then its lease, holding the lock throughout, if
 * and only if everything that worked in it is dead. Answers what it found. */
export function collectLeasedTree(tree: string): TreeQuiescence {
  let fd: number;
  try { fd = openLease(tree, false); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "unknown", reason: "it has no lease: made before leases existed, or before its lease" };
    return { kind: "unknown", reason: "its lease could not be opened" };
  }
  try {
    const lock = lockFileDescriptor(fd);
    if (lock.kind === "contended") return { kind: "active" };
    if (lock.kind === "failed") return { kind: "unknown", reason: "its lease could not be evaluated" };
    removeOwnedTree(tree);
    removeOwnedFile(leasePathOf(tree));
    return { kind: "quiescent" };
  } finally { closeSync(fd); }
}

