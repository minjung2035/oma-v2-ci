/** PI-002/003: the delivery boundary the runner waits for.
 *
 * `oma-deliver <batch>` presents a prepared batch as a custom message — never
 * as the Human speaking — and once the turn it triggered ends in a terminal
 * `stop`, a session entry is appended and a boundary notification carries its
 * identity back to the runner. Anything short of that leaves no boundary.
 */
import { isAbsolute } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readBatchView, type BatchManifest } from "./batch-view.js";
import { integerEnv } from "./shared.js";

export const PI_ADAPTER_REVISION = "oma-pi-rpc-v1@0.85.1";
export const PI_BOUNDARY_PREFIX = "OMA_PI_BOUNDARY_V1 ";

export function registerDelivery(pi: ExtensionAPI): void {
  const root = process.env.OMA_BATCH_VIEW ?? "/run/oma-view";
  const frameBytes = integerEnv("OMA_FRAME_BYTES");
  const batchMaxMessages = integerEnv("OMA_BATCH_MAX_MESSAGES");
  let pending: BatchManifest | null = null;
  let terminalStop: string | null = null;
  pi.on("message_end", (event) => {
    // SAFETY: Pi's typed message_end contract supplies the discriminated AgentMessage union.
    const message = event.message;
    if (pending && message?.role === "assistant")
      terminalStop = message.stopReason ?? null;
  });
  pi.registerCommand("oma-deliver", {
    description: "Deliver one broker-prepared immutable mail batch",
    handler: async (args, ctx) => {
      if (pending || frameBytes === null || batchMaxMessages === null) {
        ctx.ui.notify("OMA delivery adapter is unavailable or busy", "error");
        return;
      }
      const batch = readBatchView(args.trim(), root, {
        frameBytes,
        batchMaxMessages,
      });
      if (!batch) {
        ctx.ui.notify("Invalid or unavailable OMA batch", "error");
        return;
      }
      pending = batch;
      terminalStop = null;
      await pi.sendMessage(
        {
          customType: "oma-mail",
          content: batch.notice,
          display: true,
          details: {
            batchId: batch.id,
            incarnation: batch.incarnation,
            messageIds: batch.messageIds,
          },
        },
        { triggerTurn: true, deliverAs: batch.deliveryMode },
      );
    },
  });
  pi.on("agent_settled", async (_event, ctx) => {
    const batch = pending;
    if (!batch || terminalStop !== "stop") return;
    const sessionPath = ctx.sessionManager.getSessionFile();
    if (!sessionPath || !isAbsolute(sessionPath)) return;
    pi.appendEntry("oma-delivery-boundary", {
      adapterRevision: PI_ADAPTER_REVISION,
      batchId: batch.id,
      incarnation: batch.incarnation,
      messageIds: batch.messageIds,
      sessionPath,
    });
    const leaf = ctx.sessionManager.getLeafEntry();
    if (
      !leaf ||
      leaf.type !== "custom" ||
      leaf.customType !== "oma-delivery-boundary"
    )
      return;
    ctx.ui.notify(
      `${PI_BOUNDARY_PREFIX}${JSON.stringify({
        adapterRevision: PI_ADAPTER_REVISION,
        batchId: batch.id,
        incarnation: batch.incarnation,
        sessionPath,
        entryId: leaf.id,
      })}`,
      "info",
    );
    pending = null;
    terminalStop = null;
  });
}
