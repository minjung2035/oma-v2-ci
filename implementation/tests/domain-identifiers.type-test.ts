/** R03 compile-only checks. NOT_RUN; no typecheck/build result is claimed. */
import {
  parseActor, parseResidentName, parseOperationId, parseBatchId, parseMessageFileId,
  parseFullOid, parseRequestKey, type Actor, type ResidentName, type OperationId,
  type BatchId, type MessageId, type FullOid, type RequestKey,
} from "@oma/domain/identifiers";
import { generateOperationId, generateBatchId } from "@oma/native/identity";
import { messageIdForOperation as generateMessageId } from "@oma/domain/derived";
import { isPublishedRefFor, isMessageIdForOperation } from "@oma/domain/derived";
import { isWorkspacePathFor, isActorSocketPathFor } from "@oma/domain/paths";

type Assert<T extends true> = T;
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type OperationGeneration = Assert<Equal<ReturnType<typeof generateOperationId>, OperationId>>;
type BatchGeneration = Assert<Equal<ReturnType<typeof generateBatchId>, BatchId>>;
type MessageGeneration = Assert<Equal<ReturnType<typeof generateMessageId>, MessageId>>;

function identitiesRequireValidation(raw: string): void {
  // @ts-expect-error Plain strings do not issue an authenticated actor brand.
  const actor: Actor = raw;
  // @ts-expect-error A resident name must cross its context-specific parser.
  const resident: ResidentName = raw;
  // @ts-expect-error Plain operation-shaped text is not a validated OperationId.
  const operation: OperationId = raw;
  // @ts-expect-error Batch and operation identities have separate brands.
  const batch: BatchId = operation;
  // @ts-expect-error Message identities are not raw strings.
  const message: MessageId = raw;
  // @ts-expect-error Full OIDs require runtime grammar validation.
  const oid: FullOid = raw;
  // @ts-expect-error Request keys require runtime grammar validation.
  const key: RequestKey = raw;
  // @ts-expect-error The broader Actor type does not prove resident-name policy.
  const child: ResidentName = actor;
}

function parsersPreserveTheWireRepresentation(raw: unknown): void {
  const actor = parseActor(raw);
  const resident = parseResidentName(raw);
  const operation = parseOperationId(raw);
  const batch = parseBatchId(raw);
  const message = parseMessageFileId(raw);
  const oid = parseFullOid(raw);
  const key = parseRequestKey(raw);
  if (actor !== null) { const wire: string = actor; }
  if (resident !== null) { const wire: string = resident; }
  if (operation !== null) { const wire: import("@oma/contracts").OperationId = operation; }
  if (batch !== null) { const wire: import("@oma/contracts").BatchId = batch; }
  if (message !== null) { const wire: import("@oma/contracts").MessageId = message; }
  if (oid !== null) { const wire: import("@oma/contracts").Oid = oid; }
  if (key !== null) { const wire: import("@oma/contracts").RequestKey = key; }
}

function relationsRequireExpectedIdentity(value: unknown): void {
  // @ts-expect-error Ref syntax alone cannot establish its expected owner.
  isPublishedRefFor(value);
  // @ts-expect-error Message syntax alone cannot establish its accepted operation.
  isMessageIdForOperation(value);
  // @ts-expect-error A workspace relation requires the trusted state root and actor.
  isWorkspacePathFor(value, { actor: "alice" });
  // @ts-expect-error Socket identity includes the incarnation, not just an actor/root.
  isActorSocketPathFor(value, { runRoot: "/run/demo", actor: "alice" });
}

export type { OperationGeneration, BatchGeneration, MessageGeneration };
