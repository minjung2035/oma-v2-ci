/** TUI-004/REC-007: which `oma` owns a society, and what must be dead before
 * another one may have it.
 *
 * Ownership used to be a fact about a child process: the broker took a lock on
 * the society's run root, said it was ready, and the host read that as "I own
 * this society". That definition has a hole that cannot be patched, only
 * replaced. The lock lives and dies with the broker, so every gap in the
 * broker's life -- the back-off between a crash and a restart, and the whole
 * time after restarts run out -- is a gap in ownership, while the engine the
 * host started for that ownership keeps running. Another `oma` walks into the
 * gap, takes the society and starts a second engine on it: two writers of one
 * private workspace and one session history.
 *
 * So ownership is not derived from the broker. The host takes this lease
 * itself, before it writes anything or starts anything, and holds it for its
 * whole life.
 *
 * That alone still had a hole: a lease released by running code can only
 * promise the order in which this process made its calls, and `close()` on a
 * child is a signal, not a death. The lease is therefore not a lock a process
 * holds. It is a lock an open file description holds, and every process
 * started because of the lease inherits a descriptor onto that same
 * description. It is released only when the last of them closes, so the
 * society cannot pass to another host until the engine, the broker and
 * everything they started are gone -- whether this process released it
 * politely, crashed, or was killed outright. The fence is the kernel's, not
 * this code's, which is what makes it true on the paths where this code never
 * runs.
 *
 * And the name the lease is taken under is not a pathname any more. A flock on
 * a file names the lock by an inode, but a caller names the file by a path,
 * and at the same UID any process can unlink or rename that path and create a
 * new file in its place: the old holder keeps the old inode's lock, the
 * newcomer takes the new inode's, and one society has two owners that cannot
 * see each other. Re-checking the path against the pinned inode after
 * acquisition only narrows that window, because the check and the use are
 * still two steps. FS-005 has already said a boundary cannot be claimed from a
 * file mode at the same UID, and this is the same lesson about the namespace
 * rather than the mode: the abstract AF_UNIX namespace has no directory entry
 * to replace, so there is nothing for an adversary to rename, unlink or point
 * at another object with a symlink.
 *
 * The name identifies the society's state tree, not its run directory. The
 * state tree is the thing that must not have two writers -- the private
 * workspace, the session history, the mailbox -- and a lease named after the
 * run root gave two hosts with one XDG_DATA_HOME and two XDG_RUNTIME_DIRs two
 * leases over one of them.
 *
 * The broker keeps its own lock. That one answers a different question -- may
 * this process be the society's single SQLite writer -- and still refuses a
 * broker started by hand. This answers "may this process run the society's one
 * engine", and only a host asks it.
 */
import { createHash } from "node:crypto";
import { closeSync } from "node:fs";
import { abstractNameHeld, abstractNameHolder, holdAbstractName } from "@oma/native/linux";
import { SOCIETY_FENCE_ENV, SOCIETY_FENCE_FD } from "@oma/process/async";
import { assertStateRoot } from "./assets.js";
import { StoreError } from "@oma/domain/errors";

/** The abstract-namespace prefix every society lease is taken under. The rest
 * of the name is a digest, so a state path is not published to every process
 * on the machine that can list sockets. */
const SOCIETY_LEASE_PREFIX = "\0oma.society.";

/** How many times an acquisition may be re-attempted when the name is taken
 * and then let go before its holder could be named. Bounded, because "the
 * holder keeps changing" is an answer too, and it is not "free". */
const ACQUIRE_ATTEMPTS = 3;

export interface SocietyLease {
  /** The abstract-namespace name this host holds. It exists nowhere in the
   * filesystem: that is the point. */
  readonly name: string;
  /** The descriptor every process this lease pays for must inherit.
   *
   * Passing it to a child is not an optimisation and not a convenience: it is
   * what makes the child's death a precondition of the society changing hands.
   * A child started without it can outlive the lease. */
  readonly fence: number;
  /** Gives up this process's own hold. Idempotent.
   *
   * It does not, by itself, hand the society to anyone: any child still
   * holding the inherited descriptor keeps the lease held until it exits. That
   * is deliberate -- it means releasing can never be too early, only too late,
   * and a teardown that fails to wait for its engine degrades into waiting for
   * the kernel instead of into two engines on one society. */
  release(): void;
}

/** The name a society's lease is taken under, from the state tree it protects.
 *
 * The path is checked before it is used, not after: an `oma` pointed at a
 * relative, denormalized or symlinked state root would otherwise take a lease
 * under one name and write the society somewhere else, and the lease it holds
 * would be proof of owning a society nobody else is using. The UID is part of
 * the digest because the abstract namespace is shared by every user of the
 * machine, so two users with the same state path must not collide there. */
export function societyLeaseName(stateRoot: string): string {
  assertStateRoot(stateRoot);
  const uid = process.geteuid?.() ?? -1;
  return SOCIETY_LEASE_PREFIX + createHash("sha256").update(`${uid}\n${stateRoot}`).digest("hex");
}

/** Takes the society for this process, or answers null when another process
 * holds it -- which now includes a process whose host is already gone but
 * whose engine is not. Every other failure throws: "someone else owns this"
 * and "this could not be evaluated at all" are different answers, and a caller
 * that starts an engine on the first must not be handed the second.
 *
 * Nothing is created here. Taking the society is not a write, and an `oma`
 * that does not own the society must not have left a directory behind to prove
 * it tried. */
export function tryHoldSociety(stateRoot: string): SocietyLease | null {
  const name = societyLeaseName(stateRoot);
  for (let attempt = 0; attempt < ACQUIRE_ATTEMPTS; attempt += 1) {
    const held = holdAbstractName(name);
    if (held.kind === "held") return leaseOf(name, held.fd);
    if (held.kind === "failed")
      throw new StoreError("BROKER_UNAVAILABLE", `Cannot evaluate the society lease (errno ${held.errno})`);
    const holder = abstractNameHolder(name);
    // A holder of another user is not another `oma` of this Human's: this
    // process cannot tell whether the society is owned, and must not answer as
    // if it had.
    if (holder.kind === "peer" && holder.cred.uid !== (process.geteuid?.() ?? holder.cred.uid))
      throw new StoreError("BROKER_UNAVAILABLE", "Another user's process holds this society's lease name");
    if (holder.kind !== "none") return null;
    // The holder let go between the refusal and the question. Ask again rather
    // than report an owner that no longer exists.
  }
  throw new StoreError("BROKER_UNAVAILABLE", "The society lease owner keeps changing and cannot be determined");
}

function leaseOf(name: string, fence: number): SocietyLease {
  let released = false;
  return {
    name,
    fence,
    release(): void {
      if (released) return;
      released = true;
      try { closeSync(fence); } catch { /* the lease is going away either way */ }
    },
  };
}

/** What allows this process to act for a society, and how it came by it.
 *
 * Recognising an inherited lease used to be a predicate written at the
 * entrypoint: read the declared descriptor, `fstat` it, accept it if it is a
 * socket. That is the shape of defect four consecutive audits found in this
 * area, each time in a different place -- the comment states the property the
 * design needs ("exactly the lease the host that owns this society handed
 * down") and the code next to it tests something weaker that happens to be
 * true of the real thing. A socketpair is a socket. Descriptor 4 of a process
 * started by hand, with any AF_UNIX socket on it and one environment variable
 * set, was accepted as proof of owning a society another `oma` was holding,
 * and the broker then skipped taking the lease at all.
 *
 * So the predicate does not live at the call site any more, and it is not a
 * predicate about shape. The module that decides what name a society's lease
 * is taken under is the only module that decides whether a descriptor is that
 * lease, and it decides it by asking the kernel which name the descriptor
 * holds. Both directions -- taking the lease and recognising an inherited one
 * -- now come from `societyLeaseName`, so the two cannot drift apart: a change
 * to the name changes the recogniser in the same expression.
 */
export type InheritedFence =
  | { readonly kind: "society" }
  | { readonly kind: "other-society"; readonly name: string }
  | { readonly kind: "not-a-lease"; readonly why: string }
  | { readonly kind: "unreadable"; readonly errno: number };

/** Whether a descriptor is this state tree's lease.
 *
 * The kernel allows one holder of an abstract name at a time, so a descriptor
 * that holds this society's name is this society's lease -- there is no second
 * one to confuse it with, and no claim by the presenting process is consulted.
 */
export function inheritedFence(descriptor: number, stateRoot: string): InheritedFence {
  const expected = societyLeaseName(stateRoot);
  const held = abstractNameHeld(descriptor);
  if (held.kind === "unreadable") return held;
  if (held.kind === "other") return { kind: "not-a-lease", why: held.why };
  if (held.name === expected) return { kind: "society" };
  // A lease of some society, but not this one. Passing society A's lease to a
  // broker for society B would otherwise let B serve a society nothing holds
  // -- and B's own lease would stay free for a second `oma` to take.
  return held.name.startsWith(SOCIETY_LEASE_PREFIX)
    ? { kind: "other-society", name: held.name }
    : { kind: "not-a-lease", why: "descriptor holds an abstract name this product did not take" };
}

/** How this process is authorised to serve a society: it was handed the lease
 * by the `oma` that owns it, it took the lease itself, or another `oma` has
 * it. Every other outcome throws, because "someone else owns this society" and
 * "this could not be established" are different answers and only the first is
 * a reason to exit quietly. */
export type SocietyFence =
  | { readonly kind: "inherited"; readonly fence: number }
  | { readonly kind: "taken"; readonly lease: SocietyLease; readonly fence: number }
  | { readonly kind: "elsewhere" };

/** The one question a process asks before it serves a society.
 *
 * A declaration that cannot be honoured is a startup failure rather than a
 * shrug: a process that was told it holds the society but does not would go on
 * to serve a society whose ownership nothing is holding.
 */
export function claimSocietyFence(stateRoot: string): SocietyFence {
  const declared = process.env[SOCIETY_FENCE_ENV];
  if (declared === undefined) {
    const lease = tryHoldSociety(stateRoot);
    return lease === null ? { kind: "elsewhere" } : { kind: "taken", lease, fence: lease.fence };
  }
  if (declared !== String(SOCIETY_FENCE_FD))
    throw new StoreError("INTERNAL_ERROR", `${SOCIETY_FENCE_ENV} names descriptor ${declared}, which is not where this product places the society lease`);
  const fence = inheritedFence(SOCIETY_FENCE_FD, stateRoot);
  switch (fence.kind) {
    case "society": return { kind: "inherited", fence: SOCIETY_FENCE_FD };
    case "other-society":
      throw new StoreError("INTERNAL_ERROR", `descriptor ${SOCIETY_FENCE_FD} holds the lease of another society, not this one`);
    case "not-a-lease":
      throw new StoreError("INTERNAL_ERROR", `descriptor ${SOCIETY_FENCE_FD} is not this society's lease: ${fence.why}`);
    case "unreadable":
      throw new StoreError("INTERNAL_ERROR", `descriptor ${SOCIETY_FENCE_FD} could not be identified as the society lease (errno ${fence.errno})`);
  }
}
