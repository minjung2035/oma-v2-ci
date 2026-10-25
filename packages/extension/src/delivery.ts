/** PI-002/003: the delivery boundary the runner waits for.
 *
 * `oma-deliver <batch>` presents a prepared batch as a custom message — never
 * as the Human speaking — and once the turn it triggered ends in a terminal
 * `stop`, a session entry is appended and a boundary notification carries its
 * identity back to the runner. Anything short of that leaves no boundary.
 */
import { isAbsolute } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readBatchView } from "@oma/tool-runtime/batch-view";
import { type BatchView as BatchManifest } from "@oma/protocol/batch-view";
import { integerEnv } from "@oma/tool-runtime/shared";

import { PI_ADAPTER_REVISION, PI_BOUNDARY_PREFIX, PI_WAIT_PREFIX, PI_WAIT_OBSERVATION_PREFIX } from "@oma/protocol/delivery-boundary";

export function registerDelivery(pi: ExtensionAPI, waitRequested?: () => Promise<boolean>): void {
  const root = process.env.OMA_BATCH_VIEW ?? "/run/oma-view";
  const frameBytes = integerEnv("OMA_FRAME_BYTES");
  const batchMaxMessages = integerEnv("OMA_BATCH_MAX_MESSAGES");
  let pending: BatchManifest | null = null;
  let terminalStop: string | null = null;
  let waiting = false;
  let waitUnobserved = false;
  pi.on("turn_end", async (event, ctx) => {
    if (!pending || !waitRequested || waiting || waitUnobserved || event.toolResults.length === 0) return;
    // Pi awaits this hook after persisting every tool result. Aborting here
    // stops continuation, not an in-flight tool or an accepted broker effect.
    const batch = pending;
    const observe = (phase: "begin" | "end" | "failed"): void => ctx.ui.notify(
      `${PI_WAIT_OBSERVATION_PREFIX}${JSON.stringify({
        adapterRevision: PI_ADAPTER_REVISION, batchId: batch.id, incarnation: batch.incarnation, phase,
      })}`, "info");
    observe("begin");
    try { waiting = await waitRequested(); }
    catch { waitUnobserved = true; }
    finally { observe(waitUnobserved ? "failed" : "end"); }
    if (waiting || waitUnobserved) ctx.abort();
  });
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
      waiting = false;
      waitUnobserved = false;
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
    if (!batch) return;
    // Whatever happens below, this engine is ready for the next batch when the
    // turn is over. A Resident's engine is discarded after a batch; the
    // Principal's is the Human's long-lived session, so a batch left pending
    // here -- because the turn failed, because the session file was not where
    // it should be, because the entry did not land -- would refuse every later
    // delivery for as long as the Human keeps the session open. The batch
    // itself stays prepared in the broker and is delivered again; only this
    // engine's claim on it is released.
    try {
      // A wait is ephemeral control, never a successful delivery receipt.
      if (waiting) {
        ctx.ui.notify(`${PI_WAIT_PREFIX}${JSON.stringify({
          adapterRevision: PI_ADAPTER_REVISION, batchId: batch.id, incarnation: batch.incarnation,
        })}`, "info");
        return;
      }
      if (waitUnobserved) {
        ctx.ui.notify("OMA could not observe the current run's wait intent; delivery remains unconfirmed", "error");
        return;
      }
      // A turn that ended any other way produced no boundary.
      if (terminalStop !== "stop") return;
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
    } finally {
      pending = null;
      terminalStop = null;
      waiting = false;
      waitUnobserved = false;
    }
  });
}