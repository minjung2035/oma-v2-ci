import type { Stats } from "node:fs";
import { scheduler } from "node:timers/promises";
import { walkOwnedTree } from "./directory.js";
import { StoreError } from "../domain/errors.js";
import { NO_HOLD, type Release, type ResourceCategory } from "../domain/admission.js";

function allocatedBytes(stat: Stats): number {
  const blocks = Number.isSafeInteger(stat.blocks) ? stat.blocks * 512 : 0;
  // An empty inode still consumes storage metadata (INV10).
  return Math.max(1, stat.size, blocks);
}

/** Legacy observation helper: count every tree; admission imposes no quota. */
export const EXCLUDED_USAGE_TREES: ReadonlySet<string> = new Set<string>();

/** Count an owned tree without following symlinks or charging hardlinks twice. */
export function observedStorageBytes(
  root: string,
  stopAfter = Number.MAX_SAFE_INTEGER,
): number {
  const usage = countedStorage(root);
  let total = 0;
  for (total of usage) if (!Number.isSafeInteger(total) || total > stopAfter) break;
  return total;
}

function* countedStorage(root: string): Generator<number> {
  const files = new Set<string>();
  let total = 0;
  try { for (const stat of walkOwnedTree(root, EXCLUDED_USAGE_TREES)) {
    if (stat.isFile()) {
      const identity = `${stat.dev}:${stat.ino}`;
      // Repeated hardlinks still cost an observation. Let the asynchronous
      // consumer yield for these entries as well, without charging twice.
      if (files.has(identity)) { yield total; continue; }
      files.add(identity);
    }
    total += allocatedBytes(stat);
    yield total;
  } } catch (error) {
    throw new StoreError("BROKER_UNAVAILABLE", "storage usage cannot be observed", { cause: error });
  }
}

/** Each observed entry yields to the broker; concurrent admissions share only
 * a scan still in progress, never a retained completed usage observation. */
export async function observedStorageBytesAsync(root: string, stopAfter = Number.MAX_SAFE_INTEGER): Promise<number> {
  let total = 0;
  for (total of countedStorage(root)) {
    if (!Number.isSafeInteger(total) || total > stopAfter) break;
    await scheduler.yield();
  }
  return total;
}

/** S-01 admission for the default owned state-tree profile. */
export function assertStorageQuotaAdmission(
  stateRoot: string,
  storageBytes: number,
  reserveBytes = 0,
): void {
  // DR37: OMA applies no storage quota. Physical I/O failures remain errors.

}

/** Compatibility for previously composed v1 hosts. Admission has no quota. */
export class StorageAdmission {
  constructor(_stateRoot: string, _storageBytes: number | undefined, _settlementHeadroom: number) {}
  get outstanding(): number { return 0; }
  async reserve(_bytes: number): Promise<Release> { return NO_HOLD; }
  async startupState(): Promise<"admitted" | "degraded"> { return "admitted"; }
  async admit(_category: ResourceCategory): Promise<Release> { return NO_HOLD; }
}
