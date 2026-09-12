// PI-002/BATCH-002: one compiled trusted extension file, no host runtime imports.
// A custom message is a view, NOT session consumption or S-03 completion proof.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";

export interface BatchView {
  id: string; agent: string; incarnation: number; deliveryMode: "steer" | "followUp";
  notice: string; messageIds: string[];
}
export interface BatchViewLimits { frameBytes: number; batchMaxMessages: number }
const UUID_V4 = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const BATCH_ID = new RegExp(`^b-${UUID_V4}$`);
const MESSAGE_ID = new RegExp(`^m-${UUID_V4}-(\\d+)$`);
const ACTOR_NAME = /^[a-z][a-z0-9-]{0,31}$/;
const RESERVED_ACTORS = new Set(["principal", "commons", "residents", "topic", "broker", "principal-relay", "reconcile"]);
function isValidBatchActor(name: string): boolean {
  return ACTOR_NAME.test(name) && !RESERVED_ACTORS.has(name) && !name.startsWith("topic-");
}
function isValidMessageId(id: string): boolean {
  const match = MESSAGE_ID.exec(id);
  return match !== null && Number.isSafeInteger(Number(match[1])) && Number(match[1]) >= 0;
}
function validLimits(value: BatchViewLimits | undefined): value is BatchViewLimits {
  return value !== undefined && Number.isSafeInteger(value.frameBytes) && value.frameBytes > 0 &&
    Number.isSafeInteger(value.batchMaxMessages) && value.batchMaxMessages > 0;
}
/** No generated source: the equivalent host owner is protocol/batch-view.ts.
 * test/id-contracts.test.ts and test/r28-adapter-boundaries.test.ts pin the
 * independent identity, schema and UTF-8 byte decisions of both implementations.
 */
export function decodeBatchViewText(raw: string, batchId: string, limits: BatchViewLimits): BatchView | null {
  if (!validLimits(limits) || !BATCH_ID.test(batchId) || Buffer.byteLength(raw) > limits.frameBytes) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const value = parsed as Record<string, unknown>;
    const keys = ["id", "agent", "incarnation", "deliveryMode", "notice", "messageIds"];
    if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key)) ||
      value.id !== batchId || typeof value.agent !== "string" || !isValidBatchActor(value.agent) ||
      typeof value.incarnation !== "number" || !Number.isSafeInteger(value.incarnation) || value.incarnation < 0 ||
      (value.deliveryMode !== "steer" && value.deliveryMode !== "followUp") || typeof value.notice !== "string" ||
      Buffer.byteLength(value.notice) > limits.frameBytes || !Array.isArray(value.messageIds) || value.messageIds.length > limits.batchMaxMessages ||
      value.messageIds.some(id => typeof id !== "string" || !isValidMessageId(id)) || new Set(value.messageIds).size !== value.messageIds.length) return null;
    return { id: value.id, agent: value.agent, incarnation: value.incarnation, deliveryMode: value.deliveryMode,
      notice: value.notice, messageIds: [...value.messageIds] as string[] };
  } catch { return null; }
}
function environmentLimits(): BatchViewLimits | undefined {
  const source = process.env.OMA_FRAME_BYTES ?? "";
  const count = process.env.OMA_BATCH_MAX_MESSAGES ?? "";
  if (!/^[1-9][0-9]*$/.test(source) || !/^[1-9][0-9]*$/.test(count)) return undefined;
  const limits = { frameBytes: Number(source), batchMaxMessages: Number(count) };
  return validLimits(limits) ? limits : undefined;
}

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("oma-deliver", {
    description: "Deliver an OMA notification batch (trusted broker view)",
    handler: async (args: string, ctx) => {
      const batchId = args.trim().split(/\s+/)[0] ?? "";
      if (!BATCH_ID.test(batchId)) { ctx.ui.notify("oma-deliver: invalid batch id", "error"); return; }
      const batch = readBatchView(batchId);
      if (!batch) { ctx.ui.notify("oma-deliver: batch view unavailable, invalid or over limit", "error"); return; }
      await pi.sendMessage({ customType: "oma-mail", content: batch.notice, display: true,
        details: { batchId: batch.id, messageIds: batch.messageIds } }, { triggerTurn: true, deliverAs: batch.deliveryMode });
      // No batch.complete request, receiptPath, tool event or agent_end attestation.
    },
  });
}

/** Reads at most the configured source bound plus one overflow-detection byte.
 * The FD pins the opened regular file; a symlink/FIFO/device is never consumed.
 * Production limits are supplied by the trusted sandbox plan's clear environment.
 */
export function readBatchView(batchId: string, viewDir = "/run/oma-view", configured?: BatchViewLimits): BatchView | null {
  const limits = configured ?? environmentLimits();
  if (!validLimits(limits) || !BATCH_ID.test(batchId) || !viewDir.startsWith("/") || viewDir.includes("\0") ||
    viewDir.split("/").some(part => part === "." || part === "..")) return null;
  let fd: number | undefined;
  try {
    fd = openSync(`${viewDir}/batch-${batchId}.json`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = fstatSync(fd);
    if (!before.isFile() || !Number.isSafeInteger(before.size) || before.size < 1 || before.size > limits.frameBytes) return null;
    const buffer = Buffer.alloc(before.size + 1);
    let total = 0;
    while (total < buffer.length) {
      const count = readSync(fd, buffer, total, buffer.length - total, total);
      if (count === 0) break;
      total += count;
    }
    const after = fstatSync(fd);
    if (total !== before.size || after.size !== before.size || after.dev !== before.dev || after.ino !== before.ino ||
      after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) return null;
    return decodeBatchViewText(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, total)), batchId, limits);
  } catch { return null; }
  finally { if (fd !== undefined) closeSync(fd); }
}
