/** CFG-005/LIFE-008: declarations are not proof of kernel resource enforcement. */
import { integerFieldsCheck, type IntegerField, type IntegerRecord } from "./integer-fields.js";
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

export type ResourceLimits = IntegerRecord<typeof RESOURCE_FIELDS>;
export const resourceLimitsCheck = integerFieldsCheck(RESOURCE_FIELDS);

export function isResourceLimits(value: unknown): value is ResourceLimits {
  return resourceLimitsCheck(value) === null;
}

/** S-01 / SP-003: no supported filesystem quota profile is qualified yet.
 * Do not replace this with a sampled tree size, logical byte estimate or caller
 * boolean: none bounds workspace writers, Git expansion and recovery headroom. */
export function assertStorageQuotaSupported(storageBytes: number): void {
  if (!Number.isSafeInteger(storageBytes) || storageBytes <= 0)
    throw new StoreError("UNSUPPORTED_PROFILE", "storage quota must be a positive safe integer");
  throw new StoreError("SPIKE_UNRESOLVED", "S-01 filesystem storage quota enforcement is not qualified");
}
