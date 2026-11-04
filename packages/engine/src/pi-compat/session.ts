/** A6/A7: Pi session evidence is read only through this pinned adapter.
 * Resume admission needs only a header. MCS-X02 additionally inspects the raw
 * original tool call using the public SDK parser; it never migrates history,
 * opens another writable SessionManager or rebuilds model context.
 * The package remains lazily loaded for entries that never inspect sessions. */
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


/** MCS-X02: inspect the pinned engine's raw entries without opening a writable
 * SessionManager, migrating history, building model context or changing its leaf.
 * The SDK parser skips malformed lines; the count check deliberately refuses them. */
export async function sessionInvocationEvidence(text: string,
  origin: { readonly session: string | null; readonly branch: string; readonly toolCall: string },
  tool: string, expectedArguments: string, canonical: (value: unknown) => string,
): Promise<{ readonly session: string; readonly parent: string | null; readonly containsCall: boolean }> {
  const { CURRENT_SESSION_VERSION, parseSessionEntries } = await import("@earendil-works/pi-coding-agent");
  const invalid = (): never => { throw new Error("original Pi invocation evidence is unavailable or inconsistent"); };
  if (!text.endsWith("\n")) return invalid();
  const lines = text.slice(0, -1).split("\n");
  if (lines.some(line => line.trim().length === 0)) return invalid();
  const entries = parseSessionEntries(text);
  if (entries.length !== lines.length) return invalid();
  const header = entries[0];
  if (!header || header.type !== "session" || header.version !== CURRENT_SESSION_VERSION ||
      (origin.session !== null && header.id !== origin.session) || typeof header.id !== "string" || !SESSION_ID.test(header.id) || typeof header.cwd !== "string" ||
      typeof header.timestamp !== "string" || !Number.isFinite(Date.parse(header.timestamp)) ||
      (header.parentSession !== undefined && typeof header.parentSession !== "string")) return invalid();
  const ids = new Set<string>();
  let containsCall = false;
  for (const entry of entries.slice(1)) {
    if (entry.type === "session" || typeof entry.id !== "string" || !SESSION_ID.test(entry.id) || ids.has(entry.id) ||
        (entry.parentId !== null && (typeof entry.parentId !== "string" || !ids.has(entry.parentId)))) return invalid();
    ids.add(entry.id);
    if (entry.id !== origin.branch) continue;
    if (entry.type !== "message" || entry.message?.role !== "assistant" || !Array.isArray(entry.message.content)) return invalid();
    const calls = entry.message.content.filter(block => block?.type === "toolCall" && block.id === origin.toolCall);
    if (calls.length !== 1) return invalid();
    const call = calls[0];
    if (!call || call.type !== "toolCall" || call.name !== tool || canonical(call.arguments) !== expectedArguments) return invalid();
    containsCall = true;
  }
  return { session: header.id, parent: header.parentSession ?? null, containsCall };
}
