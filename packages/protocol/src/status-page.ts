/** VIEW-002 / CFG-003: an incomplete status list carries explicit continuation. */
import type { AgentStatus, PublicMethods } from "@oma/contracts";
import { StoreError } from "@oma/domain/errors";

export function statusPage(id: string, observedAtMs: number, rows: Iterable<AgentStatus>, frameBytes: number, after?: string) {
  const result: PublicMethods["status.get"]["result"] = { observedAtMs, agents: [] };
  const answer = { v: 1 as const, id, ok: true as const, result };
  // The empty array is already included. Each row and separator adds only
  // its own bytes; the continuation field remains reserved exactly as before.
  // Re-encoding every growing prefix makes a burst of status reads quadratic.
  let encodedBytes = Buffer.byteLength(JSON.stringify(answer));
  const continuationPrefixBytes = Buffer.byteLength(',"next":');
  for (const row of rows) {
    if (after !== undefined && row.agent <= after) continue;
    const previous = result.agents.at(-1)?.agent;
    result.agents.push(row); result.next = row.agent;
    encodedBytes += Buffer.byteLength(JSON.stringify(row)) + (result.agents.length > 1 ? 1 : 0);
    const continuationBytes = continuationPrefixBytes + Buffer.byteLength(JSON.stringify(result.next));
    if (encodedBytes + continuationBytes > frameBytes) {
      result.agents.pop();
      if (previous === undefined) throw new StoreError("FRAME_TOO_LARGE", "one status row exceeds the response frame budget");
      result.next = previous;
      return answer;
    }
  }
  delete result.next;
  return answer;
}
