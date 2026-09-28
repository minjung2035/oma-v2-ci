/** The single process.exit owner for the product surface. The exit a failure
 * gets is the CLI's (CLI-003, DR13): `errorExit` is the one reading of what a
 * code says -- 2 settled, 3 not known, 4 unsupported -- so an unknown outcome
 * is never reported here as a settled failure.
 */
import type { ErrorCode } from "../../implementation/contracts/errors.js";
import { errorCodeOf, errorExit } from "../domain/errors.js";
import { humanStream } from "./words.js";

export type ExitCode = 0 | 2 | 3 | 4;

export function exitFor(code: ErrorCode): ExitCode { return errorExit(code); }

export function codeFor(error: unknown): ExitCode { return exitFor(errorCodeOf(error)); }

export function fail(message: string, code: ExitCode): never {
  humanStream().write(`oma: ${message}\n`);
  process.exit(code);
}

export function done(): never { process.exit(0); }
