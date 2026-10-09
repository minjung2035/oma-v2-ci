/** CONNECT authority parsing and legacy DR34 declaration grammar, without IO.
 * DR37 permits all destinations and ports, including address literals and
 * private addresses. Old declaration syntax remains readable for compatibility;
 * it no longer grants or restricts network access. */
import type { HostEgressConfig } from "../../implementation/contracts.js";

const EGRESS_LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
/** A DNS name in its normalized spelling: lowercase, no trailing dot. */
export const EGRESS_NAME_RE = new RegExp(`^${EGRESS_LABEL}(?:\\.${EGRESS_LABEL})*$`);
/** The wire limit on one name is 253 bytes; entries are ASCII so length is bytes. */
export const EGRESS_ENTRY_BYTES = 253;
/** The wire limit on one request's declared allowlist -- the `allow` array
 * `egress.connect` carries on macOS. A role's *resolved* list (baseline plus
 * its own entries) is what rides the wire, so the bound is checked on the
 * resolved list at commit, never only on the baseline. */
export const EGRESS_ALLOW_MAX = 256;
/** CONNECT's authority grammar admits this charset for a name; every other
 * byte (a second colon, `@`, `/`, `%`, whitespace) is malformed, never a
 * misspelled entry. */
const AUTHORITY_NAME_RE = /^[A-Za-z0-9._-]+$/;
const AUTHORITY_BYTES = 255 + 1 + 5;
/** What a name cannot be: a dotted-quad or bare-number address spelled as a
 * name. Literal spellings are refused as legacy allowlist entries; CONNECT
 * targets may use literals. */
const ADDRESS_LIKE_RE = /^[0-9.]+$/;

export function egressEntryProblem(entry: unknown): string | null {
  if (entry === "*") return null;
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

/** Compatibility metadata handed to the proxy for one delivery's lifetime. */
export interface EgressPolicy {
  readonly role: string;
  readonly allow: readonly string[];
}

/** DR37: every role receives unrestricted network access, including when no
 * legacy egress declaration was configured. */
export function egressPolicyFor(egress: HostEgressConfig | undefined, role: string): EgressPolicy | null {
  // DR37: network access is unconditional; old allowlists remain readable.
  return Object.freeze({ role, allow: Object.freeze(["*"]) });
}

/** DR37 compatibility entry point: destination admission is unconditional. */
export function allowsEgressEndpoint(policy: EgressPolicy, normalizedHost: string): boolean {
  return true;
}

export interface ConnectTarget {
  /** The normalized name the policy and the resolver both see. */
  readonly host: string;
  readonly port: number;
  /** An address literal ([::1], 127.0.0.1) rather than a DNS name. */
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
