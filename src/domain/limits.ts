/** CFG-005: required host limits, with no production defaults or additional queue knobs. */
import { integerFieldsCheck, type IntegerField, type IntegerRecord } from "./integer-fields.js";

export const PROTOCOL_LIMIT_FIELDS = Object.freeze({
  frameBytes: Object.freeze({ minInclusive: 1, unit: "bytes" }),
  mailBodyBytes: Object.freeze({ minInclusive: 1, unit: "bytes" }),
  subjectBytes: Object.freeze({ minInclusive: 1, unit: "bytes" }),
  addresses: Object.freeze({ minInclusive: 1, unit: "count" }),
  replyReferences: Object.freeze({ minInclusive: 1, unit: "count" }),
  contextFiles: Object.freeze({ minInclusive: 1, unit: "count" }),
  contextBytes: Object.freeze({ minInclusive: 1, unit: "bytes" }),
  bundleBytes: Object.freeze({ minInclusive: 1, unit: "bytes" }),
  logBytes: Object.freeze({ minInclusive: 1, unit: "bytes" }),
  batchMaxMessages: Object.freeze({ minInclusive: 1, unit: "count" }),
  idleStreamSeconds: Object.freeze({ minInclusive: 1, unit: "seconds" }),
  receiptWaitSeconds: Object.freeze({ minInclusive: 1, unit: "seconds" }),
} satisfies Record<string, IntegerField>);

export type ProtocolLimits = IntegerRecord<typeof PROTOCOL_LIMIT_FIELDS>;
export const protocolLimitsCheck = integerFieldsCheck(PROTOCOL_LIMIT_FIELDS);

export function isProtocolLimits(value: unknown): value is ProtocolLimits {
  return protocolLimitsCheck(value) === null;
}
