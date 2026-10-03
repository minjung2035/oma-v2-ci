export interface PrincipalGrant {
  readonly credential: string;
  readonly sessionHandle: string;
}

const CREDENTIAL = /^credential ([0-9a-f]{64}) ([0-9a-f]{32})$/;
export function decodeCredential(line: string): PrincipalGrant | null {
  const match = CREDENTIAL.exec(line);
  return match === null || match[0] !== line ? null : { credential: match[1]!, sessionHandle: match[2]! };
}
export function encodeCredential(grant: PrincipalGrant): string {
  const line = `credential ${grant.credential} ${grant.sessionHandle}`;
  if (decodeCredential(line) === null) throw new TypeError("invalid credential message");
  return `${line}\n`;
}

export interface WaitObservation { readonly accepted: boolean }
export function decodeWaitObservation(value: unknown): WaitObservation {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== 1 || !("accepted" in value) || typeof value.accepted !== "boolean")
    throw new TypeError("Run wait observation was malformed");
  return { accepted: value.accepted };
}
export function encodeWaitObservation(value: unknown): string {
  return JSON.stringify(decodeWaitObservation(value));
}
