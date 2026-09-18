/** The single process.exit owner for the product surface, mirroring the CLI's
 * exit ownership rule. Exit codes follow CLI-003's meaning: 0 success, 2
 * validation/authority failure, 3 unknown outcome, 4 unsupported profile.
 */
import { StoreError } from "../domain/errors.js";

export type ExitCode = 0 | 2 | 3 | 4;

export function codeFor(error: unknown): ExitCode {
  if (!(error instanceof StoreError)) return 3;
  switch (error.code) {
    case "UNSUPPORTED_PROFILE":
    case "SPIKE_UNRESOLVED":
      return 4;
    case "BROKER_UNAVAILABLE":
    case "DEADLINE_EXCEEDED":
      return 3;
    default:
      return 2;
  }
}

export function fail(message: string, code: ExitCode): never {
  process.stderr.write(`oma: ${message}\n`);
  process.exit(code);
}

export function done(): never { process.exit(0); }
