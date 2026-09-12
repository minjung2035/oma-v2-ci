/** IPC-005: compatibility facade. Request identity has a single policy owner.
 * All callers, including lifecycle callers without set fields, pass through the
 * same builder. Prior canonicalRequestParams calls are harmless and idempotent.
 * Existing rows are compared by their stored hash, never rewritten or rehashed.
 */
import { buildRequestIdentity, type ExistingStreamIdentity } from "./domain/request-identity.js";

export { canonicalJson, sha256Hex, sortedUnique, snapshotJson } from "./domain/canonical-json.js";
export { canonicalRequestParams, buildRequestIdentity } from "./domain/request-identity.js";

/** There is intentionally no exported raw/unnormalized request hash primitive. */
export function requestHash(
  method: string,
  params: unknown,
  existingStreamIdentity?: ExistingStreamIdentity,
): string {
  return buildRequestIdentity(method, params, existingStreamIdentity).hash;
}
