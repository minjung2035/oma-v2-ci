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
/** S-01: positive caps enable the owned state-tree admission implementation. */
export function assertStorageQuotaSupported(storageBytes: number): void {
  if (!Number.isSafeInteger(storageBytes) || storageBytes <= 0)
    throw new StoreError("UNSUPPORTED_PROFILE", "storage quota must be a positive safe integer");
}
