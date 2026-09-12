// VIEW-002: journal observation is diagnostic output, not process or durable receipt proof.
import { spawn } from "node:child_process";
import { unitNameFor as unitName } from "../domain/derived.js";
import { StoreError } from "../domain/errors.js";

export function boundedLogOutput(bytes: Buffer, maxBytes: number, forcedTruncated = false): { text: string; truncated: boolean } {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new StoreError("INTERNAL_ERROR", "invalid log byte limit");
  const prefix = bytes.subarray(0, Math.min(bytes.length, maxBytes));
  let text = prefix.toString("utf8");
  let truncated = forcedTruncated || bytes.length > maxBytes;
  while (Buffer.byteLength(text, "utf8") > maxBytes && text.length > 0) { text = text.slice(0, -1); truncated = true; }
  return { text, truncated };
}
export function readUnitLogs(society: string, agent: string, sinceSeconds: number, limit: number): Promise<{ text: string; truncated: boolean; observedAtMs: number }> {
  const service = unitName(society, agent, "service");
  return new Promise((resolve, reject) => {
    const child = spawn("journalctl", ["--user", "--unit", service, "--since", `${sinceSeconds}s ago`, "--no-pager", "--output=cat"], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = []; const stderrChunks: Buffer[] = [];
    let total = 0; let stderrTotal = 0; let truncated = false; let timedOut = false; let spawnError: Error | null = null;
    const diagnosticLimit = 16 * 1024;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 30000);
    child.stdout.on("data", (chunk: Buffer) => {
      if (truncated) return;
      const part = Buffer.from(chunk); const remaining = Math.max(0, limit - total);
      if (part.length <= remaining) { chunks.push(part); total += part.length; return; }
      if (remaining > 0) { chunks.push(part.subarray(0, remaining)); total += remaining; }
      truncated = true; child.kill("SIGKILL");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const part = Buffer.from(chunk); const remaining = Math.max(0, diagnosticLimit - stderrTotal);
      if (remaining > 0) { const keep = part.subarray(0, remaining); stderrChunks.push(keep); stderrTotal += keep.length; }
    });
    child.once("error", error => { spawnError = error; });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) { reject(new StoreError("DEADLINE_EXCEEDED", "journalctl timed out")); return; }
      if (spawnError) { reject(new StoreError("INTERNAL_ERROR", `journalctl spawn failed: ${spawnError.message}`)); return; }
      const output = boundedLogOutput(Buffer.concat(chunks, total), limit, truncated);
      if (truncated) { resolve({ ...output, observedAtMs: Date.now() }); return; }
      if (signal || code !== 0) {
        const stderr = Buffer.concat(stderrChunks, stderrTotal).toString("utf8");
        reject(new StoreError("INTERNAL_ERROR", `journalctl exited unsuccessfully: ${stderr.slice(0, 300)}`)); return;
      }
      resolve({ ...output, observedAtMs: Date.now() });
    });
  });
}
