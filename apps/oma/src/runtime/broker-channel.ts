/** App composition chooses the OS byte connector. Shared Client owns every
 * generation, frame, deadline, raw upload and accepted-outcome interpretation.
 */
import { BrokerChannel, DEFAULT_CHANNEL_LIMITS, type ChannelLimits } from "@oma/client/channel";
import { dialAttestedMachChannel, dialMachChannel, dialOwnedChildMachChannel, machEndpointListening } from "@oma/platform-mac/mach-transport";
import type { BrokerIdentity } from "@oma/protocol/client-codecs";
import { endpointListening } from "@oma/client/connection";
import type { PrivateParentPin } from "@oma/native/private-parent";

/** Darwin expected-peer sources: the Host's own unreaped Broker child, the
 * Broker identity its trusted parent channel attested, or (Workers) the
 * inherited launch endpoint. Linux keeps peer-credential sockets. */
export function createBrokerChannel(limits: ChannelLimits = DEFAULT_CHANNEL_LIMITS,
  source?: PrivateParentPin | { readonly attested: BrokerIdentity }): BrokerChannel {
  return new BrokerChannel(limits, process.platform === "darwin"
    ? path => source === undefined ? dialMachChannel(path, limits.idleStreamSeconds)
      : "attested" in source ? dialAttestedMachChannel(path, limits.idleStreamSeconds, source.attested)
        : dialOwnedChildMachChannel(path, limits.idleStreamSeconds, source)
    : undefined);
}
/** Darwin endpoints are Mach rendezvous names derived from the path; a Unix
 * connect there observes nothing (and fails on long TMPDIR paths). */
export function brokerEndpointListening(path: string, timeoutMs: number): Promise<boolean> {
  return process.platform === "darwin" ? Promise.resolve().then(() => machEndpointListening(path)) : endpointListening(path, timeoutMs);
}
