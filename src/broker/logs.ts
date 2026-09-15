// VIEW-002: journal observation is diagnostic output, not process or durable receipt proof.
import { unitNameFor as unitName } from "../domain/derived.js";
import { StoreError } from "../domain/errors.js";
import { runJournal } from "../process/policies.js";
import { StringDecoder } from "node:string_decoder";

export function boundedLogOutput(bytes: Buffer, maxBytes: number, forcedTruncated = false): { text: string; truncated: boolean } {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new StoreError("INTERNAL_ERROR", "invalid log byte limit");
  const prefix = bytes.subarray(0, Math.min(bytes.length, maxBytes));
  let truncated = forcedTruncated || bytes.length > maxBytes;
  const decoder = new StringDecoder("utf8");
  let text = truncated ? decoder.write(prefix) : decoder.end(prefix);
  while (Buffer.byteLength(text, "utf8") > maxBytes && text.length > 0) {
    text = text.slice(0, (text.codePointAt(text.length - 2) ?? 0) > 0xffff ? -2 : -1); truncated = true;
  }
  return { text, truncated };
}
export async function readUnitLogs(society: string, agent: string, sinceSeconds: number, limit: number): Promise<{ text: string; truncated: boolean; observedAtMs: number }> {
  const service = unitName(society, agent, "service");
  const journal = await runJournal(["--user", "--unit", service, "--since", `${sinceSeconds}s ago`, "--no-pager", "--output=cat"], limit);
  return { ...boundedLogOutput(journal.bytes, limit, journal.truncated), observedAtMs: Date.now() };
}
