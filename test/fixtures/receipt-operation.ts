import { serializePlanIntent } from "./plan.js";
/** Receipt tests start from supported persisted bytes, not forged decoder brands. */
import { requestHash } from "@oma/domain/request-identity";
import {
  decodeOperation, type OperationDecodeContext, type OperationOf, type RawOperationRecord,
} from "@oma/protocol/operation-codec";

export const receiptOperationId = "op-00000000-0000-4000-8000-000000000001";
const payload = { topic: "work" };
export const receiptOperationRecord: RawOperationRecord = Object.freeze({
  id: receiptOperationId,
  actor: "alice",
  request_key: "receipt-fixture",
  request_hash: requestHash("route.follow", payload),
  kind: "route.follow",
  payload_json: JSON.stringify(payload),
  plan_json: serializePlanIntent({ kind: "route.follow", topic: "work", agent: "alice" }),
  state: "pending",
  result_json: null,
  error_code: null,
  created_at_ms: 1000,
  updated_at_ms: 1000,
});
const context: OperationDecodeContext = {
  stateRoot: "/state/demo",
  repositoryIdentity: { society: "demo" },
  relations: { operation: () => null, agent: () => null, deliveries: () => [] },
};

export function receiptOperation(overrides: Partial<RawOperationRecord> = {}): OperationOf<"route.follow"> {
  const operation = decodeOperation({ ...receiptOperationRecord, ...overrides }, context);
  if (operation.kind !== "route.follow") throw new Error("receipt fixture must remain route.follow");
  return operation;
}
