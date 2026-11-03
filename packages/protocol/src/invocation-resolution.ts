/** Protected no-effect outcomes of original collaboration invocations. These
 * are linkage evidence, not accepted attestations or authority to retry. */
import type { Json } from "@oma/contracts";
import type { InvocationResolution } from "@oma/contracts/public-wire";
import { isValidRequestKey } from "@oma/domain/identifiers";
import { sha256Hex } from "@oma/domain/canonical-json";
import { canonicalCollaborationJson, decodeCollaborationTarget } from "@oma/domain/collaboration-targets";
import type { CollaborationExistingPreparation } from "@oma/domain/collaboration-review";
import { decodeReceipt, type Decoded } from "./receipt-codec.js";

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const closed = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const invalid = (reason: string): Decoded<never> => ({ ok: false, reason });
function proposal(raw: unknown): CollaborationExistingPreparation["target"] {
  const text = canonicalCollaborationJson(raw), target = decodeCollaborationTarget(Buffer.from(text, "utf8"), `proposal-${sha256Hex(text)}.json`);
  if (target.kind !== "proposal" || target.settledFailure !== null) throw new TypeError("existing resolution requires an unchanged, non-failed proposal");
  return target;
}
export function decodeExistingPreparation(raw: unknown): Decoded<CollaborationExistingPreparation> {
  try {
    const row: unknown = JSON.parse(canonicalCollaborationJson(raw));
    if (!object(row) || !closed(row, ["kind", "target"]) || row.kind !== "collaboration.existing") return invalid("invalid closed existing preparation");
    return { ok: true, value: { kind: "collaboration.existing", target: proposal(row.target) } };
  } catch (error) { return invalid(error instanceof Error ? error.message : "invalid existing preparation"); }
}
export function decodeInvocationResolution(raw: unknown): Decoded<InvocationResolution> {
  try {
    const row: unknown = JSON.parse(canonicalCollaborationJson(raw));
    if (!object(row) || !closed(row, ["kind", "target", "requestKey", "receipt", "observedAtMs"]) || row.kind !== "existing" ||
        !isValidRequestKey(row.requestKey) || typeof row.observedAtMs !== "number" || !Number.isSafeInteger(row.observedAtMs) || row.observedAtMs < 0 || !Number.isFinite(new Date(row.observedAtMs).getTime()))
      return invalid("invalid closed invocation resolution");
    const target = proposal(row.target), receipt = decodeReceipt(row.receipt, { expectedKind: "attest.record" });
    if (!receipt.ok || receipt.value.operation !== target.request) return invalid("existing receipt does not belong to the exact referenced request");
    const targetJson: Json = JSON.parse(canonicalCollaborationJson(target));
    return { ok: true, value: { kind: "existing", target: targetJson, requestKey: row.requestKey, receipt: receipt.value, observedAtMs: row.observedAtMs } };
  } catch (error) { return invalid(error instanceof Error ? error.message : "invalid invocation resolution"); }
}
/** Complete evidence is written in the original protected freeze before its
 * binding is checkpointed. Recovery reads it, never the current proposal. */
export function decodeFrozenInvocationResolution(raw: unknown): Decoded<InvocationResolution> {
  try {
    const row: unknown = JSON.parse(canonicalCollaborationJson(raw));
    if (!object(row) || !closed(row, ["kind", "target", "resolution"]) || row.kind !== "collaboration.existing") return invalid("invalid closed completed resolution");
    const resolution = decodeInvocationResolution(row.resolution);
    if (!resolution.ok) return resolution;
    const target = proposal(row.target);
    if (canonicalCollaborationJson(target) !== canonicalCollaborationJson(resolution.value.target)) return invalid("completed resolution changed its exact target");
    return resolution;
  } catch (error) { return invalid(error instanceof Error ? error.message : "invalid completed invocation resolution"); }
}
