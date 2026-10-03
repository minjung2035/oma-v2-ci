/** CLI transport policy only. Freeze/query/resend and exit codes remain in
 * the CLI request service, not in the role-neutral protocol channel.
 */
import "../runtime/client-preload.js";
import { fstatSync, readSync } from "node:fs";
import { Transport, socketPath } from "../client/transport.js";
import { frameBytes, contextBytes, bundleBytes } from "../client/settings.js";
export { socketPath };
import type { PublicMethod } from "../../implementation/contracts.js";
import type { RpcReply } from "../protocol/channel.js";
import { HOST_CHANNEL_FD, HOST_CHANNEL_LINE_BYTES, decodeHostMessage } from "../protocol/host-channel.js";
import { StoreError } from "../domain/errors.js";


// CFG-003: sandbox supplies the host's limit; only an omitted setting uses 256 KiB.
// One observation, not a task lifetime. Allow a 120-second preparation step
// to answer; a longer accepted operation can be looked up under its same key.
const transport = new Transport(presentedGrant);

/** The request frame this CLI speaks (CFG-003): the host's limit inside the
 * sandbox, 256 KiB when unset. One owner for the transport and for how much a
 * local file may hold to be carried in a request. */
export function cliFrameBytes(): number { return frameBytes(); }

/** P0V-78, CFG-003: the raw streams a request carries after its frame -- a
 * context tree's documents and a submission's bundle -- are held to the bounds
 * the broker was configured with, named into the CLI's environment beside the
 * frame bound; only an omitted setting uses the reference value. The CLI reads
 * no more of a local input than the stream it is for can carry. */
export function cliContextBytes(): number { return contextBytes(); }
export function cliBundleBytes(): number { return bundleBytes(); }

/** Oversized handled answers are recovered by key, never by replaying an effect. */
export async function callActor(path: string, method: PublicMethod, params: Record<string, unknown>,
  request?: string, streamBytes?: Uint8Array): Promise<RpcReply<PublicMethod>[]> {
  return transport.callActor(path, method, params, request, streamBytes) as Promise<RpcReply<PublicMethod>[]>;
}

/** Where the trusted extension puts a Principal credential for this process,
 * named in the environment only as a descriptor number. */
export const CLI_CREDENTIAL_FD_ENV = "OMA_PRINCIPAL_CREDENTIAL_FD";
/** How long the credential may take to arrive on its descriptor. */
const CREDENTIAL_WAIT_MS = 5000;

type Grant = { credential: string; sessionHandle: string };

/** P0V-25, P0-4: the descriptor carries one message for the whole process, so
 * the process reads it once -- its answer, or its refusal -- and every
 * connection it opens (a lookup and the resend that follows it, a query and
 * the submission it prepares) attaches with that same grant. A second read
 * would find the extension's end already closed and refuse the Principal's
 * second request as unauthenticated. */
let presented: { readonly grant: Grant | null } | { readonly refused: unknown } | undefined;
function presentedGrant(): Grant | null {
  presented ??= (() => {
    try { return { grant: readPresentedGrant() }; } catch (refused) { return { refused }; }
  })();
  if ("refused" in presented) throw presented.refused;
  return presented.grant;
}

/** The credential the extension handed this process, or null when it handed
 * none -- a Resident's CLI, or a caller that is not a Principal tool.
 *
 * It arrives on a socket this process inherited, never in the environment or
 * the command line: both are readable by other processes of this user. The
 * descriptor must be a socket, the message must be the one credential line,
 * and anything else is refused rather than guessed at. */
function readPresentedGrant(): Grant | null {
  const declared = process.env[CLI_CREDENTIAL_FD_ENV];
  if (declared === undefined) return null;
  if (declared !== String(HOST_CHANNEL_FD))
    throw new StoreError("AUTH_FAILED", "the principal credential descriptor is not the one this CLI reads");
  let kind;
  try { kind = fstatSync(HOST_CHANNEL_FD); }
  catch { throw new StoreError("AUTH_FAILED", "the principal credential descriptor is not open"); }
  if (!kind.isSocket()) throw new StoreError("AUTH_FAILED", "the principal credential descriptor is not a private socket");
  const buffer = Buffer.alloc(HOST_CHANNEL_LINE_BYTES + 2);
  let filled = 0;
  // The extension writes the line and closes its end as soon as it starts this
  // process, so the wait is short; a descriptor that never delivers is a
  // failure, not something to spin on.
  // Elapsed time on the monotonic clock: a wall clock stepped forward would
  // refuse a credential that is on its way (MAC-650).
  const deadline = performance.now() + CREDENTIAL_WAIT_MS;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    let count: number;
    try { count = readSync(HOST_CHANNEL_FD, buffer, filled, buffer.length - filled, null); }
    catch (error) {
      if ((error as { code?: string }).code !== "EAGAIN")
        throw new StoreError("AUTH_FAILED", "the principal credential could not be read");
      if (performance.now() > deadline) throw new StoreError("AUTH_FAILED", "the principal credential did not arrive");
      Atomics.wait(pause, 0, 0, 5);
      continue;
    }
    if (count === 0) break;
    filled += count;
    if (filled >= buffer.length) throw new StoreError("AUTH_FAILED", "the principal credential message is too long");
  }
  const text = buffer.subarray(0, filled).toString("latin1");
  const message = text.endsWith("\n") ? decodeHostMessage(text.slice(0, -1)) : null;
  if (message === null || message.kind !== "credential")
    throw new StoreError("AUTH_FAILED", "the principal credential message is malformed");
  return { credential: message.credential, sessionHandle: message.sessionHandle };
}

/** TUI-004: the Principal's endpoint admits nobody until the connection proves
 * it belongs to the session the host started. For every other caller there is
 * no credential and this is a no-op. The broker additionally checks that this
 * process descends from the Principal's engine, so a credential alone would
 * not make any other process the Principal. */


export function call(
  method: PublicMethod,
  params: Record<string, unknown>,
  requestKey?: string,
  streamBytes?: Uint8Array,
): Promise<RpcReply<PublicMethod>[]> {
  return callActor(socketPath(), method, params, requestKey, streamBytes);
}
