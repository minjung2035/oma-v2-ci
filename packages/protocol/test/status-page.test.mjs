import test from "node:test";
import assert from "node:assert/strict";
import { statusPage } from "@oma/protocol/status-page";
import { decodeRpcReply } from "@oma/protocol/response-codec";
import { decodePublicParams, UNBOUNDED_PUBLIC_LIMITS } from "@oma/protocol/methods";

const row = index => ({ agent: `a${String(index).padStart(3, "0")}`, desired: "enabled",
  activeState: "inactive", subState: "dead", unitResult: "success", execMainStatus: 0,
  pending: index, preparedBatches: 0, reason: 'line\n"\\ 🧪漢字', runnerObservedAtMs: null });
/** A row as the registry projects it: the two row roles, and no state for a
 * row whose execution belongs to a host session. */
const named = agent => ({ agent, desired: "enabled", activeState: null, subState: null, unitResult: null,
  execMainStatus: null, pending: 0, preparedBatches: 0, reason: agent === "principal" ? "no managed Resident execution" : null,
  runnerObservedAtMs: null });
const observedAtMs = 1728224000000;
const creation = { capability: false, childProfile: null, childHasMailSend: false, observedAtMs, maxWorkers: 6, workerCount: 6 };
const wire = (id, agents, next) => JSON.stringify({ v: 1, id, ok: true, result: {
  observedAtMs, agents, creation, ...(next === undefined ? {} : { next }),
} });

test("001. Status pagination retains exact JSON bytes and continuation at every row boundary", () => {
  const rows = Array.from({ length: 6 }, (_, index) => row(index));
  for (const id of ["request", '\"\\\n😀']) for (const after of [undefined, "a001", "a004"]) {
    const remaining = rows.filter(value => after === undefined || value.agent > after);
    for (let count = 1; count <= remaining.length; count++) {
      const prefix = remaining.slice(0, count);
      const budget = Buffer.byteLength(wire(id, prefix, prefix.at(-1).agent));
      const answer = statusPage(id, observedAtMs, rows, budget, creation, after);
      assert.equal(JSON.stringify(answer), wire(id, prefix, count === remaining.length ? undefined : prefix.at(-1).agent));
      if (count === 1) assert.throws(() => statusPage(id, observedAtMs, rows, budget - 1, creation, after), {
        code: "FRAME_TOO_LARGE", message: "one status row exceeds the response frame budget",
      });
      else assert.equal(JSON.stringify(statusPage(id, observedAtMs, rows, budget - 1, creation, after)),
        wire(id, prefix.slice(0, -1), prefix.at(-2).agent));
    }
  }
});

test("002. Empty or fully traversed status pages enforce their metadata budget without continuation", () => {
  const budget = Buffer.byteLength(wire("r", []));
  assert.equal(JSON.stringify(statusPage("r", observedAtMs, [], budget, creation)), wire("r", []));
  assert.equal(JSON.stringify(statusPage("r", observedAtMs, [row(0)], budget, creation, "z")), wire("r", []));
  assert.throws(() => statusPage("r", observedAtMs, [], budget - 1, creation), { code: "FRAME_TOO_LARGE" });
});

test("003. A status burst visits rows linearly instead of re-encoding every previous prefix", () => {
  for (const count of [64, 128]) {
    let visits = 0;
    const rows = Array.from({ length: count }, (_, index) => {
      const value = row(index);
      return { ...value, toJSON() { visits++; return value; } };
    });
    const answer = statusPage("r", observedAtMs, rows, 1 << 20, creation);
    assert.equal(answer.result.agents.length, count);
    assert.equal(answer.result.next, undefined);
    assert.ok(answer.result.agents.every((value, index) => value === rows[index]));
    assert.ok(visits <= 2 * count, `${count} rows required ${visits} serializations`);
  }
});

test("004. A page that ends at the Principal row continues from its own cursor", () => {
  const roster = ["alice", "principal", "w2", "zulu"].map(named);
  const firstPage = roster.slice(0, 2);
  // The tight budget is the exact size of the page this roster emits at the
  // Principal boundary: the Principal row is the last row that fits it.
  const budget = Buffer.byteLength(wire("r", firstPage, "principal"));
  const limits = { limits: UNBOUNDED_PUBLIC_LIMITS };
  const asked = params => decodePublicParams("status.get", params, limits);

  let answer = statusPage("r", observedAtMs, roster, budget, creation);
  assert.equal(JSON.stringify(answer), wire("r", firstPage, "principal"));
  assert.equal(decodeRpcReply("status.get", answer, "r", {}).ok, true);

  const pages = [];
  for (;;) {
    pages.push(answer.result.agents.map(value => value.agent));
    const next = answer.result.next;
    if (next === undefined) break;
    assert.ok(pages.length < 8, `pagination did not finish after ${pages.length} pages: ${JSON.stringify(pages)}`);
    assert.deepEqual(asked({ after: next }), { after: next }, `the API refused its own cursor ${JSON.stringify(next)}`);
    answer = statusPage("r", observedAtMs, roster, budget, creation, next);
    assert.equal(decodeRpcReply("status.get", answer, "r", {}).ok, true);
  }
  // The page ended at the Principal row, and resuming from that cursor walked
  // on to the rows after it: every row exactly once, in registry order.
  assert.deepEqual(pages, [["alice", "principal"], ["w2", "zulu"]]);
  assert.deepEqual(pages.flat(), roster.map(value => value.agent));

  // Both fields name a status row: `agent` selects one and `after` resumes from
  // one. Anything the roster cannot name is still refused, including the
  // display form a tool resolves locally before it reaches the wire.
  assert.deepEqual(asked({ agent: "principal" }), { agent: "principal" });
  for (const after of ["Principal", "broker", "commons", "residents", "topic-dev", "principal-relay", "principal@demo.oma.invalid", "", " principal"])
    assert.equal(asked({ after }), null, `${JSON.stringify(after)} was accepted as a roster cursor`);
  for (const agent of ["Principal", "broker", "principal@demo.oma.invalid", 7, null])
    assert.equal(asked({ agent }), null, `${JSON.stringify(agent)} was accepted as a roster row`);
  assert.equal(asked({ after: "alice", unexpected: true }), null);
  // Slots that name a controllable Worker keep refusing the Principal: a
  // cursor is not an authority and grants no operation.
  assert.equal(decodePublicParams("logs.read", { agent: "principal", sinceSeconds: 60 }, limits), null);
  assert.equal(decodePublicParams("agent.start", { agent: "principal" }, limits), null);
  assert.equal(decodePublicParams("agent.stop", { agent: "principal" }, limits), null);
});
