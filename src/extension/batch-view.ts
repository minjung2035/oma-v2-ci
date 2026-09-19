/** PI-002: the batch view the runner prepared, read as the extension sees it.
 *
 * This is an exact mirror of the host's batch-view identity grammar, because
 * the extension cannot import host runtime. The equivalence of both decoders
 * is pinned by test/id-contracts.test.ts.
 */
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";

const UUID_V4 =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const BATCH = new RegExp(`^b-${UUID_V4}$`);
const MESSAGE = new RegExp(`^m-${UUID_V4}-([0-9]+)$`);
const ACTOR = /^[a-z][a-z0-9-]{0,31}$/;
const RESERVED = new Set([
  "principal",
  "commons",
  "residents",
  "topic",
  "broker",
  "principal-relay",
  "reconcile",
]);
export interface BatchManifest {
  id: string;
  agent: string;
  incarnation: number;
  deliveryMode: "steer" | "followUp";
  notice: string;
  messageIds: string[];
}
export interface ViewLimits {
  frameBytes: number;
  batchMaxMessages: number;
}
function exactObject(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
export function validMessageId(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const match = MESSAGE.exec(value);
  return match !== null && Number.isSafeInteger(Number(match[1]));
}
function validLimits(limits: ViewLimits): boolean {
  return (
    Number.isSafeInteger(limits.frameBytes) &&
    limits.frameBytes > 0 &&
    Number.isSafeInteger(limits.batchMaxMessages) &&
    limits.batchMaxMessages > 0
  );
}
function decodeManifest(
  value: unknown,
  expected: string,
  limits: ViewLimits,
): BatchManifest | null {
  const keys = [
    "id",
    "agent",
    "incarnation",
    "deliveryMode",
    "notice",
    "messageIds",
  ];
  if (
    !validLimits(limits) ||
    !exactObject(value, keys) ||
    value.id !== expected ||
    !BATCH.test(value.id as string) ||
    typeof value.agent !== "string" ||
    // Mirrors isValidActor: the Principal, or a Resident name.
    (value.agent !== "principal" &&
      (!ACTOR.test(value.agent) ||
        RESERVED.has(value.agent) ||
        value.agent.startsWith("topic-"))) ||
    !Number.isSafeInteger(value.incarnation) ||
    (value.incarnation as number) < 0 ||
    (value.deliveryMode !== "steer" && value.deliveryMode !== "followUp") ||
    typeof value.notice !== "string" ||
    Buffer.byteLength(value.notice) > limits.frameBytes ||
    !Array.isArray(value.messageIds) ||
    value.messageIds.length > limits.batchMaxMessages ||
    value.messageIds.some((id) => !validMessageId(id)) ||
    new Set(value.messageIds).size !== value.messageIds.length
  )
    return null;
  return {
    id: value.id as string,
    agent: value.agent,
    incarnation: value.incarnation as number,
    deliveryMode: value.deliveryMode,
    notice: value.notice,
    messageIds: [...value.messageIds] as string[],
  };
}
export function decodeBatchViewText(
  text: string,
  expected: string,
  limits: ViewLimits,
): BatchManifest | null {
  if (!validLimits(limits) || Buffer.byteLength(text) > limits.frameBytes)
    return null;
  try {
    return decodeManifest(JSON.parse(text), expected, limits);
  } catch {
    return null;
  }
}
export function readBatchView(
  batchId: string,
  root: string,
  limits: ViewLimits,
): BatchManifest | null {
  if (!BATCH.test(batchId) || !validLimits(limits)) return null;
  const path = join(root, `batch-${batchId}.json`);
  let fd: number | undefined;
  try {
    fd = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > limits.frameBytes) return null;
    const bytes = Buffer.alloc(before.size + 1);
    let total = 0;
    while (total < bytes.length) {
      const count = readSync(fd, bytes, total, bytes.length - total, total);
      if (count === 0) break;
      total += count;
    }
    const after = fstatSync(fd);
    if (
      total !== before.size ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      return null;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, total),
    );
    return decodeBatchViewText(text, batchId, limits);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
