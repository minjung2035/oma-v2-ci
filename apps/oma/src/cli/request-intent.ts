/** IPC-006/008: stable CLI intent, with no file reads or revision resolution. */
import type { MutationMethod } from "@oma/contracts";
import { isValidFullOid } from "@oma/domain/identifiers";
import { firstRequestProjectionMismatch } from "@oma/domain/request-identity";

/** Present invocation: only direct arguments with defined comparison semantics. */
export interface FreshCommandIntent {
  readonly expectedMethod: MutationMethod;
  /** Lazy so a method conflict is detected even before projecting arguments. */
  readonly explicitParams: () => Readonly<Record<string, unknown>>;
}

/** Original invocation: immutable resolved payload; no source-path provenance invented. */
export interface FrozenRequestIdentity {
  readonly method: string;
  readonly params: unknown;
}

export function requestIntentConflict(
  intended: FreshCommandIntent,
  frozen: FrozenRequestIdentity,
): string | null {
  if (frozen.method !== intended.expectedMethod) return "method";
  return firstRequestProjectionMismatch(intended.expectedMethod, intended.explicitParams(), frozen.params);
}

/** Explicit full OIDs compare as bytes. HEAD/branch/tag aliases are never re-resolved. */
export function explicitFullOid(
  field: "from" | "candidate", revision: string,
): Readonly<Record<string, string>> {
  return isValidFullOid(revision) ? { [field]: revision } : {};
}
