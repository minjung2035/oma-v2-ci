import { RequestCache, CacheError, readCacheFile } from "../request-cache.js";
import { BrokerChannel } from "../protocol/channel.js";
import { snapshotJson } from "../domain/canonical-json.js";
import { isValidFullOid } from "../domain/identifiers.js";
import { requestParamsEqual } from "../domain/request-identity.js";
import { decodeFailure, decodeReceipt } from "../protocol/receipt-codec.js";
import { isRequestNotFound, receiptExit, receiptLines } from "../protocol/receipts.js";
import { collectReceipt, MAX_RECEIPT_BYTES } from "../protocol/receipt-chunks.js";
import { PUBLIC_METHODS } from "../protocol/methods.js";
import { CLI_OBSERVATION_SECONDS } from "../domain/limits.js";
import { errorExit, failureText } from "../domain/errors.js";
import { requestIntentConflict } from "../cli/request-intent.js";
import { resolveOid, recordedBase, workspaceDirty } from "../cli/effects.js";
import { prepareGoalEffects } from "../cli/effects/goal.js";
import { prepareReplyEffects } from "../cli/effects/mail.js";
import { prepareSubmitEffects } from "../cli/effects/submit.js";
import { readCode } from "../cli/effects/code.js";
import { installRuntime, type RuntimePort } from "../client/runtime.js";
import { inCallerView } from "../client/receipts.js";
import { spoolOutput } from "../storage/output-spool.js";

export const CLIENT_RUNTIME: RuntimePort = {
  observationSeconds: CLI_OBSERVATION_SECONDS,
  maximumReceiptBytes: MAX_RECEIPT_BYTES,
  spoolOutput,
  cache: (home, budget) => new RequestCache(home, readCacheFile, budget),
  cacheFailure: error => error instanceof CacheError ? error : null,
  channel: limits => new BrokerChannel(limits),
  snapshot: snapshotJson,
  paramsEqual: requestParamsEqual,
  intentConflict: (method, explicitParams, frozen) => requestIntentConflict({ expectedMethod: method, explicitParams }, frozen),
  decodeReceipt, decodeFailure, notFound: isRequestNotFound,
  mutation: method => PUBLIC_METHODS[method].mode === "mutation",
  collectReceipt, failureText, failureExit: failure => errorExit(failure.code, failure.retry) as 2 | 3 | 4,
  receiptText: (receipt, key) => receiptLines(inCallerView(receipt), key).join("\n"),
  receiptExit, goal: prepareGoalEffects, reply: prepareReplyEffects,
  fullOid: isValidFullOid, resolveOid, recordedBase, workspaceDirty, submit: prepareSubmitEffects, code: readCode,
};
export function installClientRuntime(): void { installRuntime(CLIENT_RUNTIME); }
