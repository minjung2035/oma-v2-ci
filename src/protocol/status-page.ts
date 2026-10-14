/** VIEW-002 / CFG-003: an incomplete status list carries explicit continuation. */
import type { AgentStatus, PublicMethods } from "../../implementation/contracts.js";
import { StoreError } from "../domain/errors.js";

export function statusPage(id: string, observedAtMs: number, rows: Iterable<AgentStatus>, frameBytes: number, after?: string) {
  const result: PublicMethods["status.get"]["result"] = { observedAtMs, agents: [] };
  const answer = { v: 1 as const, id, ok: true as const, result };
  for (const row of rows) {
    if (after !== undefined && row.agent <= after) continue;
    const previous = result.agents.at(-1)?.agent;
    result.agents.push(row); result.next = row.agent;
    if (Buffer.byteLength(JSON.stringify(answer)) > frameBytes) {
      result.agents.pop();
      if (previous === undefined) throw new StoreError("FRAME_TOO_LARGE", "one status row exceeds the response frame budget");
      result.next = previous;
      return answer;
    }
  }
  delete result.next;
  return answer;
}
