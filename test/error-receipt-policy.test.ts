import test from "node:test";
import assert from "node:assert/strict";
import type { ErrorCode } from "@oma/contracts";
import {
  ERROR_METADATA, StoreError, classifyError, errorExit, isErrorCode,
  isPreacceptOnlyFailure, publicFailure, type ErrorContext,
} from "@oma/domain/errors";
import { receiptOfOperation } from "@oma/protocol/receipt-projector";
import { type OperationLookup } from "@oma/contracts/durable";
import { receiptExit, receiptLines, receiptNotFound, isRequestNotFound } from "@oma/protocol/receipts";
import { receiptOperation } from "./fixtures/receipt-operation.js";

const pending = receiptOperation();
const corrupt = (error: unknown): boolean => error instanceof StoreError && error.code === "STORE_CORRUPT";

// Source specifications only. No test execution or generated PASS evidence is implied.
test("error classification preserves phase, observation and effect knowledge separately", () => {
  const cases: Array<{
    input: ErrorContext;
    code: ErrorCode;
    terminal: "failed" | "unknown" | null;
    reconcile: "none" | "observe" | "reconcile" | "repair";
    resend: boolean;
  }> = [
    { input: { code: "STREAM_INVALID", phase: "preaccept", effectKnowledge: "none", observationKind: "rejected" }, code: "STREAM_INVALID", terminal: null, reconcile: "none", resend: false },
    { input: { code: "STREAM_INVALID", phase: "accepted", effectKnowledge: "none", observationKind: "corrupt" }, code: "STORE_CORRUPT", terminal: null, reconcile: "repair", resend: false },
    { input: { code: "STREAM_INVALID", phase: "recovering", effectKnowledge: "possible", observationKind: "corrupt" }, code: "STORE_CORRUPT", terminal: null, reconcile: "repair", resend: false },
    { input: { code: "STORAGE_FULL", phase: "accepted", effectKnowledge: "none", observationKind: "unavailable" }, code: "STORAGE_FULL", terminal: null, reconcile: "observe", resend: false },
    { input: { code: "LIMIT_EXCEEDED", phase: "recovering", effectKnowledge: "none", observationKind: "unavailable" }, code: "LIMIT_EXCEEDED", terminal: null, reconcile: "observe", resend: false },
    { input: { code: "DEADLINE_EXCEEDED", phase: "accepted", effectKnowledge: "possible", observationKind: "unavailable" }, code: "DEADLINE_EXCEEDED", terminal: "unknown", reconcile: "reconcile", resend: false },
    { input: { code: "BUNDLE_INVALID", phase: "accepted", effectKnowledge: "none", observationKind: "rejected" }, code: "BUNDLE_INVALID", terminal: "failed", reconcile: "none", resend: false },
    { input: { code: "BUNDLE_INVALID", phase: "recovering", effectKnowledge: "possible", observationKind: "rejected" }, code: "BUNDLE_INVALID", terminal: "unknown", reconcile: "reconcile", resend: false },
    { input: { code: "PUBLISHED_REF_CONFLICT", phase: "recovering", effectKnowledge: "applied", observationKind: "present" }, code: "PUBLISHED_REF_CONFLICT", terminal: "unknown", reconcile: "reconcile", resend: false },
    { input: { code: "REQUEST_NOT_FOUND", phase: "preaccept", effectKnowledge: "none", observationKind: "absent" }, code: "REQUEST_NOT_FOUND", terminal: null, reconcile: "none", resend: true },
    { input: { code: "REQUEST_NOT_FOUND", phase: "accepted", effectKnowledge: "possible", observationKind: "absent" }, code: "REQUEST_NOT_FOUND", terminal: "unknown", reconcile: "reconcile", resend: false },
    { input: { code: "DB_BUSY", phase: "preaccept", effectKnowledge: "none", observationKind: "unavailable" }, code: "DB_BUSY", terminal: null, reconcile: "observe", resend: false },
  ];
  for (const entry of cases) {
    const policy = classifyError(entry.input);
    assert.equal(policy.code, entry.code, JSON.stringify(entry.input));
    assert.equal(policy.terminal, entry.terminal, JSON.stringify(entry.input));
    assert.equal(policy.reconcile, entry.reconcile, JSON.stringify(entry.input));
    assert.equal(policy.resendFrozen, entry.resend, JSON.stringify(entry.input));
  }
});

test("all public error codes preserve terminal rows and cannot authorize ambiguous resend", () => {
  for (const rawCode of Object.keys(ERROR_METADATA)) {
    assert.ok(isErrorCode(rawCode));
    for (const phase of ["preaccept", "accepted", "recovering", "terminal"] as const) {
      for (const effectKnowledge of ["none", "possible", "applied"] as const) {
        for (const observationKind of ["absent", "present", "rejected", "unavailable", "corrupt"] as const) {
          const policy = classifyError({ code: rawCode, phase, effectKnowledge, observationKind });
          if (phase === "terminal") assert.equal(policy.terminal, null);
          if (phase === "preaccept") assert.equal(policy.terminal, null);
          if (policy.resendFrozen) {
            assert.equal(rawCode, "REQUEST_NOT_FOUND");
            assert.equal(phase, "preaccept");
            assert.equal(effectKnowledge, "none");
            assert.equal(observationKind, "absent");
          }
          if (isPreacceptOnlyFailure(rawCode)) assert.notEqual(policy.terminal, "failed");
          if (effectKnowledge !== "none") assert.notEqual(policy.terminal, "failed");
        }
      }
    }
  }
  assert.equal(isErrorCode("__proto__"), false);
  assert.equal(isErrorCode("NEW_UNREVIEWED_ERROR"), false);
});

test("receipt projection is shared and never reparses or rewrites its decoded operation", () => {
  const rows: OperationLookup[] = [
    pending,
    receiptOperation({ state: "unknown" }),
    receiptOperation({ state: "failed", error_code: "CHECK_FAILED" }),
    receiptOperation({ state: "succeeded", result_json: '{"kind":"route.follow","topic":"work","subscribed":true}' }),
  ];
  for (const row of rows) {
    const before = JSON.stringify(row);
    const first = receiptOfOperation(row);
    assert.deepEqual(receiptOfOperation(row), first);
    assert.equal(JSON.stringify(row), before, "projection must not normalize durable bytes");
    assert.equal(Object.isFrozen(row), true);
    assert.equal(Object.hasOwn(first, "reason"), false, "no synthetic unknown wire field");
    if (first.state === "failed") assert.equal(first.error?.retry, "never");
  }
  for (const damaged of [
    { result_json: "{}" },
    { error_code: "INTERNAL_ERROR" },
    { state: "succeeded" },
    { state: "succeeded", result_json: "{" },
    { state: "succeeded", result_json: '{"kind":"route.unfollow","topic":"work","subscribed":false}' },
    { state: "failed" },
  ]) {
    let projections = 0;
    assert.throws(() => {
      const decoded = receiptOperation(damaged);
      projections++;
      receiptOfOperation(decoded);
    }, corrupt);
    assert.equal(projections, 0, "corrupt raw rows must not reach receipt projection");
  }
});

test("terminal receipt exit codes differ from uncertain direct failures", () => {
  assert.equal(receiptExit(receiptOfOperation(pending)), 0);
  assert.equal(receiptLines(receiptOfOperation(pending), "frozen-1")[0], "Accepted / not yet complete");
  assert.match(receiptLines(receiptOfOperation(pending), "frozen-1")[1]!, /--request frozen-1/);
  assert.equal(receiptExit(receiptOfOperation(receiptOperation({ state: "unknown" }))), 3);
  assert.equal(receiptExit(receiptOfOperation(receiptOperation({ state: "failed", error_code: "CHECK_FAILED" }))), 2);
  assert.equal(receiptExit(receiptOfOperation(receiptOperation({ state: "failed", error_code: "SPIKE_UNRESOLVED" }))), 4);
  assert.equal(errorExit("STORE_CORRUPT"), 3);
  assert.equal(errorExit("BROKER_UNAVAILABLE"), 3);
  assert.equal(errorExit("CAPABILITY_DENIED"), 2);
  assert.equal(errorExit("UNSUPPORTED_PROFILE"), 4);
  assert.equal(isRequestNotFound(receiptNotFound), true);
  assert.equal(isRequestNotFound(receiptOfOperation(receiptOperation({ state: "failed", error_code: "REQUEST_NOT_FOUND" }))), false);
});

test("public failures omit exception payloads and retain repair or lookup guidance", () => {
  const privateText = "private provider response and mail body";
  assert.deepEqual(publicFailure(new StoreError("STORE_CORRUPT", privateText)), {
    code: "STORE_CORRUPT", message: "STORE_CORRUPT", retry: "after-repair",
  });
  assert.deepEqual(publicFailure(new StoreError("DB_BUSY", privateText)), {
    code: "DB_BUSY", message: "DB_BUSY", retry: "same-key",
  });
  assert.deepEqual(publicFailure(new Error(privateText)), {
    code: "INTERNAL_ERROR", message: "INTERNAL_ERROR", retry: "same-key",
  });
  assert.deepEqual(publicFailure(new StoreError("REQUEST_NOT_FOUND", privateText)), {
    code: "REQUEST_NOT_FOUND", message: "REQUEST_NOT_FOUND", retry: "never",
  });
});
