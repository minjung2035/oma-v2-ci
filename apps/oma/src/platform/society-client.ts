/** A method boundary above domain-neutral framing. No socket ownership is
 * transferred: callers still close their connection in their existing scope. */
import { StoreError } from "@oma/domain/errors";
import { societyResultProblem, type SocietyMethods } from "@oma/protocol/host-api";
import type { FramedPeer } from "./rpc.js";

export async function requestSociety<M extends keyof SocietyMethods>(peer: Pick<FramedPeer, "request">,
    method: M, params: SocietyMethods[M]["params"], key?: string): Promise<SocietyMethods[M]["result"]> {
  const result = await peer.request(method, { ...params }, key);
  const problem = societyResultProblem(method, result, { ...params });
  if (problem !== null) throw new StoreError("BROKER_UNAVAILABLE", `${method} result could not be observed: ${problem}`);
  // The protocol owner checked the complete method result, including nested
  // identities. This is the only untrusted-to-typed conversion on this path.
  return result as SocietyMethods[M]["result"];
}
