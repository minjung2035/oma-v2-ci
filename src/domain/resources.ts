/** CFG-005/LIFE-008: declarations are not proof of kernel resource enforcement. */
import { integerFieldsCheck, type IntegerField, type IntegerRecord } from "./integer-fields.js";

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
