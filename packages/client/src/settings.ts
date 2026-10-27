import { currentContext } from "./context.js";
import { fail } from "./errors.js";

import { MIN_LOG_FRAME_BYTES } from "@oma/protocol/log-limits";
export function frameBytes(): number {
  const configured = currentContext().env.OMA_FRAME_BYTES;
  const bytes = configured === undefined ? 256 * 1024 : Number(configured);
  if ((configured !== undefined && !/^[0-9]+$/.test(configured)) ||
      !Number.isSafeInteger(bytes) || bytes < MIN_LOG_FRAME_BYTES || bytes > 0xffffffff)
    fail("OMA_FRAME_BYTES must be decimal bytes supporting log responses and uint32 framing", 2);
  return bytes;
}
function streamBound(name: string, reference: number): number {
  const configured = currentContext().env[name];
  const bytes = configured === undefined ? reference : Number(configured);
  if ((configured !== undefined && !/^[0-9]+$/.test(configured)) || !Number.isSafeInteger(bytes) || bytes < 1)
    fail(`${name} must be decimal bytes`, 2);
  return bytes;
}
export function contextBytes(): number { return streamBound("OMA_CONTEXT_BYTES", 8 * 1024 * 1024); }
export function bundleBytes(): number { return streamBound("OMA_BUNDLE_BYTES", 256 * 1024 * 1024); }
