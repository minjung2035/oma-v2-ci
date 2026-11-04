import type { Failure } from "@oma/contracts";
import type { InvocationRejection } from "@oma/contracts/public-wire";

export class ClientError extends Error {
  constructor(message: string, readonly exitCode: 2 | 3 | 4, readonly request?: string,
    readonly receipt?: unknown, readonly contradicted = false, readonly code?: string, readonly failure?: Failure) {
    super(message);
    this.name = "ClientError";
  }
}
/** The protected owner, not an exception type or a missing lookup, supplies this proof. */
export class PreacceptRejectionError extends ClientError {
  constructor(key: string, readonly rejection: InvocationRejection) {
    super(rejection.failure.message, rejection.reason === "NEEDS_OPERATOR" ? 3 : 2, key, undefined, false,
      rejection.failure.code, rejection.failure);
    this.name = "PreacceptRejectionError";
  }
}
export function fail(message: string, code: 2 | 3 | 4): never {
  throw new ClientError(message, code, undefined, undefined, false, code === 2 ? "INVALID_REQUEST" : undefined);
}
