/** P0: an answer too large for one inline delivery is not refused -- its
 * complete bytes are kept in the caller's state directory and the path is
 * handed back with the head of the answer. The file is named by content
 * digest: publishing the same answer twice costs nothing, and a digest-named
 * file already holding different bytes is evidence of tampering, not a place
 * to overwrite.
 *
 * This is delivery, not accounting: the spool writes no receipt and changes
 * no durable fact, so a crash may leave an extra file under `output/` but
 * never a wrong one. */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { sha256Hex } from "../domain/canonical-json.js";
import { ensureOwnedDurableDirectory, publishNoReplace } from "./durable-fs.js";
import { fileDigest } from "./file-digest.js";

/** The directory one caller's spilled answers live in, next to the request
 * cache under the same OMA-owned state boundary (request-cache.ts names the
 * same `.local/state/oma` root). */
function spoolDirectory(home: string): { oma: string; directory: string } {
  const oma = join(home, ".local", "state", "oma");
  return { oma, directory: join(oma, "output") };
}

/** Write the complete answer and return the path it can be read back from.
 * `ensureOwnedDurableDirectory` repairs the OMA-owned part of the path, so a
 * mode-000 ancestor OMA made cannot wedge a later answer; the caller's own
 * `.local`/`state` are never touched. Any write failure is the caller's to
 * report -- nothing here hides it behind a truncated answer. */
export function spoolOutput(home: string, bytes: Uint8Array): string {
  const { oma, directory } = spoolDirectory(home);
  ensureOwnedDurableDirectory(directory, oma, 0o700);
  const digest = sha256Hex(bytes);
  const named = join(directory, `output-${digest}.txt`);
  if (publishNoReplace(named, bytes) === "created") return named;
  if (fileDigest(named).sha256 === digest) return named;
  // A digest-named file holding other bytes is not this answer's home.
  const unique = join(directory, `output-${digest}-${randomUUID()}.txt`);
  publishNoReplace(unique, bytes);
  return unique;
}
