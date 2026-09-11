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

const BATCH_ID = /^b-[0-9a-f-]{36}$/;
const MESSAGE_ID = /^m-[0-9a-f-]{36}-\d+$/;
const ACTOR_NAME = /^[a-z][a-z0-9-]{0,31}$/;
const RESERVED_ACTORS = new Set([
  "principal",
  "commons",
  "residents",
  "topic",
  "broker",
  "principal-relay",
  "reconcile",
]);

// Keep the trusted extension deployable as one compiled file. This mirrors the
// ID-001 resident-name grammar without creating a runtime dependency on the
// host-side ids.js module inside the sandbox rootfs.
function isValidBatchActor(name: string): boolean {
  return (
    ACTOR_NAME.test(name) &&
    !RESERVED_ACTORS.has(name) &&
    !name.startsWith("topic-")
  );
}

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("oma-deliver", {
    description: "Deliver an OMA notification batch (trusted broker view)",
    handler: async (args: string, ctx) => {
      const batchId = args.trim().split(/\s+/)[0] ?? "";
      if (!BATCH_ID.test(batchId)) {
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

/** M-003: the broker-owned JSON view is still an external runtime boundary. */
export function readBatchView(
  batchId: string,
  viewDir = "/run/oma-view",
): BatchView | null {
  try {
    if (!BATCH_ID.test(batchId)) return null;
    const raw = readFileSync(`${viewDir}/batch-${batchId}.json`, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const value = parsed as Record<string, unknown>;
    const expectedKeys = [
      "id",
      "agent",
      "incarnation",
      "deliveryMode",
      "notice",
      "messageIds",
    ];
    if (
      Object.keys(value).length !== expectedKeys.length ||
      !Object.keys(value).every((key) => expectedKeys.includes(key)) ||
      value.id !== batchId ||
      typeof value.agent !== "string" ||
      !isValidBatchActor(value.agent) ||
      typeof value.incarnation !== "number" ||
      !Number.isSafeInteger(value.incarnation) ||
      value.incarnation < 0 ||
      (value.deliveryMode !== "steer" && value.deliveryMode !== "followUp") ||
      typeof value.notice !== "string" ||
      !Array.isArray(value.messageIds) ||
      value.messageIds.some(
        (id) => typeof id !== "string" || !MESSAGE_ID.test(id),
      ) ||
      new Set(value.messageIds).size !== value.messageIds.length
    ) {
      return null;
    }
    return {
      id: value.id,
      agent: value.agent,
      incarnation: value.incarnation,
      deliveryMode: value.deliveryMode,
      notice: value.notice,
      messageIds: [...value.messageIds] as string[],
    };
  } catch {
    return null;
  }
}
