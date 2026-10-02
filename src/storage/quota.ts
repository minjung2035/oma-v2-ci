import { lstatSync, readdirSync, type Stats } from "node:fs";
import { join } from "node:path";
import { assertStorageQuotaSupported } from "../domain/resources.js";
import { StoreError } from "../domain/errors.js";
import { NO_HOLD, releaseOnce, type Release, type ResourceCategory } from "../domain/admission.js";

function allocatedBytes(stat: Stats): number {
  const blocks = Number.isSafeInteger(stat.blocks) ? stat.blocks * 512 : 0;
  // An empty inode still consumes storage metadata (INV10).
  return Math.max(1, stat.size, blocks);
}

/** Count an owned tree without following symlinks or charging hardlinks twice. */
export function observedStorageBytes(
  root: string,
  stopAfter = Number.MAX_SAFE_INTEGER,
): number {
  // The root is walked like any entry: absent is 0 bytes, and a root that
  // cannot be observed is unavailable, not empty (INV02).
  const pending = [root];
  const files = new Set<string>();
  let total = 0;
  while (pending.length > 0) {
    const path = pending.pop()!;
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
    for (const name of names) pending.push(join(path, name));
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
