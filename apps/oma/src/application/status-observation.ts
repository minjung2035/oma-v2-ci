import type { Observation } from "@oma/protocol/status-view";
export type { Observation } from "@oma/protocol/status-view";
/** TUI-012/021: where the Dashboard's broker-derived values come from.
 *
 * `status.get` answers only an authenticated caller inside an agent's native scope, and a
 * terminal the Human launched is inside none, so asking it could never
 * succeed. The broker instead publishes the same answer as a host-private view
 * (TUI-021), and this reads it. The TUI adds no socket method (IPC-012).
 *
 * Every way the view can fail — absent, unreadable, malformed, from another
 * society, or older than a few refresh intervals — becomes an explicit unknown
 * carrying the reason and the time, never a synthesized "ready" or zero.
 */
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import type { AgentStatus, ProtocolLimits } from "@oma/contracts";
import type { ChannelLimits } from "@oma/client/channel";
import { STATUS_REFRESH_MS, STATUS_STALE_MS, decodeStatusView, statusViewPath } from "@oma/protocol/status-view";

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

  /** Reads the view without following a link and without ever holding more than
   * the declared bound, so an oversized or replaced file costs a refusal rather
   * than the memory it claims. Its size is checked on the open descriptor, so
   * the file that is measured is the file that is read. */
  private read(path: string): { text: string } | { reason: string } {
    let fd: number | undefined;
    try {
      fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = fstatSync(fd);
      if (!stat.isFile()) return { reason: "Status view is not a regular file" };
      if (stat.size > this.maxBytes) return { reason: "Status view is too large" };
      const buffer = Buffer.allocUnsafe(stat.size);
      let filled = 0;
      while (filled < stat.size) {
        const count = readSync(fd, buffer, filled, stat.size - filled, null);
        if (count === 0) break;
        filled += count;
      }
      return { text: buffer.subarray(0, filled).toString("utf8") };
    } catch (error) {
      return { reason: (error as { code?: string }).code === "ENOENT" ? "No broker observation" : "Could not read the status view" };
    } finally { if (fd !== undefined) closeSync(fd); }
  }

  status(): Promise<Observation> {
    const checkedAtMs = this.now();
    const read = this.read(statusViewPath(this.stateRoot));
    if ("reason" in read)
      return Promise.resolve({ kind: "unknown", reason: read.reason, observedAtMs: checkedAtMs });
    const text = read.text;
    const decoded = decodeStatusView(text, this.society);
    if (decoded.kind === "invalid")
      return Promise.resolve({ kind: "unknown", reason: decoded.reason, observedAtMs: checkedAtMs });
    const { observedAtMs, agents } = decoded.view;
    if (checkedAtMs - observedAtMs > STATUS_STALE_MS)
      // The last time is carried so the screen can say how old it is.
      return Promise.resolve({ kind: "unknown", reason: "Broker observation is stale", observedAtMs });
    // A view dated ahead of this clock cannot be aged: after the clock is set
    // back it would pass as current for as long as the jump. It is not current.
    if (observedAtMs - checkedAtMs > STATUS_REFRESH_MS)
      return Promise.resolve({ kind: "unknown", reason: "Broker observation is ahead of this clock (clock changed)", observedAtMs: checkedAtMs });
    return Promise.resolve({ kind: "observed", statuses: agents, observedAtMs });
  }
}
