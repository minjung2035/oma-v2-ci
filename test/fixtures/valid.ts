import { serializePlanIntent } from "./plan.js";
// Normal fixture constructors. Independent golden expectations must not call these as their oracle.
import type { MessagePlan } from "@oma/contracts";
import type { Store } from "@oma/storage";
import type { BatchRow } from "@oma/contracts/ledger";
import type { FreezeInput } from "#oma-test/app/request-cache";
import { generateOperationId, generateBatchId } from "@oma/native/identity";
import { messageIdForOperation, mailObjectRelativePath } from "@oma/domain/derived";
import { requestHash } from "@oma/domain/request-identity";
import { sha256Hex } from "@oma/domain/canonical-json";
import { operationPlanCheck } from "@oma/domain/durable";

export function makeValidOperation(options: {
  stateRoot: string; id?: string; actor?: string; requestKey?: string; topic?: string;
}): Parameters<Store["insertOperation"]>[0] {
  const id = options.id ?? generateOperationId();
  const actor = options.actor ?? "alice";
  const topic = options.topic ?? "dev";
  const payload = { topic };
  const plan = { kind: "route.follow", topic, agent: actor } as const;
  const invalid = operationPlanCheck(plan.kind, { operationId: id, actor, stateRoot: options.stateRoot, repositoryIdentity: null })(plan);
  if (invalid) throw new Error(`invalid normal operation fixture: ${invalid}`);
  return { id, actor, requestKey: options.requestKey ?? "durable", requestHash: requestHash(plan.kind, payload), kind: plan.kind,
    payloadJson: JSON.stringify(payload), planJson: serializePlanIntent(plan) };
}

export function makeValidMessagePlan(operationId: string, options: {
  bytes?: Uint8Array; recipient?: string; kind?: MessagePlan["kind"]; contextRevision?: string | null;
} = {}): MessagePlan & { id: ReturnType<typeof messageIdForOperation> } {
  const bytes = options.bytes ?? Buffer.from("fixture\n");
  const id = messageIdForOperation(operationId, 0);
  const recipient = options.recipient ?? "alice";
  return {
    id, objectPath: mailObjectRelativePath(id), sha256: sha256Hex(bytes), bytes: bytes.byteLength,
    dateMs: 1, to: [recipient], recipients: [recipient], kind: options.kind ?? "message",
    contextRevision: options.contextRevision ?? null,
    replyHeaders: { replyTo: [recipient], inReplyTo: null, references: [] },
  };
}

export function makeValidBatch(agent = "alice", messageIds = [messageIdForOperation(generateOperationId(), 0)]): BatchRow {
  return { id: generateBatchId(), agent, incarnation: 1, messageIdsJson: JSON.stringify(messageIds), sessionPath: null,
    state: "prepared", createdAtMs: 1, completedAtMs: null };
}

export function makeValidFrozenRequest(key = "cache-1", text = "hello"): FreezeInput {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length === 0) throw new Error("normal context fixture requires a nonempty GOAL.md");
  const digest = { bytes: bytes.length, sha256: sha256Hex(bytes) };
  return { key, method: "context.publish", createdAtMs: 1,
    params: { expected: null, entries: [{ path: "GOAL.md", ...digest }], content: { ...digest, mediaType: "application/vnd.oma.context-v1" } }, digest };
}
