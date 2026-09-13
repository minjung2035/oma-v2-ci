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

export type Capability = import('../../src/domain/capabilities.js').Capability;
