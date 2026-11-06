/** App composition chooses the OS byte connector. Shared Client owns every
 * generation, frame, deadline, raw upload and accepted-outcome interpretation.
 */
import { BrokerChannel, DEFAULT_CHANNEL_LIMITS, type ChannelLimits } from "@oma/client/channel";
import { dialMachChannel, dialOwnedChildMachChannel } from "@oma/platform-mac/mach-transport";
import type { PrivateParentPin } from "@oma/native/private-parent";

export function createBrokerChannel(limits: ChannelLimits = DEFAULT_CHANNEL_LIMITS, child?: PrivateParentPin): BrokerChannel {
  return new BrokerChannel(limits, process.platform === "darwin"
    ? path => child === undefined ? dialMachChannel(path, limits.idleStreamSeconds) : dialOwnedChildMachChannel(path, limits.idleStreamSeconds, child)
    : undefined);
}
