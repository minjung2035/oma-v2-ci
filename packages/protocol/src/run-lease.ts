import { isAbsolute, normalize } from "node:path";
import type { RunLease } from "@oma/contracts";
import { isValidActorName } from "@oma/domain/identifiers";
import { isActorSocketPathFor } from "@oma/domain/paths";
import { StoreError } from "@oma/domain/errors";

const validatedLease: unique symbol = Symbol("validated run lease identity");
export type ValidatedRunLease = Readonly<RunLease> & {
  readonly [validatedLease]: true;
};
const scopes = new WeakMap<object, string>();
export function trustedAbsolutePath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    isAbsolute(path) &&
    path !== "/" &&
    !path.includes("\0") &&
    normalize(path) === path
  );
}
/** Decode transport identity against composition facts, not against a root
 * supplied by the response. This is not a live authority or whole-scope death proof.
 */
export function decodeRunLease(
  value: unknown,
  expected: { actor: string; runRoot: string },
): ValidatedRunLease {
  if (
    !isValidActorName(expected.actor) ||
    !trustedAbsolutePath(expected.runRoot) ||
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  )
    throw new StoreError(
      "AUTH_FAILED",
      "runner lease has no trusted identity context",
    );
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).length !== 3 ||
    Object.keys(row).some(
      (key) => !["actor", "incarnation", "socketHostPath"].includes(key),
    ) ||
    row.actor !== expected.actor ||
    typeof row.incarnation !== "number" ||
    !Number.isSafeInteger(row.incarnation) ||
    row.incarnation < 1 ||
    !isActorSocketPathFor(row.socketHostPath, {
      runRoot: expected.runRoot,
      actor: expected.actor,
      incarnation: row.incarnation,
    })
  )
    throw new StoreError(
      "AUTH_FAILED",
      "runner lease actor, incarnation or endpoint differs from trusted context",
    );
  const lease = Object.freeze({
    actor: expected.actor,
    incarnation: row.incarnation,
    socketHostPath: row.socketHostPath as string,
  });
  scopes.set(lease, expected.runRoot);
  return lease as unknown as ValidatedRunLease;
}
export function assertValidatedRunLease(
  value: RunLease,
  runRoot?: string,
): asserts value is ValidatedRunLease {
  if (
    value === null ||
    typeof value !== "object" ||
    !scopes.has(value) ||
    (runRoot !== undefined && scopes.get(value) !== runRoot)
  )
    throw new StoreError(
      "AUTH_FAILED",
      "sandbox requires a decoded, root-bound runner lease",
    );
}
