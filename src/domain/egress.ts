/** UX-08, DR34: the Human-owned egress allowlist -- the pure half of the
 * proxy's policy. Entries, matching and per-role resolution are values:
 * no IO, no resolver, no sockets. The runtime half (address screening and
 * the one-shot lookup/pin) is in runtime/connect-proxy.ts, because IP grammar
 * is net.isIP's and kernel values import no Node module.
 *
 * An entry is a DNS name, or `*.` plus a suffix covering every subdomain of
 * it. Ports, schemes, paths and address literals are not entries: the wire
 * decides the port (HTTPS's 443 in v0.1) and the resolver decides addresses,
 * each screened at dial time. A name a Resident spells differently (case,
 * trailing dot) is the same name; a name a resolver maps to a private address
 * is not made public by being allowlisted.
 */
import type { HostEgressConfig } from "../../implementation/contracts.js";

const EGRESS_LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
/** A DNS name in its normalized spelling: lowercase, no trailing dot. */
export const EGRESS_NAME_RE = new RegExp(`^${EGRESS_LABEL}(?:\\.${EGRESS_LABEL})*$`);
/** The wire limit on one name is 253 bytes; entries are ASCII so length is bytes. */
export const EGRESS_ENTRY_BYTES = 253;
/** CONNECT's authority grammar admits this charset for a name; every other
 * byte (a second colon, `@`, `/`, `%`, whitespace) is malformed, never a
 * misspelled entry. */
const AUTHORITY_NAME_RE = /^[A-Za-z0-9._-]+$/;
const AUTHORITY_BYTES = 255 + 1 + 5;
/** What a name cannot be: a dotted-quad or bare-number address spelled as a
 * name. Encodings a resolver might reinterpret (0x7f000001, 1.2.3) stay legal
 * grammar -- the resolved-address screen is the gate, not the spelling -- but
 * the plain literal spellings are refused as entries and as targets up front,
 * so an audit line says *what* was refused. */
const ADDRESS_LIKE_RE = /^[0-9.]+$/;

export function egressEntryProblem(entry: unknown): string | null {
  if (typeof entry !== "string" || entry.length === 0) return "an egress entry must be a non-empty string";
  if (entry.length > EGRESS_ENTRY_BYTES) return `an egress entry exceeds ${EGRESS_ENTRY_BYTES} bytes`;
  let name = entry;
  if (name.startsWith("*.")) {
    name = name.slice(2);
    if (name.length === 0) return "a wildcard egress entry must name a suffix";
    // A one-label suffix is TLD-wide (`*.com`): it names no operator and
    // admits a whole registry. The smallest wildcard that means someone is
    // two labels deep.
    if (!name.includes(".")) return "a wildcard egress entry's suffix must be at least two labels";
  } else if (name.includes("*"))
    return "a wildcard egress entry is `*.` followed by a suffix, nothing else";
  if (!EGRESS_NAME_RE.test(name)) return `egress entry ${JSON.stringify(entry)} is not a DNS name`;
  if (ADDRESS_LIKE_RE.test(name)) return `egress entry ${JSON.stringify(entry)} is an address literal, not a name`;
  return null;
}

/** The one spelling a CONNECT target's name is judged by: case-folded, one
 * optional root label (the trailing dot of an absolute name) removed. */
export function normalizeEgressHost(name: string): string {
  const folded = name.toLowerCase();
  return folded.endsWith(".") ? folded.slice(0, -1) : folded;
}

export function egressEntryMatches(entry: string, normalizedHost: string): boolean {
  if (entry.startsWith("*.")) {
    const suffix = entry.slice(2);
    return normalizedHost.length > suffix.length + 1 && normalizedHost.endsWith(`.${suffix}`);
  }
  return normalizedHost === entry;
}

/** The Human's egress clause (HostEgressConfig in the contract) is authored in
 * host.json and validated into HostConfigV1. `roles` is the per-role hook: a
 * role's entries add to the baseline `allow`, so a role the Human has not
 * named still reaches the baseline, and a named role reaches the baseline
 * plus its own. Today the only roles a profile can carry are agentProfiles
 * keys; a future web/MCP/LSP tool resolves its own policy through the same
 * function under a role name the schema then admits. */

/** A role's resolved allowlist: the entries this one caller may CONNECT to.
 * Frozen; handed to the proxy for one delivery's lifetime. */
export interface EgressPolicy {
  readonly role: string;
  readonly allow: readonly string[];
}

/** The egress a role gets: null when the Human configured none, or when this
 * role's resolved set is empty -- an empty allowlist is no socket at all, not
 * a proxy that refuses every target. */
export function egressPolicyFor(egress: HostEgressConfig | undefined, role: string): EgressPolicy | null {
  if (egress === undefined) return null;
  const allow = [...egress.allow, ...(egress.roles?.[role] ?? [])];
  if (allow.length === 0) return null;
  return Object.freeze({ role, allow: Object.freeze(allow) });
}

/** Whether the policy admits CONNECT to a host already normalized by
 * normalizeEgressHost. The port is the caller's to check -- the grammar of
 * what may be reached is names, the admission of a port is the proxy's. */
export function allowsEgressEndpoint(policy: EgressPolicy, normalizedHost: string): boolean {
  return policy.allow.some(entry => egressEntryMatches(entry, normalizedHost));
}

export interface ConnectTarget {
  /** The normalized name the policy and the resolver both see. */
  readonly host: string;
  readonly port: number;
  /** An address literal ([::1], 127.0.0.1) rather than a name. Literals are
   * refused outright: no entry can name one, and a refused literal is clearer
   * audit than a failed match. */
  readonly literal: boolean;
}

/** The strict parse of a CONNECT request's authority (`CONNECT host:port
 * HTTP/1.1`): nothing else is a target. Refuses URI-form URLs, userinfo,
 * missing or non-numeric ports, ports outside 1..65535, and any byte outside
 * the name or bracketed-literal charsets -- the grammar a smuggling or
 * ambiguity attempt must break to mean something else. Returns the problem
 * (for audit) or the target. */
export function parseConnectTarget(url: unknown): { target: ConnectTarget; problem: null } | { target: null; problem: string } {
  if (typeof url !== "string" || url.length === 0) return { target: null, problem: "the CONNECT target is not authority-form" };
  if (url.length > AUTHORITY_BYTES) return { target: null, problem: `the CONNECT target exceeds ${AUTHORITY_BYTES} bytes` };
  let host: string;
  let literal = false;
  let portText: string;
  if (url.startsWith("[")) {
    const close = url.indexOf("]");
    if (close <= 1) return { target: null, problem: "the CONNECT literal is malformed" };
    host = url.slice(1, close);
    literal = true;
    // An IPv6 literal is 45 bytes at most; a longer bracket is not one.
    if (host.length > 45) return { target: null, problem: "the CONNECT literal is malformed" };
    if (url[close + 1] !== ":") return { target: null, problem: "a CONNECT literal must end ]:port" };
    portText = url.slice(close + 2);
  } else {
    const colon = url.lastIndexOf(":");
    if (colon <= 0) return { target: null, problem: "the CONNECT target has no port" };
    host = url.slice(0, colon);
    portText = url.slice(colon + 1);
    if (!AUTHORITY_NAME_RE.test(host)) return { target: null, problem: "the CONNECT host is not a name" };
    if (host.length > EGRESS_ENTRY_BYTES) return { target: null, problem: "the CONNECT host exceeds 253 bytes" };
    if (ADDRESS_LIKE_RE.test(host)) literal = true;
  }
  if (!/^[0-9]{1,5}$/.test(portText)) return { target: null, problem: "the CONNECT port is not numeric" };
  const port = Number(portText);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
    return { target: null, problem: "the CONNECT port is outside 1..65535" };
  return { target: Object.freeze({ host: normalizeEgressHost(host), port, literal }), problem: null };
}

/** The wire grammar of `host` on its own (the egress.connect params the guest
 * carries to the host): the same name-or-literal shape a CONNECT authority
 * holds, without the port. The policy question -- which names may be dialed --
 * is the dialer's, not this grammar's. */
export function connectHostProblem(host: unknown): string | null {
  if (typeof host !== "string" || host.length === 0 || host.length > EGRESS_ENTRY_BYTES)
    return "an egress connect host must be a non-empty string within 253 bytes";
  if (AUTHORITY_NAME_RE.test(host)) return null;
  if (host.startsWith("[") && host.endsWith("]") && /^[0-9a-fA-F:.]+$/.test(host.slice(1, -1))) return null;
  return "an egress connect host is a DNS name or a bracketed literal";
}
