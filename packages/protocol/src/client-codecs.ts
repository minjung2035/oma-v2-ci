/** The Host's own Broker child as the Host privately observed it (Darwin):
 * the kernel pid and full audit token a reply must come from. Attested only by
 * the trusted parent channel; it grants no authority by itself. */
export interface BrokerIdentity { readonly pid: number; readonly token: readonly number[] }
export interface PrincipalGrant {
  readonly credential: string;
  readonly sessionHandle: string;
  readonly broker?: BrokerIdentity;
}
const BROKER = /^broker ([1-9][0-9]{0,9}) ((?:[0-9a-f]{8}){8})$/;
export function decodeBrokerIdentity(line: string): BrokerIdentity | null {
  const match = BROKER.exec(line);
  if (match === null || match[0] !== line) return null;
  const pid = Number(match[1]), token = Array.from({ length: 8 }, (_, index) => Number.parseInt(match[2]!.slice(index * 8, index * 8 + 8), 16));
  return Number.isSafeInteger(pid) && pid > 1 && pid <= 0x7fffffff && token[5] === pid ? Object.freeze({ pid, token: Object.freeze(token) }) : null;
}
export function encodeBrokerIdentity(identity: BrokerIdentity): string {
  const line = `broker ${identity.pid} ${identity.token.map(word => (word >>> 0).toString(16).padStart(8, "0")).join("")}`;
  if (identity.token.length !== 8 || decodeBrokerIdentity(line) === null) throw new TypeError("invalid Broker identity message");
  return `${line}\n`;
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
