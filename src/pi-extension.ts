// MUST [PI-002]/[BATCH-002]: trusted OMA extension, the ONLY extension the
// runner loads inside the sandbox (PI-001). Readies a prepared batch from the
// broker-owned view dir and delivers it as a custom message — never as a Human
// prompt. deliverAs comes from the broker/adapter policy (steer for direct
// mail, followUp otherwise; S-03 verified the mechanism on pi 0.85.1).
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";

export interface BatchView {
  id: string;
  agent: string;
  incarnation: number;
  deliveryMode: "steer" | "followUp";
  notice: string;
  messageIds: string[];
}

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("oma-deliver", {
    description: "Deliver an OMA notification batch (trusted broker view)",
    handler: async (args: string, ctx) => {
      const batchId = args.trim().split(/\s+/)[0] ?? "";
      if (!/^b-[0-9a-f-]{36}$/.test(batchId)) {
        ctx.ui.notify(`oma-deliver: invalid batch id ${batchId}`, "error");
        return;
      }
      const batch = readBatchView(batchId);
      if (!batch) {
        ctx.ui.notify(`oma-deliver: batch ${batchId} not found`, "error");
        return;
      }
      // The view carries the batch manifest written by the broker (BATCH-002);
      // ownership is enforced there; this handler only relays it.
      await pi.sendMessage(
        {
          customType: "oma-mail",
          content: batch.notice,
          display: true,
          details: { batchId: batch.id, messageIds: batch.messageIds },
        },
        { triggerTurn: true, deliverAs: batch.deliveryMode },
      );
    },
  });
}

function readBatchView(batchId: string): BatchView | null {
  try {
    // /run/oma-view is the runner's RO-mounted public view dir (FS-002).
    const raw = readFileSync(`/run/oma-view/batch-${batchId}.json`, "utf8");
    const v = JSON.parse(raw) as BatchView;
    if (
      typeof v.id !== "string" ||
      typeof v.notice !== "string" ||
      !Array.isArray(v.messageIds)
    )
      return null;
    return v;
  } catch {
    return null;
  }
}
