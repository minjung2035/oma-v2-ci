import { existsSync, lstatSync, readdirSync, type Stats } from "node:fs";
import { join } from "node:path";
import { assertStorageQuotaSupported } from "../domain/resources.js";
import { StoreError } from "../domain/errors.js";
import { storageGated, type ResourceGate } from "../domain/admission.js";

function allocatedBytes(stat: Stats): number {
  const blocks = Number.isSafeInteger(stat.blocks) ? stat.blocks * 512 : 0;
  return Math.max(stat.size, blocks);
}

/** Count an owned tree without following symlinks or charging hardlinks twice. */
export function observedStorageBytes(
  root: string,
  stopAfter = Number.MAX_SAFE_INTEGER,
): number {
  if (!existsSync(root)) return 0;
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

/** D04: one storage gate for dispatch and recovery stages; no quota profile gates nothing. */
export function storageResourceGate(stateRoot: string, storageBytes: number | undefined): ResourceGate {
  return category => {
    if (storageBytes !== undefined && storageGated(category)) assertStorageQuotaAdmission(stateRoot, storageBytes);
  };
}
