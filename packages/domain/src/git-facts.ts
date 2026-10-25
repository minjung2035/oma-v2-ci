/** Pure interpretation of canonical Git observations and review text. */
import type { GitObservation } from "@oma/contracts/git";
import { StoreError } from "./errors.js";
import { decodeUtf8 } from "./utf8.js";
import { sha256Hex } from "./canonical-json.js";

export function observed<T>(observation: GitObservation<T>, what: string): T {
  if (observation.kind === "present") return observation.value;
  if (observation.kind === "refused") throw new StoreError("INVALID_REQUEST", `${what}: ${observation.reason}`);
  throw new StoreError(observation.kind === "corrupt" ? "STORE_CORRUPT" : "REF_STATE_UNKNOWN", `${what}: ${observation.kind}`);
}
/** UX-09: the refusal every integration gate makes of a candidate whose tree
 * still carries submodule gitlinks — the CAS cannot validate gitlink objects,
 * so the candidate names them and waits to be rebuilt without them.
 * `details.paths` is the ERROR_DETAILS-allowlisted field that survives the
 * wire; the message names them for whoever reads the failure text. An empty
 * observed list is no refusal. */
export function requireNoGitlinks(paths: readonly string[]): void {
  if (paths.length === 0) return;
  throw new StoreError("UNSUPPORTED_PROFILE",
    `candidate contains submodule gitlink(s): ${paths.join(", ")}`,
    { details: { paths: [...paths] } });
}
/** '/' stays gated by the production profile admission check. */
export function protectedPathMatches(path: string, protectedPath: string): boolean {
  // DR18: the root protects the whole tree -- every change a candidate makes.
  if (protectedPath === "/") return true;
  return protectedPath.endsWith("/") ? path.startsWith(protectedPath) : path === protectedPath;
}
export function mergeDiffText(diff: Buffer): string {
  try { return decodeUtf8(diff); }
  catch {
    return `[non-UTF-8 merge diff: ${diff.byteLength} bytes, sha256 ${sha256Hex(diff)}; base64-encoded]\n` +
      diff.toString("base64");
  }
}

