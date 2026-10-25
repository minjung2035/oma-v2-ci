import { actorAddress } from "@oma/domain/actor-address";
// MAIL-002/003: recipient selection is a validated Store snapshot, not MIME or filesystem work.
import type { Actor, Address } from "@oma/contracts";
import type { MailRoutingReader } from "./ports.js";
import { StoreError } from "@oma/domain/errors";
import { listAddress, topicAddress, parseDisplayedAddress } from "./addresses.js";

export interface RouteResult { recipients: Actor[]; displayTo: string[] }
export function expandAddresses(store: MailRoutingReader, to: readonly Address[], society: string): RouteResult {
  const agents = new Map(store.listAgents().map(agent => [agent.name, agent]));
  const recipients = new Set<string>(); const display = new Set<string>();
  for (const address of to) {
    if (address === "principal") {
      if (!agents.has("principal")) throw new StoreError("ADDRESS_NOT_FOUND", "principal identity not created");
      recipients.add("principal"); display.add(listAddress("principal", society)); continue;
    }
    if (address === "commons" || address === "residents") {
      for (const [name, agent] of agents) if (agent.role === "resident" && agent.desired !== "provisioning" && agent.desired !== "retired") recipients.add(name);
      display.add(listAddress(address, society)); continue;
    }
    if (address.startsWith("topic/")) {
      const topic = address.slice(6);
      for (const sub of store.subscribers(topic)) {
        const agent = agents.get(sub);
        if (agent && agent.role === "resident" && agent.desired !== "provisioning" && agent.desired !== "retired") recipients.add(sub);
      }
      display.add(topicAddress(topic, society)); continue;
    }
    const agent = agents.get(address);
    if (!agent) throw new StoreError("ADDRESS_NOT_FOUND", `unknown address "${address}"`);
    if (agent.desired === "provisioning") throw new StoreError("AGENT_NOT_READY", `${address} is provisioning`);
    if (agent.desired === "retired") throw new StoreError("AGENT_RETIRED", `${address} is retired`);
    recipients.add(address); display.add(actorAddress(address, society));
  }
  return { recipients: [...recipients].sort(), displayTo: [...display] };
}
export function logicalReplyAddress(store: MailRoutingReader, value: string, society: string): Address | null {
  return parseDisplayedAddress(value, society, new Set(store.listAgents().map(agent => agent.name)));
}
