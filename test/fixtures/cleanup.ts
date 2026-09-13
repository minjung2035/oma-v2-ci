/** Test-only cleanup for trees that contain immutable publications.
 *
 * MUST [CTX-004]: published context revisions are mode 0555, and
 * `rmSync(recursive)` needs the owner write bit on every directory it empties.
 * Test cleanup restores that bit before removing its own temporary tree; the
 * product's immutability semantics are unchanged.
 */
import { chmodSync, existsSync, lstatSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function removeTree(root: string): void {
  if (!existsSync(root)) return;
  const restore = (path: string): void => {
    let stat;
    try { stat = lstatSync(path); } catch { return; }
    if (!stat.isDirectory()) return;
    chmodSync(path, 0o700);
    for (const name of readdirSync(path)) restore(join(path, name));
  };
  restore(root);
  rmSync(root, { recursive: true, force: true });
}

/** Overwrite an accepted immutable object from a test. Published objects are
 * mode 0444, so the owner write bit is restored and then removed again. */
export function overwritePublished(path: string, bytes: Uint8Array | string): void {
  chmodSync(path, 0o600);
  try { writeFileSync(path, bytes); } finally { chmodSync(path, 0o444); }
}
