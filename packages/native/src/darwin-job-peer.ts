/** Transient launch capabilities. No role, persisted identity or namespace
 * claim is accepted here. The private helper rechecks the selected task. */
import { StoreError } from "@oma/domain/errors";
import { currentDarwinAuditToken, pinInheritedDarwinPeer } from "./audit-session.js";
import { cleanupAll, withCleanup } from "./cleanup.js";
import { duplicateMachSendRight, inheritedMachPeerEndpoint, sendToMachReceiver,
  type MachReceiveRight, type MachSendRight } from "./mach-message.js";

export interface DarwinJobPeer { close(): void }
interface Source { readonly token: readonly number[]; readonly endpoint: MachSendRight; alive(): boolean }
const sources = new WeakMap<DarwinJobPeer, Source>();
function own(token: readonly number[], endpoint: MachSendRight, alive: () => boolean, release: () => void): DarwinJobPeer {
  let closed = false, failure: unknown;
  const owner = Object.freeze({ close(): void {
    if (failure !== undefined) throw failure;
    if (closed) return; closed = true;
    try { cleanupAll([() => endpoint.close(), release]); }
    catch (error) { failure = error; throw error; }
  } });
  sources.set(owner, { token, endpoint, alive: () => !closed && endpoint.destination() === "present" && alive() });
  return owner;
}
export function peerFromMachReceiver(receiver: MachReceiveRight): DarwinJobPeer {
  const token = currentDarwinAuditToken(), endpoint = sendToMachReceiver(receiver);
  return own(token, endpoint, () => true, () => {});
}
/** Forward the original inherited peer, rather than treating an intermediary
 * Runner's PID or a public service name as the Broker. */
export function inheritedDarwinJobPeer(): DarwinJobPeer {
  const pin = pinInheritedDarwinPeer();
  try { return own(pin.token, inheritedMachPeerEndpoint(), () => pin.alive(), () => pin.close()); }
  catch (error) { return withCleanup(() => { throw error; }, () => pin.close()); }
}
export function captureDarwinJobPeer(owner: DarwinJobPeer): { readonly token: readonly number[]; readonly endpoint: MachSendRight } {
  const source = sources.get(owner);
  if (source === undefined || !source.alive()) throw new StoreError("AUTH_FAILED", "Darwin job has no live owned peer source");
  const endpoint = duplicateMachSendRight(source.endpoint);
  try {
    if (!source.alive()) throw new StoreError("AUTH_FAILED", "Darwin job peer changed during capture");
    return Object.freeze({ token: source.token, endpoint });
  } catch (error) { return withCleanup(() => { throw error; }, () => endpoint.close()); }
}
