/** A6/A7: the one Pi session-file judgement OMA makes itself. A resume's
 * admission probe reads only the first header line -- everything else in the
 * file is the engine's SessionManager's, which exposes no header-only read --
 * so the shape of that one line is stated here, with the version bound the
 * vendored engine itself declares.
 *
 * The engine package is loaded lazily, as the probe was before: an entry that
 * never resumes a session never pays for the engine's module graph.
 */
const SESSION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/** The identity a parsed first line vouches for, or null when it is not a
 * session header this engine could have written at `expectedCwd`. `version`
 * must equal this build's pinned engine format. Older/missing headers do not
 * acquire an OMA birth by being reinterpreted. */
export async function sessionHeaderIdentity(header: unknown, expectedCwd: string): Promise<{ id: string; timestamp: string } | null> {
  const { CURRENT_SESSION_VERSION } = await import("@earendil-works/pi-coding-agent");
  if (!header || typeof header !== "object" || Array.isArray(header)) return null;
  const value = header as Record<string, unknown>;
  if (value.type !== "session" || typeof value.id !== "string" || !SESSION_ID.test(value.id)) return null;
  if (typeof value.timestamp !== "string" || !Number.isFinite(Date.parse(value.timestamp))) return null;
  if (value.cwd !== expectedCwd) return null;
  if (value.version !== CURRENT_SESSION_VERSION) return null;
  return { id: value.id, timestamp: value.timestamp };
}
