import test from "node:test";
import assert from "node:assert/strict";
import type { AgentStatus } from "@oma/contracts";
import { statusPage } from "@oma/protocol/status-page";
import { decodeRpcReply } from "@oma/protocol/response-codec";
const row = (agent: string): AgentStatus => ({ agent, desired: "enabled", activeState: null, subState: null,
  unitResult: null, execMainStatus: null, pending: 0, preparedBatches: 0, reason: null, runnerObservedAtMs: null });

test("G02-ledger-r2: status pages are bounded and never present a prefix as the whole list", () => {
  const rows = [row("alice"), row("bob"), row("carol"), row("david")];
  const seen: string[] = []; let after: string | undefined;
  do {
    const answer = statusPage("x", 1, rows, 550, after);
    assert.ok(Buffer.byteLength(JSON.stringify(answer)) <= 550);
    assert.equal(decodeRpcReply("status.get", answer, "x", {}).ok, true);
    seen.push(...answer.result.agents.map(agent => agent.agent));
    assert.notEqual(answer.result.next, after === undefined ? "" : after);
    after = answer.result.next;
  } while (after !== undefined);
  assert.deepEqual(seen, rows.map(agent => agent.agent));
  assert.deepEqual(statusPage("x", 2, [row("aaron"), row("carol")], 550, "bob").result.agents, [row("carol")]);
  assert.throws(() => statusPage("x", 1, rows, 20), { code: "FRAME_TOO_LARGE" });
});
