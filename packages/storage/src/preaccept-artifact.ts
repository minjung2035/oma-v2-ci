import { unlinkAt } from "@oma/file-descriptors";
/** Pre-accept artifact ownership.
 *
 * An immutable artifact published before its acceptance transaction belongs to
 * nobody until that transaction commits. A transaction loser, a rejected
 * request, or a plan that names no artifact must remove exactly the inode this
 * call published, and nothing else. `PreparedSubmitSpool` is the same state
 * machine over a bundle name, so both answer to `PreacceptOwner` and every
 * coordinator settles them through one question.
 */
import { closeSync, fstatSync, fsyncSync } from "node:fs";
import { basename, dirname } from "node:path";
import { StoreError } from "@oma/domain/errors";
import { openDirectory, openRegularBeneath } from "@oma/native/files";

import type { PreacceptOwner } from "@oma/contracts/files";

export interface PublishedIdentity {
  readonly dev: number;
  readonly ino: number;
}

/** Observe the inode a publication put at this name. An unobservable name
 * yields no identity, and an artifact with no identity is never removed.
 */
type PublishedIdentityObservation =
  | { readonly kind: "present"; readonly identity: PublishedIdentity; readonly descriptor: number }
  | { readonly kind: "absent" }
  | { readonly kind: "unavailable" };

function observePublished(path: string): PublishedIdentityObservation {
  let parent: number | undefined;
  try {
    parent = openDirectory(dirname(path));
    const fd = openRegularBeneath(parent, basename(path));
    let transferred = false;
    try {
      const stat = fstatSync(fd);
      if (stat.isFile()) {
        transferred = true;
        return { kind: "present", identity: { dev: stat.dev, ino: stat.ino }, descriptor: fd };
      }
      return { kind: "unavailable" };
    } finally { if (!transferred) closeSync(fd); }
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { kind: "absent" } : { kind: "unavailable" };
  } finally { if (parent !== undefined) closeSync(parent); }
}

export function observePublishedIdentity(path: string): PublishedIdentity | null {
  const observed = observePublished(path);
  if (observed.kind !== "present") return null;
  try { return observed.identity; } finally { closeSync(observed.descriptor); }
}

/** Unlink a name only while it still resolves to the inode we published.
 * A replaced or removed name is left alone: absence is already the goal, and a
 * different inode is somebody else's artifact.
 */
function removeOwnedInode(path: string, identity: PublishedIdentity): "removed" | "absent" | "identity-mismatch" {
  const parent = openDirectory(dirname(path));
  try {
    let fd: number;
    try { fd = openRegularBeneath(parent, basename(path)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "absent";
      throw error;
    }
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.dev !== identity.dev || stat.ino !== identity.ino) return "identity-mismatch";
    } finally { closeSync(fd); }
    try { unlinkAt(parent, basename(path)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "absent";
      throw error;
    }
    fsyncSync(parent);
    return "removed";
  } finally { closeSync(parent); }
}

export class PreacceptArtifact implements PreacceptOwner {
  private owner: "preaccept" | "accepted" | "released" = "preaccept";
  private pin: number | undefined;
  constructor(readonly path: string, private readonly identity: PublishedIdentity | null,
      private readonly knownAbsent = false, descriptor?: number) {
    if (identity === null) return;
    let observed: PublishedIdentityObservation;
    if (descriptor === undefined) observed = observePublished(path);
    else {
      try { observed = { kind: "present", identity: fstatSync(descriptor), descriptor }; }
      catch (error) { closeSync(descriptor); throw error; }
    }
    if (observed.kind !== "present")
      throw new StoreError("REF_STATE_UNKNOWN", "preaccept artifact identity cannot be pinned");
    if (observed.identity.dev !== identity.dev || observed.identity.ino !== identity.ino) {
      closeSync(observed.descriptor);
      throw new StoreError("REF_STATE_UNKNOWN", "preaccept artifact identity changed before pinning");
    }
    // A live descriptor prevents inode-number reuse after unlink. The
    // publisher must acquire this pin while its original descriptor is held.
    this.pin = observed.descriptor;
  }
  private closePin(): void {
    const pin = this.pin; this.pin = undefined;
    if (pin !== undefined) closeSync(pin);
  }
  retainForOperation(): void {
    if (this.owner === "released")
      throw new StoreError("INTERNAL_ERROR", "released artifact cannot become accepted evidence");
    this.owner = "accepted";
    this.closePin();
  }
  discardUnaccepted(): void {
    if (this.owner !== "preaccept") return;
    if (this.identity === null) {
      if (this.knownAbsent) { this.owner = "released"; return; }
      throw new StoreError("REF_STATE_UNKNOWN", "preaccept artifact identity is unavailable; cleanup is unconfirmed");
    }
    if (this.pin === undefined)
      throw new StoreError("REF_STATE_UNKNOWN", "preaccept cleanup lost its inode pin; evidence retained");
    try {
      const removed = removeOwnedInode(this.path, this.identity);
      if (removed === "identity-mismatch")
        throw new StoreError("REF_STATE_UNKNOWN", "preaccept artifact identity changed; replacement retained");
      this.owner = "released";
    } finally { this.closePin(); }
  }
}

/** The artifact a publication just put at this name, owned by nobody yet. */
export function publishedArtifact(path: string): PreacceptArtifact {
  const observed = observePublished(path);
  return new PreacceptArtifact(path, observed.kind === "present" ? observed.identity : null,
    observed.kind === "absent", observed.kind === "present" ? observed.descriptor : undefined);
}

export type PreacceptDisposition =
  | "unaccepted-known"
  | "accepted-referenced"
  | "accepted-unreferenced"
  | "outcome-unknown"
  | "cleanup-unconfirmed";

type ObservedPreacceptDisposition = Exclude<PreacceptDisposition, "cleanup-unconfirmed">;

export interface PreacceptRegistration {
  readonly operationId: string;
  readonly resource: string;
  readonly owner: PreacceptOwner;
  readonly observe: () => ObservedPreacceptDisposition;
  /** False/throw means native users or descendants are not proven quiescent. */
  readonly quiescent?: () => boolean;
}

export interface PreacceptSettlement {
  readonly operationId: string;
  readonly resource: string;
  readonly disposition: PreacceptDisposition;
}

export class PreacceptSettlementError extends AggregateError {
  readonly report: readonly PreacceptSettlement[];
  constructor(errors: readonly unknown[], report: readonly PreacceptSettlement[]) {
    super(errors, "preaccept settlement and cleanup failed");
    this.name = "PreacceptSettlementError";
    this.report = report;
  }
}

interface ScopeEntry {
  readonly registration: Readonly<PreacceptRegistration>;
  decision: ObservedPreacceptDisposition | null;
  final: PreacceptSettlement | null;
}

/** A narrow owner for resources acquired before acceptance. Registration carries
 * the operation reference and actual reference observer; it is not a generic
 * effect/resource manager and performs no filesystem discovery. */
export class PreacceptScope {
  private readonly entries: ScopeEntry[] = [];
  private readonly owners = new Set<PreacceptOwner>();
  private started = false;

  register(registration: PreacceptRegistration): void {
    if (this.started) throw new StoreError("INTERNAL_ERROR", "cannot register preaccept ownership after settlement started");
    if (!registration.operationId || !registration.resource)
      throw new StoreError("INTERNAL_ERROR", "preaccept registration requires operation and resource identity");
    if (this.owners.has(registration.owner))
      throw new StoreError("INTERNAL_ERROR", "preaccept owner is already registered");
    this.owners.add(registration.owner);
    this.entries.push({ registration: Object.freeze({ ...registration }), decision: null, final: null });
  }

  settle(): readonly PreacceptSettlement[] {
    this.started = true;
    const report: PreacceptSettlement[] = [];
    const failures: unknown[] = [];
    for (const entry of this.entries) {
      if (entry.final !== null) { report.push(entry.final); continue; }
      if (entry.decision === null) {
        try {
          if (entry.registration.quiescent && !entry.registration.quiescent())
            entry.decision = "outcome-unknown";
          else entry.decision = entry.registration.observe();
        } catch { entry.decision = "outcome-unknown"; }
      }
      const decision = entry.decision;
      if (decision !== "unaccepted-known" && decision !== "accepted-referenced" &&
          decision !== "accepted-unreferenced" && decision !== "outcome-unknown")
        throw new StoreError("INTERNAL_ERROR", "invalid preaccept disposition");
      try {
        if (decision === "accepted-referenced" || decision === "outcome-unknown")
          entry.registration.owner.retainForOperation();
        else entry.registration.owner.discardUnaccepted();
        entry.final = Object.freeze({ operationId: entry.registration.operationId, resource: entry.registration.resource, disposition: decision });
        report.push(entry.final);
      } catch (error) {
        failures.push(error);
        report.push(Object.freeze({ operationId: entry.registration.operationId, resource: entry.registration.resource, disposition: "cleanup-unconfirmed" }));
      }
    }
    const frozen = Object.freeze(report);
    if (failures.length > 0) throw new PreacceptSettlementError(failures, frozen);
    return frozen;
  }

  settleFailure(primary: unknown): never {
    try { this.settle(); }
    catch (error) {
      if (error instanceof PreacceptSettlementError)
        throw new PreacceptSettlementError([primary, ...error.errors], error.report);
      throw new AggregateError([primary, error], "preaccept failure and settlement failed");
    }
    throw primary;
  }
}
