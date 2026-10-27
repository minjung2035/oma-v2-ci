/** App composition chooses the OS byte connector. Shared Client owns every
 * generation, frame, deadline, raw upload and accepted-outcome interpretation.
 */
import { BrokerChannel, DEFAULT_CHANNEL_LIMITS, type ChannelLimits } from "@oma/client/channel";
import { dialMachChannel } from "@oma/platform-mac/mach-transport";

export function createBrokerChannel(limits: ChannelLimits = DEFAULT_CHANNEL_LIMITS): BrokerChannel {
  return new BrokerChannel(limits, process.platform === "darwin" ? path => dialMachChannel(path, limits.idleStreamSeconds) : undefined);
}
