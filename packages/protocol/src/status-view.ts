/** TUI-021: the status view's single owner — where it lives, how often it is
 * refreshed, and what a valid one looks like.
 *
 * The broker writes it and the Human's terminal reads it. Both sides go through
 * this module so the writer cannot drift from what the reader accepts, and the
 * reader never has to guess: a view that is missing, malformed, from another
 * society or older than a few refresh intervals is reported as unknown with the
 * reason, not shown as current.
 */
import type { AgentStatus } from "@oma/contracts";

/** The reason a status row gives for an observed absent managed execution:
 * an observed absence, unlike a row with no reason and no state (not observed).
 * Written by the projection and read by the Dashboard (P0V-39, P0-2). */
export const NO_UNIT_REASON = "no managed Resident execution";
export const STATUS_VIEW_FILE = "status.json";
/** How often the broker republishes while nothing else refreshes the view. */
export const STATUS_REFRESH_MS = 5000;
/** Beyond this a view is stale: the broker is gone or stuck, not quiet. */
export const STATUS_STALE_MS = 4 * STATUS_REFRESH_MS;

/** Host-private and outside `world/`, which Residents mount. */
export function statusViewPath(stateRoot: string): string {
  // Pure on purpose: this module is a codec and takes no filesystem capability.
  return stateRoot.endsWith("/") ? `${stateRoot}${STATUS_VIEW_FILE}` : `${stateRoot}/${STATUS_VIEW_FILE}`;
}

export interface StatusView {
  readonly observedAtMs: number;
  readonly agents: readonly AgentStatus[];
}

export function encodeStatusView(society: string, view: StatusView): string {
  return `${JSON.stringify({ schema: 1, society, observedAtMs: view.observedAtMs, agents: view.agents })}\n`;
}

const DESIRED = Object.freeze(new Set(["provisioning", "enabled", "stopped", "retired"]));
const nullableString = (value: unknown): boolean => value === null || typeof value === "string";
const nullableInt = (value: unknown): boolean => value === null || Number.isSafeInteger(value);
const count = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) >= 0;

function isAgentStatus(value: unknown): value is AgentStatus {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.agent === "string" && row.agent.length > 0 && typeof row.desired === "string" && DESIRED.has(row.desired) &&
    nullableString(row.activeState) && nullableString(row.subState) && nullableString(row.unitResult) &&
    nullableInt(row.execMainStatus) && count(row.pending) && count(row.preparedBatches) &&
    nullableString(row.reason) && nullableInt(row.runnerObservedAtMs);
}

export type DecodedStatusView =
  | { readonly kind: "view"; readonly view: StatusView }
  | { readonly kind: "invalid"; readonly reason: string };

/** Shape only; staleness is the reader's decision because it owns the clock. */
export function decodeStatusView(text: string, society: string): DecodedStatusView {
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch { return { kind: "invalid", reason: "status view is not JSON" }; }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return { kind: "invalid", reason: "status view is not an object" };
  const value = raw as Record<string, unknown>;
  if (value.schema !== 1) return { kind: "invalid", reason: "status view has an unknown schema" };
  if (value.society !== society) return { kind: "invalid", reason: "status view belongs to another society" };
  if (!Number.isSafeInteger(value.observedAtMs) || (value.observedAtMs as number) <= 0)
    return { kind: "invalid", reason: "status view has no observation time" };
  if (!Array.isArray(value.agents) || !value.agents.every(isAgentStatus))
    return { kind: "invalid", reason: "status view has a malformed agent row" };
  return {
    kind: "view",
    view: Object.freeze({
      observedAtMs: value.observedAtMs as number,
      agents: Object.freeze(value.agents.map(row => Object.freeze({ ...row }))) as readonly AgentStatus[],
    }),
  };
}

export type Observation =
  | { readonly kind: "observed"; readonly statuses: readonly AgentStatus[]; readonly observedAtMs: number }
  | { readonly kind: "unknown"; readonly reason: string; readonly observedAtMs: number };
