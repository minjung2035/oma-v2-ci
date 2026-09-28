/** TS-001: public-wire contract owner. Declarations only; wire/persisted v1 unchanged. */
import type { MutationMethod, Receipt } from "./durable.js";
import type { Failure } from "./errors.js";
import type { Actor, Address, MessageId, Oid, RequestKey } from "./identity.js";
import type { AgentStatus } from "./runtime.js";
import type { AgentCreateInput, BlobDescriptor, ContextEntry, MailInput } from "./values.js";

export interface PublicMethods {
  'mail.send': { params: MailInput; result: Receipt };
  'mail.ack': { params: { message: MessageId }; result: Receipt };
  'route.follow': { params: { topic: string }; result: Receipt };
  'route.unfollow': { params: { topic: string }; result: Receipt };
  'agent.create': { params: AgentCreateInput; result: Receipt };
  'agent.start': { params: { agent: Actor }; result: Receipt };
  'agent.stop': { params: { agent: Actor }; result: Receipt };
  'agent.continue': { params: { note: string }; result: Receipt };
  'agent.wait': { params: Record<string, never>; result: { accepted: boolean } };
  /** `prerequisites` is a bounded subset of the commits the broker holds --
   * main first, then published candidates, as many as one frame carries -- not
   * a complete list (G03-broker-02). A bundle built on any subset is complete,
   * only larger; `hasCandidate` is judged against all of them. */
  'git.known': { params: { candidate: Oid }; result: { hasCandidate: boolean; prerequisites: Oid[] } };
  'git.submit': { params: { candidate: Oid; exportRef: string; prerequisites: Oid[]; to: Address[]; subject: string; body: string; paths: string[]; bundle?: BlobDescriptor }; result: Receipt };
  'git.integrate': { params: { candidate: Oid; expected: Oid }; result: Receipt };
  'context.publish': { params: { expected: Oid | null; entries: ContextEntry[]; content: BlobDescriptor }; result: Receipt };
  'operation.get': { params: { key: RequestKey }; result: Receipt };
  'status.get': { params: { agent?: Actor }; result: { observedAtMs: number; agents: AgentStatus[] } };
  'logs.read': { params: { agent: Actor; sinceSeconds: number }; result: { text: string; truncated: boolean; observedAtMs: number } };
}

export type PublicMethod = keyof PublicMethods;

export type ReadMethod = 'operation.get' | 'status.get' | 'logs.read' | 'git.known';

export type EphemeralMethod = 'agent.wait';

type RequestEnvelope<M extends PublicMethod> = {
  v: 1; id: string; method: M; params: PublicMethods[M]['params'];
};

export type MutationRequest<M extends MutationMethod = MutationMethod> =
  M extends MutationMethod ? RequestEnvelope<M> & { request: RequestKey } : never;

export type ReadRequest<M extends ReadMethod = ReadMethod> =
  M extends ReadMethod ? RequestEnvelope<M> & { request?: never } : never;

export type EphemeralRequest<M extends EphemeralMethod = EphemeralMethod> =
  M extends EphemeralMethod ? RequestEnvelope<M> & { request?: never } : never;

export type Request<M extends PublicMethod = PublicMethod> =
  M extends MutationMethod ? MutationRequest<M> :
  M extends ReadMethod ? ReadRequest<M> :
  M extends EphemeralMethod ? EphemeralRequest<M> : never;

export type Response<M extends PublicMethod = PublicMethod> = { v: 1; id: string; ok: true; result: PublicMethods[M]['result'] } |
  { v: 1; id: string; ok: false; error: Failure };
