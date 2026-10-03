export class ClientError extends Error {
  constructor(message: string, readonly exitCode: 2 | 3 | 4, readonly request?: string,
    readonly receipt?: unknown, readonly contradicted = false, readonly code?: string) {
    super(message);
    this.name = "ClientError";
  }
}
export function fail(message: string, code: 2 | 3 | 4): never {
  throw new ClientError(message, code, undefined, undefined, false, code === 2 ? "INVALID_REQUEST" : undefined);
}
