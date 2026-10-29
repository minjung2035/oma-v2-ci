import test from "node:test";
import assert from "node:assert/strict";
import type { AgentStatus } from "@oma/contracts";
import { statusPage } from "@oma/protocol/status-page";
import { decodeRpcReply } from "@oma/protocol/response-codec";
const row = (agent: string): AgentStatus => ({ agent, desired: "enabled", activeState: null, subState: null,
  unitResult: null, execMainStatus: null, pending: 0, preparedBatches: 0, reason: null, runnerObservedAtMs: null });
const creation = { capability: true, childProfile: "worker", childHasMailSend: true, observedAtMs: 1, maxWorkers: 6, workerCount: 4 };

test("G02-ledger-r2: status pages are bounded and never present a prefix as the whole list", () => {
  const rows = [row("alice"), row("bob"), row("carol"), row("david")];
  const seen: string[] = []; let after: string | undefined;
  do {
    const answer = statusPage("x", 1, rows, 550, creation, after);
    assert.ok(Buffer.byteLength(JSON.stringify(answer)) <= 550);
    assert.equal(decodeRpcReply("status.get", answer, "x", {}).ok, true);
    seen.push(...answer.result.agents.map(agent => agent.agent));
    assert.notEqual(answer.result.next, after === undefined ? "" : after);
    after = answer.result.next;
  } while (after !== undefined);
  assert.deepEqual(seen, rows.map(agent => agent.agent));
  assert.deepEqual(statusPage("x", 2, [row("aaron"), row("carol")], 550, creation, "bob").result.agents, [row("carol")]);
  assert.throws(() => statusPage("x", 1, rows, 20, creation), { code: "FRAME_TOO_LARGE" });
});

test("status pages retain creation failures and refuse a frame without room for one row", () => {
  const unavailable = { capability: true, childProfile: null, childHasMailSend: null, observedAtMs: 1, maxWorkers: null, workerCount: 0,
    error: { code: "UNSUPPORTED_PROFILE" as const, message: "child policy unavailable" } };
  const empty = statusPage("x", 1, [], 1024, unavailable);
  assert.deepEqual(empty.result.creation, unavailable);
  const metadataBytes = Buffer.byteLength(JSON.stringify(empty));
  assert.throws(() => statusPage("x", 1, [row("alice")], metadataBytes, unavailable),
    { code: "FRAME_TOO_LARGE" });
});
