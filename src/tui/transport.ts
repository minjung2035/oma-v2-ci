/** TUI-012/021: where the Dashboard's broker-derived values come from.
 *
 * `status.get` answers only a caller inside an agent's systemd unit, and a
 * terminal the Human launched is inside none, so asking it could never
 * succeed. The broker instead publishes the same answer as a host-private view
 * (TUI-021), and this reads it. The TUI adds no socket method (IPC-012).
 *
 * Every way the view can fail — absent, unreadable, malformed, from another
 * society, or older than a few refresh intervals — becomes an explicit unknown
 * carrying the reason and the time, never a synthesized "ready" or zero.
 */
import { readFileSync } from "node:fs";
import type { AgentStatus, ProtocolLimits } from "../../implementation/contracts.js";
import type { ChannelLimits } from "../protocol/channel.js";
import { STATUS_STALE_MS, decodeStatusView, statusViewPath } from "../protocol/status-view.js";

export type Observation =
  | { readonly kind: "observed"; readonly statuses: readonly AgentStatus[]; readonly observedAtMs: number }
  | { readonly kind: "unknown"; readonly reason: string; readonly observedAtMs: number };

export function limitsOf(limits: ProtocolLimits): ChannelLimits {
  return { frameBytes: limits.frameBytes, idleStreamSeconds: limits.idleStreamSeconds, receiptWaitSeconds: limits.receiptWaitSeconds };
}

export class TuiTransport {
  constructor(
    private readonly stateRoot: string,
    private readonly society: string,
    /** A view larger than one frame is not one the broker wrote. */
    private readonly maxBytes: number,
    private readonly now: () => number = Date.now,
  ) {}

  status(): Promise<Observation> {
    const checkedAtMs = this.now();
    let text: string;
    try {
      const bytes = readFileSync(statusViewPath(this.stateRoot));
      if (bytes.byteLength > this.maxBytes)
        return Promise.resolve({ kind: "unknown", reason: "status view가 너무 큼", observedAtMs: checkedAtMs });
      text = bytes.toString("utf8");
    } catch (error) {
      const missing = (error as { code?: string }).code === "ENOENT";
      return Promise.resolve({
        kind: "unknown", observedAtMs: checkedAtMs,
        reason: missing ? "broker 관측 없음" : "status view를 읽지 못함",
      });
    }
    const decoded = decodeStatusView(text, this.society);
    if (decoded.kind === "invalid")
      return Promise.resolve({ kind: "unknown", reason: decoded.reason, observedAtMs: checkedAtMs });
    const { observedAtMs, agents } = decoded.view;
    if (checkedAtMs - observedAtMs > STATUS_STALE_MS)
      // The last time is carried so the screen can say how old it is.
      return Promise.resolve({ kind: "unknown", reason: "broker 관측이 멈춤", observedAtMs });
    return Promise.resolve({ kind: "observed", statuses: agents, observedAtMs });
  }
}
