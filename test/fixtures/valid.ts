// Normal fixture constructors. Independent golden expectations must not call these as their oracle.
import type { MessagePlan } from "../../implementation/contracts.js";
import type { Store, BatchRow, UsageRow } from "../../src/store.js";
import type { FreezeInput } from "../../src/request-cache.js";
import { generateOperationId, generateBatchId, uuidV4 } from "../../src/ids.js";
import { messageIdForOperation, mailObjectRelativePath } from "../../src/domain/derived.js";
import { requestHash, sha256Hex } from "../../src/hash.js";
import { operationPlanCheck } from "../../src/durable.js";

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
    payloadJson: JSON.stringify(payload), planJson: JSON.stringify(plan) };
}

export function makeValidMessagePlan(operationId: string, options: {
  bytes?: Uint8Array; recipient?: string; kind?: MessagePlan["kind"]; contextRevision?: string | null;
} = {}): MessagePlan {
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

export function makeValidUsage(actor = "alice"): UsageRow {
  // usage.profile is the frozen modelProfile, not the agent profile name.
  return { requestId: uuidV4(), actor, incarnation: actor === "principal" ? 0 : 1, profile: "md", pricingRevision: "fixture-v1",
    reservedUnits: 1, reportedUnits: null, outcome: "reserved", detailsJson: null, createdAtMs: 1, updatedAtMs: 1 };
}

export function makeValidFrozenRequest(key = "cache-1", text = "hello"): FreezeInput {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length === 0) throw new Error("normal context fixture requires a nonempty GOAL.md");
  const digest = { bytes: bytes.length, sha256: sha256Hex(bytes) };
  return { key, method: "context.publish", createdAtMs: 1,
    params: { expected: null, entries: [{ path: "GOAL.md", ...digest }], content: { ...digest, mediaType: "application/vnd.oma.context-v1" } }, digest };
}
