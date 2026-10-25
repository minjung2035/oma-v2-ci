/** Compile-only contract regression checks; MUST NOT be imported by production. */
import type {
  AgentCreateInput, ResolvedAgentSpec, MutationMethod, ReadMethod,
  EphemeralMethod, PublicMethod, Request, RequestKey,
} from '@oma/contracts';

type Assert<T extends true> = T;
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type AllMethodsClassified = Assert<Equal<PublicMethod, MutationMethod | ReadMethod | EphemeralMethod>>;
type NoOverlappingCategories = Assert<Equal<
  (MutationMethod & ReadMethod) | (MutationMethod & EphemeralMethod) | (ReadMethod & EphemeralMethod), never
>>;
type EveryMutationRequiresKey = Assert<Equal<{
  [M in MutationMethod]: Request<M> extends { request: RequestKey } ? true : false
}[MutationMethod], true>>;

declare function acceptRequest(request: Request): void;
declare function acceptCreate(input: AgentCreateInput): void;
declare const resolved: ResolvedAgentSpec;

acceptRequest({ v: 1, id: '1', method: 'agent.create', request: 'stable',
  params: { name: 'child', from: 'abc', brief: 'Investigate' } });
acceptRequest({ v: 1, id: '2', method: 'status.get', params: {} });
acceptRequest({ v: 1, id: '3', method: 'operation.get', params: { key: 'stable' } });
acceptRequest({ v: 1, id: '4', method: 'agent.wait', params: {} });
acceptCreate({ name: 'child', from: 'abc', brief: 'Investigate' });

// @ts-expect-error Mutation request key is mandatory, including in the generic union.
acceptRequest({ v: 1, id: '5', method: 'agent.stop', params: { agent: 'a' } });
// @ts-expect-error Undefined is not a mutation key.
acceptRequest({ v: 1, id: '6', method: 'agent.stop', request: undefined, params: { agent: 'a' } });
// @ts-expect-error Reads must not carry a top-level mutation key.
acceptRequest({ v: 1, id: '7', method: 'status.get', request: 'stable', params: {} });
// @ts-expect-error The ephemeral wait request has no durable idempotency key.
acceptRequest({ v: 1, id: '8', method: 'agent.wait', request: 'stable', params: {} });
// @ts-expect-error exactOptionalPropertyTypes forbids explicitly undefined forbidden fields.
acceptRequest({ v: 1, id: '9', method: 'status.get', request: undefined, params: {} });
// @ts-expect-error operation.get requires params.key, not a top-level key.
acceptRequest({ v: 1, id: '10', method: 'operation.get', request: 'stable', params: {} });
// @ts-expect-error Host profile selection cannot be supplied by the actor.
acceptCreate({ name: 'child', from: 'abc', brief: 'Investigate', profile: 'expensive' });
// @ts-expect-error Actor-supplied capabilities are forbidden, even an empty list.
acceptCreate({ name: 'child', from: 'abc', brief: 'Investigate', capabilities: [] });
// @ts-expect-error A resolved spec variable must not be structurally assignable as caller input.
acceptCreate(resolved);
// @ts-expect-error Explicit undefined does not bypass forbidden input fields.
acceptCreate({ name: 'child', from: 'abc', brief: 'Investigate', profile: undefined });
// @ts-expect-error Public agent.create also uses the restricted caller input type.
acceptRequest({ v: 1, id: '11', method: 'agent.create', request: 'stable', params: resolved });

function narrow(request: Request): RequestKey | undefined {
  if (request.method === 'agent.create') {
    const required: RequestKey = request.request;
    return required;
  }
  if (request.method === 'agent.wait' || request.method === 'status.get') {
    const absent: undefined = request.request;
    return absent;
  }
  return undefined;
}

export type { AllMethodsClassified, NoOverlappingCategories, EveryMutationRequiresKey };
