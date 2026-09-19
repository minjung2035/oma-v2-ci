/** TUI-004 / architecture §23.5: the Principal session's connection credential.
 *
 * A Resident proves who it is by the systemd scope it runs in. The Principal
 * has no scope: the product starts its engine as its own child, in the Human's
 * terminal, so there is no unit to observe and a cgroup check could only ever
 * fail. Its authority comes instead from a secret the broker mints for the run
 * it is serving and publishes where only the owning user can read it; the host
 * hands that secret to the session it started, and a connection that presents
 * it is the Principal for as long as the broker that minted it is alive.
 *
 * The secret is never derived from anything — not the society, not a path, not
 * the clock — so knowing the deployment tells an attacker nothing, and it dies
 * with the broker, so a copy taken from an old run authorises nothing. It is
 * never written to a file: PR-001 asks for a host-only channel, and a file at a
 * derivable path under the run directory is not one — it is readable by every
 * process of this user, which is exactly the class of caller the Principal's
 * authority must not admit. It travels instead on a descriptor only the host
 * that started the broker holds, and from there into the trusted extension's
 * environment, never into a sandbox and never onto a model-facing surface
 * (INF-007).
 *
 * The credential alone does not decide who the Principal is. The host names the
 * session before the broker starts, so the broker knows which handle to expect
 * rather than recording whichever one arrives first.
 *
 * This module is a codec: it decides what a credential looks like and where it
 * lives, and takes no filesystem capability of its own.
 */

/** The environment entry the host sets for the session it owns. */
export const PRINCIPAL_CREDENTIAL_ENV = "OMA_PRINCIPAL_CREDENTIAL";
/** The session this environment belongs to, as the host registered it. */
export const PRINCIPAL_SESSION_ENV = "OMA_PRINCIPAL_SESSION";
/** Bytes of randomness behind a credential, as hex digits. */
export const PRINCIPAL_CREDENTIAL_HEX = 64;
/** Hex digits of a session handle. Shorter than a credential because it names a
 * session rather than authorising one. */
export const PRINCIPAL_SESSION_HEX = 32;

const CREDENTIAL = /^[0-9a-f]{64}$/;
const SESSION = /^[0-9a-f]{32}$/;

export function isPrincipalCredential(value: unknown): value is string {
  return typeof value === "string" && CREDENTIAL.test(value);
}

export function isPrincipalSessionHandle(value: unknown): value is string {
  return typeof value === "string" && SESSION.test(value);
}

/** Compares two credentials without returning early on the first difference.
 *
 * Both sides are the same fixed length by construction, so the loop below runs
 * the same number of times whatever the presented value is, and a caller cannot
 * learn a prefix by timing repeated attempts. A value of the wrong shape is
 * rejected before the comparison, which tells an attacker only what the public
 * grammar above already says.
 */
export function credentialMatches(presented: unknown, expected: string): boolean {
  if (!isPrincipalCredential(presented) || !isPrincipalCredential(expected)) return false;
  return sameFixedString(presented, expected, PRINCIPAL_CREDENTIAL_HEX);
}

/** The handle is compared the same way. It names a session rather than
 * authorising one, but a caller that already holds the credential needs only
 * the handle, so it is the second half of the secret and gets the same
 * treatment. */
export function sessionHandleMatches(presented: unknown, expected: string): boolean {
  if (!isPrincipalSessionHandle(presented) || !isPrincipalSessionHandle(expected)) return false;
  return sameFixedString(presented, expected, PRINCIPAL_SESSION_HEX);
}

function sameFixedString(left: string, right: string, length: number): boolean {
  let difference = 0;
  for (let index = 0; index < length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
