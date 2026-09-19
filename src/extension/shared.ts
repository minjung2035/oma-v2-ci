/** Helpers every part of the trusted extension uses. Like the rest of
 * `src/extension/`, this imports no OMA runtime module (PI-001). */

export function integerEnv(name: string): number | null {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
export function textResult(text: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: "text" as const, text }], details };
}
