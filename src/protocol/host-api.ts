/** MAC-020/021/251: the Host API between the Mac's UIs (OMA.app, the `oma`
 * command) and `omahostd`. Framing and envelopes are the platform's own
 * (§4.2); this module is pure: the version, the hello and the method names.
 */
/** Raised whenever a Host API message's shape or meaning changes. A UI
 * speaks its own and the one before it; `omahostd` speaks its own (MAC-251). */
export const HOST_API_VERSION = 1;

export const HOST_API_METHODS = Object.freeze([
  "engine.status", "engine.start", "engine.stop",
  "society.list", "society.open", "society.close",
  "terminal.attach",
] as const);
export type HostApiMethod = (typeof HOST_API_METHODS)[number];

export interface HostApiHello {
  readonly api: { readonly min: number; readonly max: number };
  /** The login token `omahostd` wrote at its start (MAC-021). */
  readonly token: string;
  readonly client: "oma-app" | "oma-cli";
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const uint = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function hostApiHelloProblem(value: unknown): string | null {
  if (!object(value)) return "hello params must be an object";
  const keys = Object.keys(value).sort().join(",");
  if (keys !== "api,client,token") return "hello params are exactly api, token and client";
  const api = value.api;
  if (!object(api) || Object.keys(api).sort().join(",") !== "max,min" || !uint(api.min) || !uint(api.max) || api.min > api.max)
    return "api must be { min, max } with min <= max";
  if (typeof value.token !== "string" || !/^[0-9a-f]{64}$/.test(value.token)) return "invalid token";
  if (value.client !== "oma-app" && value.client !== "oma-cli") return "unknown client";
  return null;
}
