/** CONNECT destination grammar. Every destination and port is available;
 * address parsing never grants a run, credential or tunnel ownership. */
const CONNECT_HOST_BYTES = 253;
/** CONNECT's authority grammar admits this charset for a name; every other
 * byte (a second colon, `@`, `/`, `%`, whitespace) is malformed, never a
 * misspelled entry. */
const AUTHORITY_NAME_RE = /^[A-Za-z0-9._-]+$/;
const AUTHORITY_BYTES = 255 + 1 + 5;
/** What a name cannot be: a dotted-quad or bare-number address spelled as a
 * name. CONNECT targets may use these literals. */
const ADDRESS_LIKE_RE = /^[0-9.]+$/;

/** The one spelling a CONNECT target's name is judged by: case-folded, one
 * optional root label (the trailing dot of an absolute name) removed. */
export function normalizeEgressHost(name: string): string {
  const folded = name.toLowerCase();
  return folded.endsWith(".") ? folded.slice(0, -1) : folded;
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
    if (host.length > CONNECT_HOST_BYTES) return { target: null, problem: "the CONNECT host exceeds 253 bytes" };
    if (ADDRESS_LIKE_RE.test(host)) literal = true;
  }
  if (!/^[0-9]{1,5}$/.test(portText)) return { target: null, problem: "the CONNECT port is not numeric" };
  const port = Number(portText);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
    return { target: null, problem: "the CONNECT port is outside 1..65535" };
  return { target: Object.freeze({ host: normalizeEgressHost(host), port, literal }), problem: null };
}
