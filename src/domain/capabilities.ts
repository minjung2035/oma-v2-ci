/** CFG-005/CREATE-002: vocabulary only; no role grants or storage/effect dependency. */
export const CAPABILITIES = Object.freeze([
  "mail.send",
  "route.follow",
  "agent.create",
  "agent.manage.self",
  "agent.manage.descendants",
  "git.submit",
  "code.integrate",
  "context.publish",
] as const);

export type Capability = (typeof CAPABILITIES)[number];

const known: ReadonlySet<string> = new Set(CAPABILITIES);

export function isCapability(value: unknown): value is Capability {
  return typeof value === "string" && known.has(value);
}

/** The caller owns phase-specific error mapping, not this vocabulary. */
export function capabilityCheck(value: unknown): string | null {
  return isCapability(value) ? null : "invalid capability";
}
