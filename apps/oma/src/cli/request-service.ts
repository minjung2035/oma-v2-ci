import type { MutationMethod, Receipt } from "@oma/contracts";
import { RequestService, randKey, type FreshBuild } from "@oma/client/request-service";
import { ClientError } from "@oma/client/errors";
import type { CachedRequest } from "@oma/client/runtime";
import { runtime } from "@oma/client/runtime";
import { publicFailure } from "@oma/domain/errors";
import { cliFrameBytes, call } from "./transport.js";
import { fail, finishReceipt, finishUnrecordedReceipt } from "./exit.js";
export { randKey };
export type { FreshBuild };

/** The caller's home is the request cache's root; a process with no HOME has
 * none, and a shared /tmp guessed from a missing environment is not one --
 * that is said out loud rather than silently used. */
const cacheHome = (): string => {
  const home = process.env.HOME;
  if (home === undefined || home.length === 0)
    throw new ClientError("HOME is not set; the request cache has no root", 4);
  return home;
};
// P0V-112: made at first use, with the frame this CLI speaks -- a request's
// metadata retains a two-frame cache budget. Larger recovered receipts are
// printed without caching; the original request freeze is kept.
let made: RequestService | undefined;
const service = () => made ??= new RequestService(runtime().cache(cacheHome(), 2 * cliFrameBytes()), call);

export interface RequestOptions {
  /** Recovery text names this key instead of the frozen request's own. */
  readonly recoveryKey?: string;
  /** Runs immediately before the frozen request's transport send -- first
   * send and every replay alike (merge open's candidate publication). */
  readonly beforeSend?: (frozen: CachedRequest) => Promise<void>;
}

async function outcome(action: () => Promise<Receipt>, key: string): Promise<Receipt> {
  try { return await action(); }
  catch (error) {
    if (!(error instanceof ClientError)) throw error;
    if (error.receipt !== undefined)
      finishUnrecordedReceipt(error.receipt as Receipt, key, error.message, error.contradicted);
    return fail(error.message, error.exitCode);
  }
}
function serviceOptions(options: RequestOptions, key: string) {
  return {
    ...(options.recoveryKey === undefined ? {} : { displayKey: options.recoveryKey }),
    ...(options.beforeSend === undefined ? {} : {
      beforeSend: async (frozen: CachedRequest) => {
        try { await options.beforeSend!(frozen); }
        catch (error) {
          const failure = publicFailure(error);
          throw new ClientError(`request preparation: ${runtime().failureText(failure)}`,
            runtime().failureExit(failure), options.recoveryKey ?? key);
        }
      },
    }),
  };
}
export function requestReceipt(expectedMethod: MutationMethod, key: string, build: () => FreshBuild | Promise<FreshBuild>,
  comparable: () => Record<string, unknown>, options: RequestOptions = {}): Promise<Receipt> {
  return outcome(() => service().requestReceipt(expectedMethod, key, build, comparable,
    serviceOptions(options, key)), options.recoveryKey ?? key);
}
export async function effect(expectedMethod: MutationMethod, key: string, build: () => FreshBuild | Promise<FreshBuild>,
  comparable: () => Record<string, unknown>, options: RequestOptions = {}): Promise<never> {
  return finishReceipt(await requestReceipt(expectedMethod, key, build, comparable, options), options.recoveryKey ?? key);
}
export async function replayOrSend(method: MutationMethod, params: Record<string, unknown>, key: string,
  digest?: { bytes: number; sha256: string }, streamBytes?: Uint8Array): Promise<never> {
  return finishReceipt(await outcome(() => service().send(method, params, key, digest, streamBytes), key), key);
}
