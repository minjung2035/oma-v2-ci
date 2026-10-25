/** Ledger boundary data only; these declarations grant no write authority. */
import type { Actor, OperationId, RequestKey } from "./identity.js";
import type { OperationPlan } from "./durable.js";

export interface AgentRow {
  name: string; specHash: string; role: "resident" | "principal";
  desired: "provisioning" | "enabled" | "stopped" | "retired";
  incarnation: number; profile: string; createdBy: string | null; specJson: string;
  createdAtMs: number; updatedAtMs: number;
}
export interface SubscriptionRow { topic: string; agent: string; createdAtMs: number }
export interface DeliveryRow {
  messageId: string; recipient: string; operationId: string; materialized: 0 | 1;
  batchId: string | null; presented: 0 | 1; acknowledged: 0 | 1; createdAtMs: number;
  materializedAtMs: number | null; presentedAtMs: number | null; acknowledgedAtMs: number | null;
}
export interface BatchRow {
  id: string; agent: string; incarnation: number; messageIdsJson: string;
  sessionPath: string | null; state: "prepared" | "completed"; createdAtMs: number; completedAtMs: number | null;
}
export interface NewOperation {
  id: OperationId; actor: Actor; requestKey: RequestKey; requestHash: string;
  kind: OperationPlan["kind"]; payloadJson: string; planJson: string;
}
export interface NewAgent {
  name: Actor; specHash: string; role: "resident" | "principal"; desired: AgentRow["desired"];
  incarnation: number; profile: string; createdBy: string | null; specJson: string;
}
