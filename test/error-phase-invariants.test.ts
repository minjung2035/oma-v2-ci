import test from "node:test";
import assert from "node:assert/strict";
import type { ErrorCode } from "@oma/contracts";
import {
  ERROR_METADATA, StoreError, classifyError, errorExit, isErrorCode,
  isPreacceptOnlyFailure, publicFailure,
  type EffectKnowledge, type ErrorPhase, type ObservationKind,
} from "@oma/domain/errors";
import { receiptOfOperation } from "@oma/protocol/receipt-projector";
import { receiptNotFound, isRequestNotFound, receiptExit, receiptLines } from "@oma/protocol/receipts";
import { receiptOperation, receiptOperationId } from "./fixtures/receipt-operation.js";

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

test("one receipt builder retains terminal bytes after the decoder rejects contradictory states", () => {
  const resultJson = '{"subscribed":true,"topic":"work","kind":"route.follow"}';
  const row = receiptOperation({ state: "succeeded", result_json: resultJson });
  const before = JSON.stringify(row);
  const first = receiptOfOperation(row);
  assert.deepEqual(first, receiptOfOperation(row));
  assert.equal(first.state, "succeeded");
  assert.equal(row.resultJson, resultJson);
  assert.equal(JSON.stringify(row), before);
  const failed = receiptOfOperation(receiptOperation({ state: "failed", error_code: "CHECK_FAILED" }));
  assert.deepEqual(failed.error, { code: "CHECK_FAILED", message: "CHECK_FAILED", retry: "never" });
  assert.equal(isRequestNotFound(failed), false);
  const unknown = receiptOfOperation(receiptOperation({ state: "unknown" }));
  assert.deepEqual(unknown, { operation: receiptOperationId, state: "unknown" });
  assert.equal(isRequestNotFound(unknown), false);
  assert.equal(isRequestNotFound(receiptNotFound), true);
  const corrupt = (error: unknown): boolean => error instanceof StoreError && error.code === "STORE_CORRUPT";
  for (const damaged of [
    { state: "failed" },
    { state: "pending", result_json: resultJson },
    { state: "succeeded", result_json: resultJson, error_code: "CHECK_FAILED" },
    { state: "succeeded", result_json: "{" },
  ]) assert.throws(() => receiptOfOperation(receiptOperation(damaged)), corrupt);
});

test("CLI receipt mapping distinguishes pending, terminal failure and unknown effect", () => {
  const pending = receiptOfOperation(receiptOperation());
  assert.equal(receiptExit(pending), 0);
  assert.equal(receiptLines(pending, "same-key")[0], "Accepted / not yet complete");
  assert.match(receiptLines(pending, "same-key").join("\n"), /--request same-key/);
  const unknown = receiptOfOperation(receiptOperation({ state: "unknown" }));
  assert.equal(receiptExit(unknown), 3);
  assert.match(receiptLines(unknown, "same-key")[0]!, /Outcome unknown/);
  assert.equal(receiptExit(receiptOfOperation(receiptOperation({ state: "failed", error_code: "CHECK_FAILED" }))), 2);
  assert.equal(receiptExit(receiptOfOperation(receiptOperation({ state: "failed", error_code: "SPIKE_UNRESOLVED" }))), 4);
});
