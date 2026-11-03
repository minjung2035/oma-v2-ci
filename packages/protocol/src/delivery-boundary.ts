/** Persisted delivery protocol revision, not the installed SDK package version.
 * Retain these evidence bytes across SDK upgrades unless the boundary contract changes. */
export const PI_ADAPTER_REVISION = "oma-pi-rpc-v1@1.0.1";
export const PI_BOUNDARY_PREFIX = "OMA_PI_BOUNDARY_V1 ";
export const PI_WAIT_PREFIX = "OMA_PI_WAIT_V1 ";
export const PI_WAIT_OBSERVATION_PREFIX = "OMA_PI_WAIT_OBSERVATION_V1 ";

/** Preflight refusal only, never delivery/receipt evidence or a run deadline. */
export const PI_DELIVERY_NOT_STARTED_PREFIX = "OMA_PI_DELIVERY_NOT_STARTED_V1 ";
export function deliveryNotStartedOf(event: unknown): { readonly batchId: string; readonly reason: "unavailable" | "invalid-batch" } | null {
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const notice = event as Record<string, unknown>;
  if (notice.type !== "extension_ui_request" || notice.method !== "notify" || typeof notice.message !== "string" || !notice.message.startsWith(PI_DELIVERY_NOT_STARTED_PREFIX)) return null;
  let raw: unknown;
  try { raw = JSON.parse(notice.message.slice(PI_DELIVERY_NOT_STARTED_PREFIX.length)); } catch { return null; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).sort().join() !== "adapterRevision,batchId,reason" || value.adapterRevision !== PI_ADAPTER_REVISION ||
      typeof value.batchId !== "string" || !/^b-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.batchId) ||
      (value.reason !== "unavailable" && value.reason !== "invalid-batch")) return null;
  return { batchId: value.batchId, reason: value.reason };
}
