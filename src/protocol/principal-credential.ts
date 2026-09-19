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
 * given only to the trusted extension's environment, never into a sandbox and
 * never onto a model-facing surface (INF-007).
 *
 * This module is a codec: it decides what a credential looks like and where it
 * lives, and takes no filesystem capability of its own.
 */

export const PRINCIPAL_CREDENTIAL_FILE = "principal.cred";
/** The environment entry the host sets for the session it owns. */
export const PRINCIPAL_CREDENTIAL_ENV = "OMA_PRINCIPAL_CREDENTIAL";
/** Bytes of randomness behind a credential, as hex digits. */
export const PRINCIPAL_CREDENTIAL_HEX = 64;

const CREDENTIAL = /^[0-9a-f]{64}$/;

/** Inside the run directory, which is the user's alone and is never mounted
 * into a sandbox. Pure, like the rest of this module. */
export function principalCredentialPath(runRoot: string): string {
  return runRoot.endsWith("/") ? `${runRoot}${PRINCIPAL_CREDENTIAL_FILE}` : `${runRoot}/${PRINCIPAL_CREDENTIAL_FILE}`;
}

export function isPrincipalCredential(value: unknown): value is string {
  return typeof value === "string" && CREDENTIAL.test(value);
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
  let difference = 0;
  for (let index = 0; index < PRINCIPAL_CREDENTIAL_HEX; index += 1)
    difference |= presented.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}
