/** TS-001: identity contract owner. Declarations only; wire/persisted v1 unchanged. */
/** MUST [TS-001]: Contract declarations only; not an executable implementation.
 * MUST: Validate external values at runtime; TypeScript casts are not validation.
 * SPIKE-dependent adapters MUST NOT be shipped as a guessed implementation.
 */
export type Actor = string;

export type Oid = string;

export type OperationId = string;

export type MessageId = string;

export type BatchId = string;

export type RequestKey = string;

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export type Address = Actor | `topic/${string}`;

/** Closed capability vocabulary (AUTH-001). The contract owns the literal set;
 * packages/domain/src/capabilities.ts owns the runtime vocabulary and validator and is
 * checked against this declaration in both directions at compile time.
 */
export type Capability =
  | 'mail.send'
  | 'route.follow'
  | 'agent.create'
  | 'agent.manage.self'
  | 'agent.manage.descendants'
  | 'git.submit'
  | 'code.integrate'
  | 'context.publish';
