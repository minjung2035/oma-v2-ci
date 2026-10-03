import type { MutationMethod, Receipt } from "../../implementation/contracts.js";
import { RequestService, randKey, type FreshBuild } from "../client/request-service.js";
import { ClientError } from "../client/errors.js";
import { runtime } from "../client/runtime.js";
import { cliFrameBytes, call } from "./transport.js";
import { fail, finishReceipt, finishUnrecordedReceipt } from "./exit.js";
export { randKey };
export type { FreshBuild };

const HOME = process.env.HOME ?? "/tmp";
// P0V-112: made at first use, with the frame this CLI speaks -- a request's
// metadata retains a two-frame cache budget. Larger recovered receipts are
// printed without caching; the original request freeze is kept.
let made: RequestService | undefined;
const service = () => made ??= new RequestService(runtime().cache(HOME, 2 * cliFrameBytes()), call);
async function outcome(action: () => Promise<Receipt>, key: string): Promise<Receipt> {
  try { return await action(); }
  catch (error) {
    if (!(error instanceof ClientError)) throw error;
    if (error.receipt !== undefined)
      finishUnrecordedReceipt(error.receipt as Receipt, key, error.message, error.contradicted);
    return fail(error.message, error.exitCode);
  }
}
export function requestReceipt(expectedMethod: MutationMethod, key: string, build: () => FreshBuild | Promise<FreshBuild>,
  comparable: () => Record<string, unknown>): Promise<Receipt> {
  return outcome(() => service().requestReceipt(expectedMethod, key, build, comparable), key);
}
export async function effect(expectedMethod: MutationMethod, key: string, build: () => FreshBuild | Promise<FreshBuild>,
  comparable: () => Record<string, unknown>): Promise<never> {
  return finishReceipt(await requestReceipt(expectedMethod, key, build, comparable), key);
}
export async function replayOrSend(method: MutationMethod, params: Record<string, unknown>, key: string,
  digest?: { bytes: number; sha256: string }, streamBytes?: Uint8Array): Promise<never> {
  return finishReceipt(await outcome(() => service().send(method, params, key, digest, streamBytes), key), key);
}
