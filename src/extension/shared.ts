/** Helpers every part of the trusted extension uses. Like the rest of
 * `src/extension/`, this imports no OMA runtime module (PI-001). */

import { validRequestKey } from "./batch-view.js";

export function integerEnv(name: string): number | null {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
export function textResult(text: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: "text" as const, text }], details };
}
/** A value that does not fit its slot is refused before anything is started. */
export function refused(what: string, value: unknown): never {
  throw new Error(`${what} is not valid: ${JSON.stringify(value)?.slice(0, 120)}`);
}
/** The request key a tool call is made under: the model's, if it is one, or a fresh one. */
export function requestKeyOf(value: unknown): string {
  if (value === undefined) return `pi-${crypto.randomUUID()}`;
  return validRequestKey(value) ? value : refused("request key", value);
}
