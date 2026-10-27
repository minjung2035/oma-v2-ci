/** DR46: the journal name identifies its one current format. An interrupted
 * append in this file is recovery input, never an earlier release's record. */
import { lstatSync } from "node:fs";
import { dirname, join } from "node:path";
import { StoreError, unobserved } from "@oma/domain/errors";

export const MANAGED_JOURNAL = "committed-v2";

/** Observe only the retired name; never decode, migrate or remove its bytes. */
export function assertManagedJournalFormat(manifest: string): void {
  const base = join(dirname(manifest), ".oma-config");
  let present: boolean;
  try {
    // Configuration loading runs on the Mac host too. This read-only format
    // observation never repairs a Human-selected bundle or invokes Linux
    // containment syscalls. The editing owner prepares its owned tail before
    // this check; either probe failing refuses the operation, never grants it.
    const observed = lstatSync(base, { throwIfNoEntry: false });
    if (observed === undefined) return;
    if (!observed.isDirectory() || observed.isSymbolicLink())
      throw new StoreError("STORE_CORRUPT", "managed configuration history is not a directory");
    present = lstatSync(join(base, "committed"), { throwIfNoEntry: false }) !== undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw unobserved(error, "the managed configuration journal format") ?? error;
  }
  if (present) throw new StoreError("INVALID_REQUEST",
    "unsupported development configuration journal; use a new development state directory");
}
