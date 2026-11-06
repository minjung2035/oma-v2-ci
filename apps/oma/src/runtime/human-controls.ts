/** Human Control Panel adapter only. It neither submits a model prompt nor owns
 * a queue, execution loop, new durable intent, or physical termination policy. */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ProtocolLimits } from "@oma/contracts";
import type { HostControlParams, HostControlResult } from "@oma/contracts/internal-wire";
import { INTERNAL_METHODS } from "@oma/protocol/methods";
import { StoreError, publicDetails } from "@oma/domain/errors";
import { createBrokerChannel } from "./broker-channel.js";
import type { BrokerChannel } from "@oma/client/channel";

export const HUMAN_CONTROL_HELP = [
  "Human Control Panel commands (local host console: Ctrl+X then :; never sent to the Principal):",
  "While the Principal owns the terminal, enter /control alone to end that conversation and return stdin to this host. This navigation request executes no Worker/Society command and carries no control draft.",
  "After the host opens its empty private editor, enter /control help or a command below. Leave it with Escape/Ctrl+X and enter /restart to explicitly reopen the conversation; original pending invocations are not replaced.",
  "/control inspect WORKER — observe desired/incarnation, original controls and separately timed termination evidence; print exact commands.",
  "/control stop KEY WORKER INCARNATION DESIRED CONTROL-ID|none — explicit emergency stop of that observed target.",
  "/control release KEY WORKER INCARNATION stopped STOP-ID — release only that exact observed current stop.",
  "/control society KEY open|closed — use the existing Society gate; no individual stop is silently released.",
  "/control receipt KEY — observe the original Principal/host operation without resubmitting it.",
  "Fresh stop, release and Society keys must begin human-; receipt queries may use the exact legacy Principal-owned key.",
  "Keep the original KEY and command after timeout, interruption or an unknown receipt. Never make a replacement key to escape uncertainty.",
  "Rollback preparation: set Config > Collaboration fresh model mutations to closed, then restart the complete oma host/broker for this same Society. The /restart conversation command alone does not apply broker-lifetime settings.",
  "That closure blocks new collaboration bindings, source freezes and accepted model mutations. It does not stop Workers, finish pending work or erase uncertainty. Original accepted recovery, receipt/record observations, legacy sessions and authenticated Human controls remain available.",
  "Use explicit Society close or inspected individual stops when execution must end; observe their original receipts and separately timed termination evidence. A saved setting or displayed message is not proof that a drain finished.",
  "Retain this Society's new-plan decoders and original recovery owners after closure. Do not downgrade to an old-only binary, rewrite the session surface/history, or treat restoring a backup as undoing external Git/mail effects.",
].join("\n");

type HumanCommand = { readonly kind: "help" } | { readonly kind: "request"; readonly input: HostControlParams };
export function humanControlCommand(text: string): HumanCommand | null {
  const words = text.trim().split(/\s+/);
  if (words[0] !== "/control") return null;
  if (words.length === 1 || (words.length === 2 && words[1] === "help")) return { kind: "help" };
  const [, action, ...args] = words;
  let input: unknown;
  if (action === "inspect" && args.length === 1) input = { action, agent: args[0] };
  else if (action === "receipt" && args.length === 1) input = { action, key: args[0] };
  else if (action === "society" && args.length === 2) input = { action, key: args[0], state: args[1] };
  else if ((action === "stop" || action === "release") && args.length === 5 && /^(?:0|[1-9][0-9]*)$/.test(args[2]!))
    input = { action, key: args[0], agent: args[1], expected: { incarnation: Number(args[2]), desired: args[3], control: args[4] === "none" ? null : args[4] } };
  const problem = INTERNAL_METHODS["host.control"].paramsCheck(input);
  if (problem !== null) throw new StoreError("INVALID_REQUEST", `${problem}. Use /control help in the Human Control Panel.`);
  // The closed method-indexed runtime check, not the cast, establishes validity.
  return { kind: "request", input: input as HostControlParams };
}

export async function callHumanControl(runRoot: string, limits: Pick<ProtocolLimits, "frameBytes" | "idleStreamSeconds" | "receiptWaitSeconds">,
  input: HostControlParams, authorize: () => void, onObserved?: (result: HostControlResult) => undefined,
  channelForHost?: () => BrokerChannel | undefined): Promise<HostControlResult> {
  authorize();
  const channel = channelForHost?.() ?? createBrokerChannel(limits);
  try {
    await channel.connect(join(runRoot, "principal-host.sock"));
    authorize();
    const reply = await channel.call("host.control", input);
    if (!reply.ok) {
      const details = publicDetails(reply.error.code, reply.error.details);
      throw new StoreError(reply.error.code, reply.error.message, details === undefined ? undefined : { details });
    }
    // Deliver the validated canonical observation before fallible local cleanup.
    // This callback is not permission to retry or execute another control.
    if (onObserved !== undefined && onObserved(reply.result) !== undefined)
      throw new StoreError("INTERNAL_ERROR", "Human result observation must be synchronous");
    return reply.result;
  } finally { channel.close(); }
}

export function humanControlLines(result: HostControlResult): readonly string[] {
  if (result.kind === "receipt") {
    if (result.receipt === null) return [`[Human control] No accepted operation was observed for original key ${JSON.stringify(result.key)}. This observation does not cancel a request or authorize a replacement.`];
    return [`[Human control] Original key ${JSON.stringify(result.key)}; canonical receipt: ${JSON.stringify(result.receipt)}`,
      "Desired state, an accepted control and physical termination are distinct. Inspect the Worker again for separately timed death evidence; a start does not prove task completion."];
  }
  const rows = [`[Human control] ${JSON.stringify(result)}`,
    "Registry, execution and termination observations are separately timed, not an atomic snapshot. Unconfirmed termination is not proof of life or death."];
  const target = `${result.agent} ${result.incarnation} ${result.desired} ${result.control?.operation ?? "none"}`;
  if (result.control?.actor === "principal") rows.push(`Original control receipt: /control receipt ${result.control.key}`);
  if (result.principalControl !== null && result.principalControl.operation !== result.control?.operation)
    rows.push(`Original Principal-owned control receipt: /control receipt ${result.principalControl.key}`);
  if (result.desired === "enabled" || result.desired === "stopped") {
    if (!(result.control?.kind === "agent.stop" && (result.control.state === "pending" || result.control.state === "unknown"))) rows.push(`For a distinct explicit emergency-stop decision, copy: /control stop human-${randomUUID()} ${target}`);
    if (result.desired === "stopped" && result.control?.kind === "agent.stop")
      rows.push(`To release only this observed current stop, copy: /control release human-${randomUUID()} ${target}`);
  }
  rows.push("A stale command is refused before fresh acceptance. Repeating an accepted original key observes/continues only its original intent, never a later incarnation.");
  return rows;
}
