import test from "node:test";
import assert from "node:assert/strict";
import {
  requireBoundedRejection,
  requireSubmitConvergence,
  type RejectionObservation,
} from "./fixtures/verification-oracles.js";

test("V02 accepted submit convergence preserves identity and plan for pending, unknown and succeeded receipts", async () => {
  for (const state of ["pending", "unknown", "succeeded"]) {
    let row = { id: "accepted", state, planJson: "frozen" };
    const calls: string[] = [];
    const settled = await requireSubmitConvergence(
      row.id,
      () => row,
      async (id) => {
        calls.push(id);
        row = { ...row, state: "succeeded" };
      },
    );
    assert.equal(settled.state, "succeeded");
    assert.deepEqual(calls, ["accepted"]);
  }
});
test("V02 convergence oracle rejects non-settlement, failed state, identity replacement and plan rewrite independently", async () => {
  for (const [change, message] of [
    [{ state: "pending" }, /did not converge/],
    [{ state: "failed" }, /did not converge/],
    [{ state: "succeeded", id: "replacement" }, /identity/],
    [{ state: "succeeded", planJson: "rewritten" }, /frozen plan/],
  ] as const) {
    let row = { id: "accepted", state: "pending", planJson: "frozen" };
    await assert.rejects(
      requireSubmitConvergence(
        row.id,
        () => row,
        async () => {
          row = { ...row, ...change };
        },
      ),
      message,
    );
  }
  let invalid = { id: "accepted", state: "failed", planJson: "frozen" };
  await assert.rejects(
    requireSubmitConvergence(
      invalid.id,
      () => invalid,
      async () => {
        invalid = { ...invalid, state: "succeeded" };
      },
    ),
    /unexpected accepted state/,
  );
});
test("V05 bounded rejection oracle requires one explicit correlated protocol error, not silence", () => {
  const reply = { id: "request", ok: false, error: { code: "STREAM_INVALID" } };
  requireBoundedRejection({ replies: [reply] }, "STREAM_INVALID", "request");
  const invalid: Array<RejectionObservation | undefined> = [
    undefined,
    {},
    { replies: [] },
    { timeout: true, replies: [reply] },
    { fatal: "driver failed", replies: [reply] },
    { replies: [{ ...reply, ok: true }] },
    { replies: [{ ...reply, id: "wrong" }] },
    { replies: [{ ...reply, error: { code: "INTERNAL_ERROR" } }] },
    { replies: [reply, reply] },
    { replies: [reply, { id: "unexpected", ok: true }] },
  ];
  for (const observation of invalid)
    assert.throws(
      () => requireBoundedRejection(observation, "STREAM_INVALID", "request"),
      JSON.stringify(observation),
    );
});
