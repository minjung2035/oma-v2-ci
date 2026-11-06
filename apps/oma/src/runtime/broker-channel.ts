/** App composition chooses the OS byte connector. Shared Client owns every
 * generation, frame, deadline, raw upload and accepted-outcome interpretation.
 */
import { BrokerChannel, DEFAULT_CHANNEL_LIMITS, type ChannelLimits } from "@oma/client/channel";
import { dialMachChannel, dialOwnedChildMachChannel, machEndpointListening } from "@oma/platform-mac/mach-transport";
import { endpointListening } from "@oma/client/connection";
import type { PrivateParentPin } from "@oma/native/private-parent";

export function createBrokerChannel(limits: ChannelLimits = DEFAULT_CHANNEL_LIMITS, child?: PrivateParentPin): BrokerChannel {
  return new BrokerChannel(limits, process.platform === "darwin"
    ? path => child === undefined ? dialMachChannel(path, limits.idleStreamSeconds) : dialOwnedChildMachChannel(path, limits.idleStreamSeconds, child)
    : undefined);
}
/** Darwin endpoints are Mach rendezvous names derived from the path; a Unix
 * connect there observes nothing (and fails on long TMPDIR paths). */
export function brokerEndpointListening(path: string, timeoutMs: number): Promise<boolean> {
  return process.platform === "darwin" ? Promise.resolve().then(() => machEndpointListening(path)) : endpointListening(path, timeoutMs);
}
