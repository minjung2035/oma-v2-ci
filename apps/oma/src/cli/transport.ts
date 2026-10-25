/** CLI transport policy only. Freeze/query/resend and exit codes remain in
 * the CLI request service, not in the role-neutral protocol channel.
 */
import "../runtime/client-preload.js";
import { Transport, socketPath } from "@oma/client/transport";
import { frameBytes, contextBytes, bundleBytes } from "@oma/client/settings";
export { socketPath };
import type { PublicMethod } from "@oma/contracts";
import type { RpcReply } from "@oma/client/channel";


// CFG-003: sandbox supplies the host's limit; only an omitted setting uses 256 KiB.
// One observation, not a task lifetime. Allow a 120-second preparation step
// to answer; a longer accepted operation can be looked up under its same key.
const transport = new Transport();

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

/** TUI-004: the Principal's endpoint admits nobody until the connection proves
 * it belongs to the session the host started. That credential reaches an
 * engine on its private host channel and stays in the trusted extension's
 * memory (`PrincipalChannel`, `client/codecs.ts`); nothing hands one to a CLI
 * process, so this transport attaches with none. The broker additionally
 * checks that a Principal connection descends from the Principal's engine, so
 * a credential alone would not make any other process the Principal. */


export function call(
  method: PublicMethod,
  params: Record<string, unknown>,
  requestKey?: string,
  streamBytes?: Uint8Array,
): Promise<RpcReply<PublicMethod>[]> {
  return callActor(socketPath(), method, params, requestKey, streamBytes);
}
