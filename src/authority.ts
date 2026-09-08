// MUST [AUTH-001/002/003, CREATE-002]: single ownership of capability parsing.
// The ONLY authoritative capability source is the broker-resolved spec
// persisted in agents.spec_json; capabilities are never derived from role.
import type { Capability } from "../implementation/contracts.js";
import { isValidFullOid } from "./ids.js";

/** Closed capability set (contracts.ts Capability union). */
const KNOWN_CAPABILITIES: ReadonlySet<string> = new Set([
  "mail.send",
  "route.follow",
  "agent.create",
  "agent.manage.self",
  "agent.manage.descendants",
  "git.submit",
  "code.integrate",
  "context.publish",
]);
const SPEC_FIELDS = ["name", "from", "brief", "profile", "capabilities"] as const;
const SPEC_FIELD_SET: ReadonlySet<string> = new Set(SPEC_FIELDS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlySpecFields(value: Record<string, unknown>): boolean {
  return Object.keys(value).every((key) => SPEC_FIELD_SET.has(key));
}


/**
 * Parse the capabilities from a resolved spec's spec_json. Fail closed (empty
 * set) when the spec is missing or not a valid ResolvedAgentSpec.
 */
export function capabilitiesOf(agent: {
  specJson: string;
}): ReadonlySet<Capability> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(agent.specJson);
  } catch {
    return new Set();
  }
  if (!isRecord(parsed) || !hasOnlySpecFields(parsed)) return new Set();
  if (typeof parsed.name !== "string" || parsed.name.length === 0 ||
    typeof parsed.from !== "string" || !isValidFullOid(parsed.from) ||
    typeof parsed.brief !== "string" || typeof parsed.profile !== "string" ||
    !Array.isArray(parsed.capabilities)) return new Set();
  const out = new Set<Capability>();
  for (const c of parsed.capabilities) {
    if (typeof c !== "string" || !KNOWN_CAPABILITIES.has(c)) return new Set();
    out.add(c as Capability);
  }
  return out;
}
