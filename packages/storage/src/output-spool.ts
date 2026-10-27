/** P0: an answer too large for one inline delivery is not refused -- its
 * complete bytes are kept in the caller's state directory and the path is
 * handed back with the head of the answer. The file is named by content
 * digest: publishing the same answer twice costs nothing, and a digest-named
 * file already holding different bytes is evidence of tampering, not a place
 * to overwrite.
 *
 * Ownership and retention (P0-4): the spool is the caller's own state --
 * `.local/state/oma/output` under the caller's HOME, the same boundary the
 * request cache keeps, not OMA's society state. Every file in it is a
 * complete answer some preview already named to the caller, and nothing in
 * OMA keeps an index back to it, so OMA is never in a position to call one
 * garbage: the retention policy is that the caller owns the directory and
 * may empty it at any time without confusing anything but disk usage --
 * files persist until their owner removes them, exactly like the frozen
 * requests beside them. A sweep that deleted bytes the caller may still
 * need would be the defect this spool exists to prevent.
 *
 * This is delivery, not accounting: the spool writes no receipt and changes
 * no durable fact, so a crash may leave an extra file under `output/` but
 * never a wrong one. The write and its fsync are synchronous on the
 * caller's event loop by design: the one caller (`Client.preview`) is a
 * synchronous presentation path, the flush is the durability the file
 * exists for, and making it asynchronous would only move the same bytes,
 * not avoid them. */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { sha256Hex } from "@oma/domain/canonical-json";
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
