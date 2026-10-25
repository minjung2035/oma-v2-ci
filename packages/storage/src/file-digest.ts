/** Hash a regular file from one held descriptor with fixed memory. A growing
 * file cannot prolong the read: only its observed size and one tail byte are
 * read, and both descriptor observations must agree. */
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync, type Stats } from "node:fs";

export function fileDigest(path: string): { readonly stat: Stats; readonly sha256: string } {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile()) throw new Error(`expected a regular file: ${path}`);
    const hash = createHash("sha256"), buffer = Buffer.alloc(64 * 1024);
    let position = 0;
    while (position < before.size) {
      const count = readSync(fd, buffer, 0, Math.min(buffer.length, before.size - position), position);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count)); position += count;
    }
    const tail = readSync(fd, buffer, 0, 1, position);
    const after = fstatSync(fd);
    if (position !== before.size || tail !== 0 || after.dev !== before.dev || after.ino !== before.ino ||
        after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
      throw new Error(`file changed while being read: ${path}`);
    return { stat: after, sha256: hash.digest("hex") };
  } finally { closeSync(fd); }
}
