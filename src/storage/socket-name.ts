/** A listening socket's name at a path (P0V-114, G04-02/G04-03/G03-05).
 *
 * One owner for the name a server of this path left: cleared before a server
 * listens there again, and removed when a server is done with it. The name's
 * absence is what is wanted, so a name already gone -- removed by the kernel's
 * own close, or by anyone between a look and the removal -- is not a failure.
 * Only a socket is removed: a file of another type at the path is not a name
 * a server left, and it is refused rather than deleted.
 *
 * Portable: the macOS host and the guest use it as the Linux core does.
 */
import { lstatSync, unlinkSync } from "node:fs";
import { StoreError } from "../domain/errors.js";

export function clearSocketName(path: string): void {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat === undefined) return;
  if (!stat.isSocket()) throw new StoreError("STORE_CORRUPT", `${path} is not a socket, and is not removed as one`);
  try { unlinkSync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
