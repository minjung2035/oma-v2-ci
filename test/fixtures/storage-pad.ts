/** Sets the fixture tree observation of an owned root to an exact byte count
 * with one sparse file: the observer counts max(size, allocated), so no disk
 * space is consumed. Used to generate a precisely sized synthetic tree.
 */
import { existsSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixtureStorageBytes } from "./storage-usage.js";

export function padTree(root: string, target: number): void {
  const pad = join(root, "pad.bin");
  if (!existsSync(pad)) writeFileSync(pad, "");
  for (let attempt = 0; attempt < 8; attempt++) {
    const observed = fixtureStorageBytes(root);
    if (observed === target) return;
    const size = statSync(pad).size + target - observed;
    if (size < 0) throw new Error(`the tree already exceeds ${target} bytes by more than the pad`);
    truncateSync(pad, size);
  }
  throw new Error(`the tree observation did not settle at ${target} bytes`);
}
export function removePad(root: string): void { truncateSync(join(root, "pad.bin"), 0); }
