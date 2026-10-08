import { lstatSync, readdirSync, type Stats } from "node:fs";
import { basename, join } from "node:path";
import { assertStorageQuotaSupported } from "../domain/resources.js";
import { StoreError } from "../domain/errors.js";
import { NO_HOLD, releaseOnce, type Release, type ResourceCategory } from "../domain/admission.js";

function allocatedBytes(stat: Stats): number {
  const blocks = Number.isSafeInteger(stat.blocks) ? stat.blocks * 512 : 0;
  // An empty inode still consumes storage metadata (INV10).
  return Math.max(1, stat.size, blocks);
}

/** FI-4/UX-10b: directory names whose contents no storage observation counts.
 * What the clone came with (`.git`) and the trees a package manager or build
 * tool regenerates are not what the quota bounds -- it bounds what the agent
 * authors, and those trees are shell work a real project needs (a
 * `node_modules` alone can exceed the whole quota). The check is a name on a
 * directory: a file of the same name is authored content and counts, and the
 * walked root itself is never excluded. The workspace tool guard mirrors this
 * set -- PI-001 keeps it from importing this module, and a test binds the two
 * spellings as it does for TOOL_SCOPE_ENV (INV04). */
export const EXCLUDED_USAGE_TREES: ReadonlySet<string> = new Set([".git", "node_modules", ".venv", "target", "dist", "build"]);

/** Count an owned tree without following symlinks or charging hardlinks twice. */
export function observedStorageBytes(
  root: string,
  stopAfter = Number.MAX_SAFE_INTEGER,
): number {
  // The root is walked like any entry: absent is 0 bytes, and a root that
  // cannot be observed is unavailable, not empty (INV02).
  const pending: [path: string, top: boolean][] = [[root, true]];
  const files = new Set<string>();
  let total = 0;
  while (pending.length > 0) {
    const [path, top] = pending.pop()!;
    let stat: Stats;
    try {
      stat = lstatSync(path);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      )
        continue;
      throw new StoreError(
        "BROKER_UNAVAILABLE",
        "storage usage cannot be observed",
        { cause: error },
      );
    }
    if (!top && stat.isDirectory() && EXCLUDED_USAGE_TREES.has(basename(path))) continue;
    if (stat.isFile()) {
      const identity = `${stat.dev}:${stat.ino}`;
      if (files.has(identity)) continue;
      files.add(identity);
    }
    total += allocatedBytes(stat);
    if (!Number.isSafeInteger(total) || total > stopAfter) return total;
    if (!stat.isDirectory()) continue;
    let names: string[];
    try {
      names = readdirSync(path);
    } catch (error) {
      throw new StoreError(
        "BROKER_UNAVAILABLE",
        "storage directory cannot be observed",
        { cause: error },
      );
    }
    for (const name of names) pending.push([join(path, name), false]);
  }
  return total;
}

/** S-01 admission for the default owned state-tree profile. */
export function assertStorageQuotaAdmission(
  stateRoot: string,
  storageBytes: number,
  reserveBytes = 0,
): void {
  assertStorageQuotaSupported(storageBytes);
  if (!Number.isSafeInteger(reserveBytes) || reserveBytes < 0)
    throw new StoreError(
      "UNSUPPORTED_PROFILE",
      "storage reservation must be a non-negative safe integer",
    );
  const maximumObserved = storageBytes - reserveBytes;
  if (
    maximumObserved < 0 ||
    observedStorageBytes(stateRoot, maximumObserved) > maximumObserved
  )
    throw new StoreError(
      "QUOTA_EXCEEDED",
      "society storage quota would be exceeded",
    );
}

/** D04/WP22: the one logical storage owner of a broker process. A decision
 * compares a fresh scan of the owned tree plus every outstanding reservation
 * with the configured quota; nothing is cached. The scan is not a hard
 * filesystem quota: same-UID writers outside the broker and SQLite/WAL growth
 * are observed after the fact, never prevented, and physical exhaustion stays a
 * separate STORAGE_FULL failure.
 *
 * Settlement of already accepted work may pass the quota by a bounded headroom,
 * taken from the existing protocol frame limit (no new setting), one over-cap
 * settlement at a time; past the headroom it is refused like new work.
 */
export class StorageAdmission {
  private reserved = 0;
  private overCapSettlements = 0;
  constructor(private readonly stateRoot: string, private readonly storageBytes: number | undefined,
    private readonly settlementHeadroom: number) {
    if (!Number.isSafeInteger(settlementHeadroom) || settlementHeadroom < 0)
      throw new StoreError("UNSUPPORTED_PROFILE", "settlement headroom must be a non-negative safe integer");
  }
  /** Bytes reserved for requests whose data the tree does not show yet. */
  get outstanding(): number { return this.reserved; }
  /** A streamed request reserves its declared bytes from preflight until its
   * execution settles or its connection closes; the release runs once. */
  reserve(bytes: number): Release {
    if (!Number.isSafeInteger(bytes) || bytes < 0)
      throw new StoreError("UNSUPPORTED_PROFILE", "storage reservation must be a non-negative safe integer");
    this.check(bytes, 0);
    this.reserved += bytes;
    return releaseOnce(() => { this.reserved -= bytes; });
  }
  /** The startup probe: does the store currently admit new work. "degraded"
   * answers the over-quota state honestly -- the broker still starts and
   * serves, refusing each new admission per request until usage settles,
   * rather than not starting at all (a whole-society outage that used to
   * need manual cleanup). The probe holds nothing; a failure that is not a
   * quota refusal still throws. */
  startupState(): "admitted" | "degraded" {
    try { this.admit("admit")(); return "admitted"; }
    catch (error) {
      if (error instanceof StoreError && error.code === "QUOTA_EXCEEDED") return "degraded";
      throw error;
    }
  }
  admit(category: ResourceCategory): Release {
    switch (category) {
      case "read": case "safety-control": return NO_HOLD;
      case "admit": this.check(0, 0); return NO_HOLD;
      case "settle": {
        try { this.check(0, 0); return NO_HOLD; }
        catch (error) { if (!(error instanceof StoreError) || error.code !== "QUOTA_EXCEEDED") throw error; }
        if (this.overCapSettlements > 0)
          throw new StoreError("QUOTA_EXCEEDED", "the settlement headroom is in use; the settlement waits for it");
        this.check(0, this.settlementHeadroom);
        this.overCapSettlements++;
        return releaseOnce(() => { this.overCapSettlements--; });
      }
    }
  }
  private check(extra: number, headroom: number): void {
    if (this.storageBytes === undefined) return;
    const reserved = this.reserved + extra; const ceiling = this.storageBytes + headroom;
    if (!Number.isSafeInteger(reserved) || !Number.isSafeInteger(ceiling))
      throw new StoreError("QUOTA_EXCEEDED", "storage reservations exceed the supported range");
    assertStorageQuotaAdmission(this.stateRoot, ceiling, reserved);
  }
}
