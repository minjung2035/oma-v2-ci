import test from "node:test";
import assert from "node:assert/strict";
import { statusPage } from "@oma/protocol/status-page";

const row = index => ({ agent: `a${String(index).padStart(3, "0")}`, desired: "enabled",
  activeState: "inactive", subState: "dead", unitResult: "success", execMainStatus: 0,
  pending: index, preparedBatches: 0, reason: 'line\n"\\ 🧪漢字', runnerObservedAtMs: null });
const observedAtMs = 1728224000000;
const wire = (id, agents, next) => JSON.stringify({ v: 1, id, ok: true, result: {
  observedAtMs, agents, ...(next === undefined ? {} : { next }),
} });

test("Status pagination retains exact JSON bytes and continuation at every row boundary", () => {
  const rows = Array.from({ length: 6 }, (_, index) => row(index));
  for (const id of ["request", '\"\\\n😀']) for (const after of [undefined, "a001", "a004"]) {
    const remaining = rows.filter(value => after === undefined || value.agent > after);
    for (let count = 1; count <= remaining.length; count++) {
      const prefix = remaining.slice(0, count);
      const budget = Buffer.byteLength(wire(id, prefix, prefix.at(-1).agent));
      const answer = statusPage(id, observedAtMs, rows, budget, after);
      assert.equal(JSON.stringify(answer), wire(id, prefix, count === remaining.length ? undefined : prefix.at(-1).agent));
      if (count === 1) assert.throws(() => statusPage(id, observedAtMs, rows, budget - 1, after), {
        code: "FRAME_TOO_LARGE", message: "one status row exceeds the response frame budget",
      });
      else assert.equal(JSON.stringify(statusPage(id, observedAtMs, rows, budget - 1, after)),
        wire(id, prefix.slice(0, -1), prefix.at(-2).agent));
    }
  }
});

test("Empty or fully traversed status pages retain the existing envelope without continuation", () => {
  assert.equal(JSON.stringify(statusPage("r", observedAtMs, [], 0)), wire("r", []));
  assert.equal(JSON.stringify(statusPage("r", observedAtMs, [row(0)], 0, "z")), wire("r", []));
});

test("A status burst visits rows linearly instead of re-encoding every previous prefix", () => {
  for (const count of [64, 128]) {
    let visits = 0;
    const rows = Array.from({ length: count }, (_, index) => {
      const value = row(index);
      return { ...value, toJSON() { visits++; return value; } };
    });
    const answer = statusPage("r", observedAtMs, rows, 1 << 20);
    assert.equal(answer.result.agents.length, count);
    assert.equal(answer.result.next, undefined);
    assert.ok(answer.result.agents.every((value, index) => value === rows[index]));
    assert.ok(visits <= 2 * count, `${count} rows required ${visits} serializations`);
  }
});
