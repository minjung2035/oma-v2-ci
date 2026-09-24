/** CFG-005/LIFE-008: closed resource declarations for supported profiles. */
import { integerFieldsCheck, type IntegerField, type IntegerRecord } from "./integer-fields.js";
import type { ResourceLimits } from "../../implementation/contracts/host.js";
import { StoreError } from "./errors.js";

export const RESOURCE_FIELDS = Object.freeze({
  memoryBytes: Object.freeze({ minInclusive: 1, unit: "bytes" }),
  tasks: Object.freeze({ minInclusive: 1, unit: "count" }),
  cpuQuotaPercent: Object.freeze({ minInclusive: 1, unit: "percent" }),
  tmpBytes: Object.freeze({ minInclusive: 1, unit: "bytes" }),
  workspaceBytes: Object.freeze({ minInclusive: 1, unit: "bytes" }),
  stagingBytes: Object.freeze({ minInclusive: 1, unit: "bytes" }),
  checkTimeoutSeconds: Object.freeze({ minInclusive: 1, unit: "seconds" }),
} satisfies Record<string, IntegerField>);

export type { ResourceLimits };

/** Compile-time exhaustiveness: the descriptor and the contract must name the
 * same fields. A field added to one without the other fails the build.
 */
type MissingDescriptor = Exclude<keyof ResourceLimits, keyof typeof RESOURCE_FIELDS>;
type MissingContractKey = Exclude<keyof typeof RESOURCE_FIELDS, keyof ResourceLimits>;
const _descriptorCoversContract: [MissingDescriptor] extends [never] ? true : never = true;
const _contractCoversDescriptor: [MissingContractKey] extends [never] ? true : never = true;
void _descriptorCoversContract;
void _contractCoversDescriptor;
const _shape: IntegerRecord<typeof RESOURCE_FIELDS> extends ResourceLimits ? true : never = true;
void _shape;
export const resourceLimitsCheck = integerFieldsCheck(RESOURCE_FIELDS);

export function isResourceLimits(value: unknown): value is ResourceLimits {
  return resourceLimitsCheck(value) === null;
}

/** D05/WP25: the one text form of an accepted resource spec that a unit
 * carries to its runner, fields in descriptor order. */
export function canonicalResourceLimits(limits: ResourceLimits): string {
  if (!isResourceLimits(limits)) throw new StoreError("UNSUPPORTED_PROFILE", "resource limits are not a valid accepted spec");
  return JSON.stringify(Object.fromEntries(Object.keys(RESOURCE_FIELDS).map(key => [key, limits[key as keyof ResourceLimits]])));
}

/** The inverse, strict: anything but the canonical text of a valid spec is
 * refused, so a runner never reads resources the broker did not render. */
export function parseCanonicalResourceLimits(text: string): ResourceLimits | null {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  return isResourceLimits(value) && canonicalResourceLimits(value) === text ? value : null;
}
/** S-01: positive caps enable the owned state-tree admission implementation. */
export function assertStorageQuotaSupported(storageBytes: number): void {
  if (!Number.isSafeInteger(storageBytes) || storageBytes <= 0)
    throw new StoreError("UNSUPPORTED_PROFILE", "storage quota must be a positive safe integer");
}
