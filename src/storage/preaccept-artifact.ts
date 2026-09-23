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
type PublishedIdentityObservation =
  | { readonly kind: "present"; readonly identity: PublishedIdentity }
  | { readonly kind: "absent" }
  | { readonly kind: "unavailable" };

function observePublished(path: string): PublishedIdentityObservation {
  let parent: number | undefined;
  try {
    parent = openDirectory(dirname(path));
    const fd = openRegularBeneath(parent, basename(path));
    try {
      const stat = fstatSync(fd);
      return stat.isFile() ? { kind: "present", identity: { dev: stat.dev, ino: stat.ino } } : { kind: "unavailable" };
    } finally { closeSync(fd); }
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { kind: "absent" } : { kind: "unavailable" };
  } finally { if (parent !== undefined) closeSync(parent); }
}

export function observePublishedIdentity(path: string): PublishedIdentity | null {
  const observed = observePublished(path);
  return observed.kind === "present" ? observed.identity : null;
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
    try { unlinkSync(entryAt(parent, basename(path))); }
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
  constructor(readonly path: string, private readonly identity: PublishedIdentity | null, private readonly knownAbsent = false) {}
  retainForOperation(): void {
    if (this.owner === "released")
      throw new StoreError("INTERNAL_ERROR", "released artifact cannot become accepted evidence");
    this.owner = "accepted";
  }
  discardUnaccepted(): void {
    if (this.owner !== "preaccept") return;
    if (this.identity === null) {
      if (this.knownAbsent) { this.owner = "released"; return; }
      throw new StoreError("REF_STATE_UNKNOWN", "preaccept artifact identity is unavailable; cleanup is unconfirmed");
    }
    const removed = removeOwnedInode(this.path, this.identity);
    if (removed === "identity-mismatch")
      throw new StoreError("REF_STATE_UNKNOWN", "preaccept artifact identity changed; replacement retained");
    this.owner = "released";
  }
}

/** The artifact a publication just put at this name, owned by nobody yet. */
export function publishedArtifact(path: string): PreacceptArtifact {
  const observed = observePublished(path);
  return new PreacceptArtifact(path, observed.kind === "present" ? observed.identity : null, observed.kind === "absent");
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

/** Row-existence compatibility facade: did the journal accept the operation
 * that would own these artifacts? It cannot tell a plan that names an artifact
 * from one that does not, so no production caller uses it; coordinators
 * register plan-reference observers with PreacceptScope instead. A journal that
 * cannot be read is not evidence of non-acceptance, so uncertainty retains.
 */
export function settleByAcceptance(
  owners: readonly (PreacceptOwner | null)[],
  accepted: () => boolean,
  operationId = "legacy-preaccept",
): void {
  let outcome: boolean | null = null;
  try { outcome = accepted(); } catch { /* DB uncertainty cannot authorize deletion. */ }
  const scope = new PreacceptScope();
  owners.forEach((owner, index) => {
    if (owner === null) return;
    scope.register({
      operationId,
      resource: `legacy-resource-${index}`,
      owner,
      observe: () => outcome === false ? "unaccepted-known" : outcome === true ? "accepted-referenced" : "outcome-unknown",
    });
  });
  scope.settle();
}
