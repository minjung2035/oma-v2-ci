/** Re-verifies recorded extension digests immediately before Pi is spawned.
 *
 * The operations loader records a SHA-256 for every role extension it resolves.
 * That observation is only worth anything if it is checked again at the moment
 * the file is actually handed to Pi, so this module is the single owner of that
 * check and the only place allowed to decide that a recorded asset still is what
 * the host approved.
 *
 * Scope, stated plainly: this closes the window between configuration load and
 * spawn. It does not defeat a same-UID writer that replaces the file between
 * this check and Pi's own open, and it does not replace the deployment manifest
 * digest or Pi executable approval. It is asset identification, not containment.
 */
import { fileDigest } from "@oma/storage/file-digest";
import { StoreError, unobserved } from "@oma/domain/errors";

import type { VerifiedExtension } from "@oma/contracts/assets";

const DIGEST = /^[0-9a-f]{64}$/;

/** Throws unless every recorded extension still hashes to its recorded digest.
 * A missing, unreadable, non-regular or changed file refuses the start; there is
 * no "continue without that extension" path, because a role's tool surface is
 * part of what the host approved.
 */
export function assertExtensionIntegrity(extensions: readonly VerifiedExtension[]): void {
  for (const extension of extensions) {
    if (!DIGEST.test(extension.sha256))
      throw new StoreError("UNSUPPORTED_PROFILE", `extension digest is not a SHA-256: ${extension.path}`);
    let observed: string;
    try {
      observed = fileDigest(extension.path).sha256;
    } catch (error) {
      if (error instanceof StoreError) throw error;
      throw unobserved(error, `the extension ${extension.path}`) ?? new StoreError(
        "UNSUPPORTED_PROFILE",
        `extension recorded at configuration load is unreadable now: ${extension.path}`,
        { cause: error },
      );
    }
    if (observed !== extension.sha256)
      throw new StoreError(
        "UNSUPPORTED_PROFILE",
        `extension changed after it was recorded; refusing to start: ${extension.path}`,
      );
  }
}

