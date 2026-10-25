/** PI-002: bounded file observation; the public protocol owns its decoding. */
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { decodeUtf8 } from "@oma/domain/utf8";
import { isValidBatchId } from "@oma/domain/identifiers";
import { decodeBatchViewText, validBatchViewLimits, type BatchView } from "@oma/protocol/batch-view";
import type { BatchViewLimits } from "@oma/contracts/host";

export function readBatchView(
  batchId: string,
  root: string,
  limits: BatchViewLimits,
): BatchView | null {
  if (!isValidBatchId(batchId) || !validBatchViewLimits(limits)) return null;
  const path = join(root, `batch-${batchId}.json`);
  let fd: number | undefined;
  try {
    fd = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > limits.frameBytes) return null;
    const bytes = Buffer.alloc(before.size + 1);
    let total = 0;
    while (total < bytes.length) {
      const count = readSync(fd, bytes, total, bytes.length - total, total);
      if (count === 0) break;
      total += count;
    }
    const after = fstatSync(fd);
    if (
      total !== before.size ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      return null;
    const text = decodeUtf8(bytes.subarray(0, total));
    return decodeBatchViewText(text, batchId, limits);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
