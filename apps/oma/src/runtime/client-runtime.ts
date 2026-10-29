import { RequestCache, CacheError, readCacheFile } from "../request-cache.js";
import { createBrokerChannel } from "./broker-channel.js";
import { snapshotJson } from "@oma/domain/canonical-json";
import { isValidFullOid } from "@oma/domain/identifiers";
import { requestParamsEqual } from "@oma/domain/request-identity";
import { decodeFailure, decodeReceipt } from "@oma/protocol/receipt-codec";
import { isRequestNotFound, receiptExit } from "@oma/protocol/receipts";
import { collectReceipt, MAX_RECEIPT_BYTES } from "@oma/protocol/receipt-chunks";
import { PUBLIC_METHODS } from "@oma/protocol/methods";
import { CLI_OBSERVATION_SECONDS } from "@oma/domain/limits";
import { errorExit, exceptionText, publicFailure } from "@oma/domain/errors";
import { requestIntentConflict } from "./request-intent.js";
import { resolveOid, recordedBase, workspaceDirty } from "./input-effects.js";
import { prepareGoalEffects } from "./input-effects/goal.js";
import { prepareContextEffects } from "./input-effects/context.js";
import { prepareReplyEffects } from "./input-effects/mail.js";
import { prepareSubmitEffects } from "./input-effects/submit.js";
import { readCode } from "./input-effects/code.js";
import { installRuntime, type RuntimePort } from "@oma/client/runtime";
import { inCallerView } from "@oma/client/receipts";
import { spoolOutput } from "@oma/storage/output-spool";
import { assertNativeRuntime } from "./native-support.js";

export const CLIENT_RUNTIME: RuntimePort = {
  observationSeconds: CLI_OBSERVATION_SECONDS,
  maximumReceiptBytes: MAX_RECEIPT_BYTES,
  spoolOutput,
  cache: (home, budget) => new RequestCache(home, readCacheFile, budget),
  cacheFailure: error => error instanceof CacheError ? error : null,
  channel: createBrokerChannel,
  snapshot: snapshotJson,
  paramsEqual: requestParamsEqual,
  intentConflict: (method, explicitParams, frozen) => requestIntentConflict({ expectedMethod: method, explicitParams }, frozen),
  decodeReceipt, decodeFailure, notFound: isRequestNotFound,
  mutation: method => PUBLIC_METHODS[method].mode === "mutation",
  failure: error => ({ ...publicFailure(error), message: exceptionText(error) }),
  collectReceipt, failureText: failure => JSON.stringify(failure), failureExit: failure => errorExit(failure.code, failure.retry) as 2 | 3 | 4,
  receiptText: (receipt, key, phase) => JSON.stringify({ request: key, receipt: inCallerView(receipt),
    ...(phase === undefined ? {} : { phase, operationRequest: `${key}.submit` }) }),
  receiptExit, goal: prepareGoalEffects, context: prepareContextEffects, reply: prepareReplyEffects,
  fullOid: isValidFullOid, resolveOid, recordedBase, workspaceDirty, submit: prepareSubmitEffects, code: readCode,
};
export function installClientRuntime(): void { assertNativeRuntime(); installRuntime(CLIENT_RUNTIME); }
