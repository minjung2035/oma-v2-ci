/** Protected completion before send. A failure diagnostic is not the proof:
 * the original host owner must atomically close a still-unprepared invocation. */
import type { Failure } from "@oma/contracts";
import type { InvocationPreacceptReason, InvocationRejection } from "@oma/contracts/public-wire";
import { canonicalCollaborationJson } from "@oma/domain/collaboration-targets";
import { decodeFailure, type Decoded } from "./failure-codec.js";

const REASONS: readonly InvocationPreacceptReason[] = ["INVALID_ARGUMENT", "SOURCE_UNREADABLE", "SOURCE_CHANGED", "STALE_TARGET",
  "WRONG_TARGET_KIND", "CAPACITY_FULL", "AUTHORITY_DENIED", "GOAL_REVISION_CHANGED", "NEEDS_OPERATOR"];
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Classifies only the diagnostic. This function cannot establish nonacceptance. */
export function invocationPreacceptReason(failure: Failure, tool: string): InvocationPreacceptReason | null {
  if (["BROKER_UNAVAILABLE", "DEADLINE_EXCEEDED", "STORE_CORRUPT", "DB_BUSY", "STORAGE_FULL", "REQUEST_KEY_REUSED", "REQUEST_NOT_FOUND", "STREAM_INVALID"].includes(failure.code)) return null;
  if (failure.code === "INVALID_REQUEST" || failure.code === "CAPABILITY_DENIED") {
    for (const reason of ["SOURCE_UNREADABLE", "SOURCE_CHANGED", "STALE_TARGET", "WRONG_TARGET_KIND"] as const)
      if (failure.message.startsWith(`${reason}:`)) return reason;
  }
  if (["AUTH_FAILED", "STALE_RUN", "CAPABILITY_DENIED"].includes(failure.code)) return "AUTHORITY_DENIED";
  if (failure.code === "CONTEXT_CONFLICT" && tool === "oma_goal") return "GOAL_REVISION_CHANGED";
  if (failure.code === "LIMIT_EXCEEDED" && tool === "oma_spawn" && object(failure.details) && failure.details.resource === "workers") return "CAPACITY_FULL";
  if (["INVALID_REQUEST", "INVALID_OID", "BUNDLE_INVALID", "PREREQUISITE_MISSING", "NOT_DESCENDANT", "PROTECTED_PATH"].includes(failure.code)) return "INVALID_ARGUMENT";
  if (["UNSUPPORTED_PROFILE", "SPIKE_UNRESOLVED", "GOAL_REQUIRED", "AGENT_CONFLICT", "AGENT_NOT_READY", "AGENT_RETIRED", "ADDRESS_NOT_FOUND", "REQUEST_CLOSED", "REQUEST_EXISTS"].includes(failure.code)) return "NEEDS_OPERATOR";
  return null;
}
export function decodeInvocationRejection(raw: unknown): Decoded<InvocationRejection> {
  try {
    const row: unknown = JSON.parse(canonicalCollaborationJson(raw));
    if (!object(row) || Object.keys(row).sort().join(",") !== "failure,observedAtMs,proof,reason,source" ||
        row.proof !== "protected-invocation-closed-before-send" || (row.source !== "caller-preparation" && row.source !== "host-preflight") ||
        typeof row.reason !== "string" || !REASONS.some(reason => reason === row.reason) || typeof row.observedAtMs !== "number" ||
        !Number.isSafeInteger(row.observedAtMs) || row.observedAtMs < 0 || !Number.isFinite(new Date(row.observedAtMs).getTime()))
      return { ok: false, reason: "invalid closed original preaccept completion" };
    const failure = decodeFailure(row.failure);
    if (!failure.ok) return failure;
    return { ok: true, value: { proof: "protected-invocation-closed-before-send", source: row.source,
      reason: row.reason as InvocationPreacceptReason, observedAtMs: row.observedAtMs, failure: failure.value } };
  } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : "invalid preaccept completion" }; }
}
export function invocationRejectionGuidance(reason: InvocationPreacceptReason): string {
  switch (reason) {
    case "INVALID_ARGUMENT": return "No request was submitted. Fix the named input field and call the same action again.";
    case "SOURCE_UNREADABLE": return "The source could not be read safely. No request was submitted. Use a readable file or inline text; do not assume the missing file was empty.";
    case "SOURCE_CHANGED": return "The source changed while it was being frozen. No request was submitted. Inspect the source and submit the intended version.";
    case "STALE_TARGET": return "No decision was recorded. This target no longer names the current review scope. Read the current status and exact change before deciding again.";
    case "WRONG_TARGET_KIND": return "No effect was requested. Use a review target for a verdict, your submission target for proposal withdrawal, or your vote target for vote withdrawal.";
    case "CAPACITY_FULL": return "No new Worker creation was accepted. Enabled Worker capacity is full; waiting does not release a slot. Reuse a suitable peer or request a Human resource decision.";
    case "AUTHORITY_DENIED": return "The current actor is not authorized for this effect. Tool visibility or a peer message does not grant that permission.";
    case "GOAL_REVISION_CHANGED": return "No GOAL update was accepted. Read the current GOAL and context revision, reconcile the intended change, and publish with that exact expectation.";
    case "NEEDS_OPERATOR": return "This original invocation was closed before send. No request was submitted. Its original failure is preserved; inspect the permitted records or ask for a Human recovery decision.";
  }
}
