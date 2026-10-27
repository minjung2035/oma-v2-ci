/** A listening socket's name at a path (P0V-114, G04-02/G04-03/G03-05).
 *
 * One owner for the name a server of this path left: cleared before a server
 * listens there again. Node server.close owns removal at shutdown; calling
 * this helper then could unlink a replacement server. An already absent name
 * (including ENOENT between the check and removal) needs no cleanup.
 * Only a socket is removed: a file of another type at the path is not a name
 * a server left, and it is refused rather than deleted.
 *
 * Shared by native host callers on each supported platform.
 */
import { lstatSync, unlinkSync } from "node:fs";
import { StoreError } from "@oma/domain/errors";

export function clearSocketName(path: string): void {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat === undefined) return;
  if (!stat.isSocket()) throw new StoreError("STORE_CORRUPT", `${path} is not a socket, and is not removed as one`);
  try { unlinkSync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
