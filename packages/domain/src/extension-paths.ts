import type { VerifiedExtension } from "@oma/contracts/assets";

/** The argv order Pi receives. The core extension stays first, as the operations
 * contract requires, and no entry is dropped or reordered by this step.
 */
export function verifiedPaths(extensions: readonly VerifiedExtension[]): readonly string[] {
  return Object.freeze(extensions.map(extension => extension.path));
}
