/** CFG-005: required host limits, with no production defaults or additional queue knobs. */
import { integerFieldsCheck, type IntegerField, type IntegerRecord } from "./integer-fields.js";
import type { ProtocolLimits } from "@oma/contracts/host";

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

export type { ProtocolLimits };

/** Compile-time exhaustiveness: the descriptor and the contract must name the
 * same fields. A field added to one without the other fails the build.
 */
type MissingDescriptor = Exclude<keyof ProtocolLimits, keyof typeof PROTOCOL_LIMIT_FIELDS>;
type MissingContractKey = Exclude<keyof typeof PROTOCOL_LIMIT_FIELDS, keyof ProtocolLimits>;
const _descriptorCoversContract: [MissingDescriptor] extends [never] ? true : never = true;
const _contractCoversDescriptor: [MissingContractKey] extends [never] ? true : never = true;
void _descriptorCoversContract;
void _contractCoversDescriptor;
const _shape: IntegerRecord<typeof PROTOCOL_LIMIT_FIELDS> extends ProtocolLimits ? true : never = true;
void _shape;
export const protocolLimitsCheck = integerFieldsCheck(PROTOCOL_LIMIT_FIELDS);

export function isProtocolLimits(value: unknown): value is ProtocolLimits {
  return protocolLimitsCheck(value) === null;
}

/** DR27: one CLI observation, not an accepted operation or task lifetime. */
export const CLI_OBSERVATION_SECONDS = 180;

/** The smallest batch that can carry both established priority classes at
 * once: one direct and one public message. A configuration below it starves
 * an actor whose pending mail is mixed (AV-07 family). The domain names the
 * floor for batchMaxMessages; mail/batch-policy.ts enforces it at selection. */
export const MIN_MIXED_BATCH_MESSAGES = 2;
