/** TUI-001/012: the only BrokerChannel owner on the product surface.
 *
 * The TUI adds no socket method (IPC-012). It speaks the existing read methods
 * on the existing actor endpoint. When no endpoint is available the caller gets
 * an explicit unknown with a reason, never a synthesized "ready".
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { AgentStatus, ProtocolLimits } from "../../implementation/contracts.js";
import { BrokerChannel, type ChannelLimits } from "../protocol/channel.js";

export type Observation =
  | { readonly kind: "observed"; readonly statuses: readonly AgentStatus[]; readonly observedAtMs: number }
  | { readonly kind: "unknown"; readonly reason: string; readonly observedAtMs: number };

export function limitsOf(limits: ProtocolLimits): ChannelLimits {
  return { frameBytes: limits.frameBytes, idleStreamSeconds: limits.idleStreamSeconds, receiptWaitSeconds: limits.receiptWaitSeconds };
}

/** The endpoint is per incarnation. The highest numbered directory is the newest
 * run; an older one is a revoked lease and must not be preferred.
 */
export function principalSocket(runRoot: string): string | null {
  const base = join(runRoot, "actors", "principal");
  let entries: readonly string[];
  try { entries = readdirSync(base); } catch { return null; }
  const incarnations = entries
    .filter(entry => /^\d+$/.test(entry))
    .map(entry => Number(entry))
    .filter(value => Number.isSafeInteger(value))
    .sort((left, right) => right - left);
  const newest = incarnations[0];
  if (newest === undefined) return null;
  return join(base, String(newest), "control.sock");
}

export class TuiTransport {
  constructor(private readonly runRoot: string, private readonly limits: ChannelLimits) {}

  async status(): Promise<Observation> {
    const observedAtMs = Date.now();
    const path = principalSocket(this.runRoot);
    if (path === null)
      return { kind: "unknown", reason: "principal 실행 endpoint 없음", observedAtMs };
    const channel = new BrokerChannel(this.limits);
    try {
      await channel.connect(path);
      const reply = await channel.call("status.get", {});
      if (!reply.ok) return { kind: "unknown", reason: `${reply.error.code}`, observedAtMs };
      const result = reply.result as { agents?: readonly AgentStatus[] };
      const statuses = Array.isArray(result.agents) ? result.agents : [];
      return { kind: "observed", statuses, observedAtMs };
    } catch (error) {
      return { kind: "unknown", reason: error instanceof Error ? error.message : String(error), observedAtMs };
    } finally {
      channel.close();
    }
  }
}
