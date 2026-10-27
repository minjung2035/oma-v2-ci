/** Test support for sparse/full-filesystem fixtures; no production admission API. */
import type { Stats } from "node:fs";
import { walkOwnedTree } from "@oma/storage/directory";
import { StoreError } from "@oma/domain/errors";

function allocatedBytes(stat: Stats): number {
  const blocks = Number.isSafeInteger(stat.blocks) ? stat.blocks * 512 : 0;
  // An empty inode still consumes storage metadata (INV10).
  return Math.max(1, stat.size, blocks);
}

/** Count an owned tree without following symlinks or charging hardlinks twice. */
export function fixtureStorageBytes(
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
  try { for (const stat of walkOwnedTree(root)) {
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

