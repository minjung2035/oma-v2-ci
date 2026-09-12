import test from "node:test";
import assert from "node:assert/strict";
import type { ErrorCode } from "../implementation/contracts.js";
import {
  ERROR_METADATA, StoreError, classifyError, errorExit, isErrorCode,
  isPreacceptOnlyFailure, publicFailure,
  type EffectKnowledge, type ErrorPhase, type ObservationKind,
} from "../src/domain/errors.js";
import {
  receiptOfOperation, receiptNotFound, isRequestNotFound, receiptExit, receiptLines,
  type ReceiptOperation,
} from "../src/protocol/receipts.js";

const operation = "op-00000000-0000-4000-8000-000000000001";
const phases: readonly ErrorPhase[] = ["preaccept", "accepted", "recovering", "terminal"];
const effects: readonly EffectKnowledge[] = ["none", "possible", "applied"];
const observations: readonly ObservationKind[] = ["absent", "present", "rejected", "unavailable", "corrupt"];

function allErrorCodes(): ErrorCode[] {
  return Object.keys(ERROR_METADATA).filter(isErrorCode);
}

test("every declared error has policy for every phase/effect/observation combination", () => {
  for (const code of allErrorCodes()) {
    for (const phase of phases) for (const effectKnowledge of effects) for (const observationKind of observations) {
      const context = { code, phase, effectKnowledge, observationKind };
      const policy = classifyError(context);
      assert.equal(isErrorCode(policy.code), true, JSON.stringify(context));
      assert.equal(policy.lookupSameKey, true, JSON.stringify(context));
      if (phase === "terminal" || phase === "preaccept") assert.equal(policy.terminal, null, JSON.stringify(context));
      if (policy.resendFrozen) {
        assert.deepEqual(context, {
          code: "REQUEST_NOT_FOUND", phase: "preaccept", effectKnowledge: "none", observationKind: "absent",
        });
      }
      if (phase !== "preaccept" && phase !== "terminal" && effectKnowledge !== "none")
        assert.notEqual(policy.terminal, "failed", JSON.stringify(context));
      if (phase !== "preaccept" && phase !== "terminal" && observationKind === "corrupt") {
        assert.equal(policy.code, "STORE_CORRUPT", JSON.stringify(context));
        assert.equal(policy.terminal, null, JSON.stringify(context));
        assert.equal(policy.reconcile, "repair", JSON.stringify(context));
      }
    }
  }
});

test("resource exhaustion and broker-owned artifact damage never become preaccept failed rows", () => {
  for (const code of ["STREAM_INVALID", "LIMIT_EXCEEDED", "STORAGE_FULL"] as const) {
    assert.equal(isPreacceptOnlyFailure(code), true);
    for (const phase of ["accepted", "recovering"] as const) {
      const policy = classifyError({ code, phase, effectKnowledge: "none", observationKind: "present" });
      assert.equal(policy.terminal, null);
      assert.equal(policy.resendFrozen, false);
    }
  }
  const damaged = classifyError({
    code: "STREAM_INVALID", phase: "recovering", effectKnowledge: "possible", observationKind: "corrupt",
  });
  assert.equal(damaged.code, "STORE_CORRUPT");
  assert.equal(damaged.terminal, null);
  assert.equal(damaged.reconcile, "repair");
  assert.equal(damaged.blockScope, "store");
});

test("public failures contain no private exception payload and retain recovery class", () => {
  const privateText = "private mail content and provider credential must not be emitted";
  const corruption = publicFailure(new StoreError("STREAM_INVALID", privateText), {
    phase: "recovering", effectKnowledge: "possible", observationKind: "corrupt",
  });
  assert.deepEqual(corruption, { code: "STORE_CORRUPT", message: "STORE_CORRUPT", retry: "after-repair" });
  const arbitrary = publicFailure(new Error(privateText));
  assert.equal(JSON.stringify(arbitrary).includes(privateText), false);
  assert.equal(arbitrary.code, "INTERNAL_ERROR");
  assert.equal(errorExit("BROKER_UNAVAILABLE"), 3);
  assert.equal(errorExit("SPIKE_UNRESOLVED"), 4);
  assert.equal(errorExit("CAPABILITY_DENIED"), 2);
});

test("one receipt builder retains terminal bytes and rejects contradictory durable states", () => {
  const row: ReceiptOperation = Object.freeze({
    id: operation, kind: "route.follow", state: "succeeded",
    resultJson: '{"subscribed":true,"topic":"work","kind":"route.follow"}', errorCode: null,
  });
  const before = JSON.stringify(row);
  const first = receiptOfOperation(row);
  assert.deepEqual(first, receiptOfOperation(row));
  assert.equal(first.state, "succeeded");
  assert.equal(JSON.stringify(row), before);
  const failed = receiptOfOperation({ ...row, state: "failed", resultJson: null, errorCode: "CHECK_FAILED" });
  assert.deepEqual(failed.error, { code: "CHECK_FAILED", message: "CHECK_FAILED", retry: "never" });
  assert.equal(isRequestNotFound(failed), false);
  const unknown = receiptOfOperation({ ...row, state: "unknown", resultJson: null });
  assert.deepEqual(unknown, { operation, state: "unknown" });
  assert.equal(isRequestNotFound(unknown), false);
  assert.equal(isRequestNotFound(receiptNotFound), true);
  assert.throws(() => receiptOfOperation({ ...row, state: "failed", resultJson: null }), /failed operation/);
  assert.throws(() => receiptOfOperation({ ...row, state: "pending" }), /non-success operation/);
  assert.throws(() => receiptOfOperation({ ...row, errorCode: "CHECK_FAILED" }), /inconsistent succeeded/);
  assert.throws(() => receiptOfOperation({ ...row, resultJson: "{" }), /invalid operation result JSON/);
});

test("CLI receipt mapping distinguishes pending, terminal failure and unknown effect", () => {
  const base: ReceiptOperation = { id: operation, kind: "route.follow", state: "pending", resultJson: null, errorCode: null };
  const pending = receiptOfOperation(base);
  assert.equal(receiptExit(pending), 0);
  assert.equal(receiptLines(pending, "same-key")[0], "접수됨 / 아직 완료되지 않음");
  assert.match(receiptLines(pending, "same-key").join("\n"), /--request same-key/);
  const unknown = receiptOfOperation({ ...base, state: "unknown" });
  assert.equal(receiptExit(unknown), 3);
  assert.match(receiptLines(unknown, "same-key")[0]!, /결과 불명확/);
  assert.equal(receiptExit(receiptOfOperation({ ...base, state: "failed", errorCode: "CHECK_FAILED" })), 2);
  assert.equal(receiptExit(receiptOfOperation({ ...base, state: "failed", errorCode: "SPIKE_UNRESOLVED" })), 4);
});
