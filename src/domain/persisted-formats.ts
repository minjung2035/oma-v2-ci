/** P8: persisted format inventory, version boundary and portability policy.
 *
 * This module is pure metadata plus read-only classification. It never decodes
 * a row into a workflow value, never rewrites accepted bytes, never re-derives a
 * legacy plan from the current state root, and never upgrades a legacy plan.
 * Historical plan/result JSON is not rewritten by schema migration.
 */
import { isValidFullOid } from "./identifiers.js";
import { isMutationMethod } from "../protocol/receipt-codec.js";

/** The version this build reads and writes. v0.1.0 is a pre-release: no
 * backward compatibility with development-time formats is owed, so the only
 * readable version is the one this build writes. Any other persisted version
 * is fail-closed: no migration is attempted and no rewrite happens. */
export const SCHEMA_USER_VERSION_WRITTEN = 3;
export const SCHEMA_USER_VERSION_READABLE: readonly number[] = Object.freeze([SCHEMA_USER_VERSION_WRITTEN]);
export const WIRE_PROTOCOL_VERSION = 1;
/** Existing operation shapes remain v1-readable. DR27 adds a closed mutation
 * without rewriting any historical plan or declaring a new JSON envelope. */
export const PLAN_FORMAT_WRITTEN = "v1" as const;
export const PLAN_FORMAT_READABLE: readonly string[] = Object.freeze(["v1"]);

export type PersistedFieldClass =
  | "intrinsic-identity"      // operation/actor/message identity
  | "immutable-logical-fact"  // frozen recipients, kind, reply ancestry, policy revision
  | "derived-durable-identity" // ref/path derived from validated identity, no host root
  | "host-derived-physical-locator" // contains the state root; not portable
  | "reconstructable-presentation"  // display path/view, rebuildable
  | "historical-result";      // terminal result bytes

export interface PersistedField {
  readonly kind: string;
  readonly field: string;
  readonly class: PersistedFieldClass;
}

/** v1 plan fields by class. Verified against `implementation/contracts/durable.ts`
 * and the relation validators in `src/durable.ts`; the table is evidence, not a
 * second validator. */
export const V1_PLAN_FIELDS: readonly PersistedField[] = Object.freeze([
  { kind: "*", field: "id", class: "intrinsic-identity" },
  { kind: "*", field: "actor", class: "intrinsic-identity" },
  { kind: "*", field: "requestKey", class: "intrinsic-identity" },
  { kind: "mail.send", field: "message.id", class: "intrinsic-identity" },
  { kind: "mail.send", field: "message.to", class: "immutable-logical-fact" },
  { kind: "mail.send", field: "message.recipients", class: "immutable-logical-fact" },
  { kind: "mail.send", field: "message.kind", class: "immutable-logical-fact" },
  { kind: "mail.send", field: "message.contextRevision", class: "immutable-logical-fact" },
  { kind: "mail.send", field: "message.replyHeaders", class: "immutable-logical-fact" },
  { kind: "mail.send", field: "message.objectPath", class: "derived-durable-identity" },
  { kind: "mail.send", field: "message.sha256", class: "immutable-logical-fact" },
  { kind: "mail.send", field: "message.bytes", class: "immutable-logical-fact" },
  { kind: "mail.send", field: "message.dateMs", class: "immutable-logical-fact" },
  { kind: "agent.create", field: "spec", class: "immutable-logical-fact" },
  { kind: "agent.create", field: "specHash", class: "derived-durable-identity" },
  { kind: "agent.create", field: "workspacePath", class: "host-derived-physical-locator" },
  { kind: "agent.create", field: "unitNames", class: "derived-durable-identity" },
  { kind: "git.submit", field: "publishedRef", class: "derived-durable-identity" },
  { kind: "git.submit", field: "bundle.path", class: "host-derived-physical-locator" },
  { kind: "git.submit", field: "bundle.sha256", class: "immutable-logical-fact" },
  { kind: "context.publish", field: "stagingPath", class: "host-derived-physical-locator" },
  { kind: "context.publish", field: "entries", class: "immutable-logical-fact" },
  { kind: "context.publish", field: "candidate", class: "derived-durable-identity" },
  { kind: "*", field: "result", class: "historical-result" },
]);
export const HOST_DERIVED_PLAN_FIELDS: readonly string[] = Object.freeze(
  [...new Set(V1_PLAN_FIELDS.filter(field => field.class === "host-derived-physical-locator").map(field => field.field))]);

export type PlanFormatClassification = { readonly format: "v1" } | { readonly format: "unknown"; readonly reason: string };

/** Shape classifier, not a validator: decoding still runs the closed plan check
 * and the relation checks. A shape this build does not recognize is `unknown`,
 * which means fail closed - never "upgrade" and never "rewrite". */
export function classifyPersistedPlan(value: unknown): PlanFormatClassification {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return { format: "unknown", reason: "plan is not an object" };
  const plan = value as Record<string, unknown>;
  // The closed kind set is owned by the protocol method table, never restated here.
  if (!isMutationMethod(plan.kind)) return { format: "unknown", reason: "plan kind is outside the persisted kind set" };
  if (typeof plan.version === "string") return { format: "unknown", reason: `plan declares format ${plan.version}, which this build does not read` };
  if (plan.kind === "agent.create" && typeof plan.workspacePath !== "string") return { format: "unknown", reason: "v1 create plan has no workspace locator" };
  if (plan.kind === "git.submit" && plan.bundle !== null && typeof (plan.bundle as { path?: unknown })?.path !== "string")
    return { format: "unknown", reason: "v1 submit bundle has no staging locator" };
  if (plan.kind === "context.publish" && typeof plan.stagingPath !== "string") return { format: "unknown", reason: "v1 context plan has no staging locator" };
  return { format: "v1" };
}

export interface PlanPortabilityFinding {
  readonly kind: string;
  readonly fields: readonly string[];
  readonly portable: boolean;
}
/** Read-only portability report: which accepted plans carry host-derived
 * locators. It reports; it does not repair, re-derive or rewrite. A state root
 * moved to another path keeps readable v1 bytes and a non-portable locator set
 * that a host must account for before restore. */
export function planPortability(plans: readonly { readonly kind: string; readonly plan: unknown }[]): readonly PlanPortabilityFinding[] {
  const findings: PlanPortabilityFinding[] = [];
  for (const entry of plans) {
    const classification = classifyPersistedPlan(entry.plan);
    if (classification.format !== "v1") { findings.push(Object.freeze({ kind: entry.kind, fields: Object.freeze([]), portable: false })); continue; }
    if (entry.kind === "agent.create") findings.push(Object.freeze({ kind: entry.kind, fields: Object.freeze(["workspacePath"]), portable: false }));
    else if (entry.kind === "git.submit") findings.push(Object.freeze({ kind: entry.kind, fields: Object.freeze((entry.plan as { bundle?: unknown }).bundle === null ? [] : ["bundle.path"]), portable: false }));
    else if (entry.kind === "context.publish") findings.push(Object.freeze({ kind: entry.kind, fields: Object.freeze(["stagingPath"]), portable: false }));
    else findings.push(Object.freeze({ kind: entry.kind, fields: Object.freeze([]), portable: true }));
  }
  return Object.freeze(findings);
}

/** Terminal result bytes are historical facts, not recomputable fields. */
export function isHistoricalResult(value: unknown): boolean {
  return value === null || typeof value === "string";
}

/** A v1 Git OID locator is readable only in its own repository object format. */
export function oidMatchesFormat(oid: string, format: "sha1" | "sha256"): boolean {
  return isValidFullOid(oid) && oid.length === (format === "sha1" ? 40 : 64);
}
