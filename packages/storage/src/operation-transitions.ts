// DB-005/009: synchronous operation writes only. The backend never escapes to workflow callers.
import type { DatabaseSync } from "node:sqlite";
import type { OperationId } from "@oma/contracts/identity";
import type { ErrorCode } from "@oma/contracts/errors";
import type { NewOperation } from "@oma/contracts/ledger";

import { operationResultCheck } from "@oma/domain/validation";
import { operationResultRelationCheck, type OperationPlanContext } from "@oma/domain/durable";
import type { DecodedOperation } from "@oma/protocol/operation-codec";
import type { LedgerReader } from "./ledger-reader.js";
import type { TransactionScope } from "./transaction.js";
import { fullRow } from "./rows.js";
import { StoreError, isErrorCode, isPreacceptOnlyFailure } from "@oma/domain/errors";

export class OperationTransitions {
  constructor(private readonly db: Pick<DatabaseSync, "prepare">,
    private readonly read: Pick<LedgerReader, "operationById">, private readonly scope: TransactionScope,
    private readonly planContext: (operation: DecodedOperation) => OperationPlanContext,
    /** The store's one clock (P0V-126). */
    private readonly now: () => number = () => Date.now()) {}
  insert(operation: NewOperation): void {
    this.scope.requireLive();
    // P0V-56: created and updated are one event's single reading of the clock.
    const now = this.now();
    try {
      this.db.prepare(`INSERT INTO operations
        (id, actor, request_key, request_hash, kind, payload_json, plan_json, state, created_at_ms, updated_at_ms)
        VALUES (?,?,?,?,?,?,?, 'pending', ?, ?)`).run(operation.id, operation.actor, operation.requestKey, operation.requestHash,
        operation.kind, operation.payloadJson, operation.planJson, now, now);
      if (operation.kind === "attest.record")
        this.db.prepare("INSERT INTO attestations(operation_id) VALUES (?)").run(operation.id);
      this.scope.recordInserted(operation.id);
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed: operations.actor, operations.request_key/.test(error.message)) throw new StoreError("REQUEST_KEY_REUSED", "request key already used by this actor");
      throw error;
    }
  }
  updatePlan(id: OperationId, planJson: string): void {
    this.scope.requireLive(); this.scope.requireUnaccepted(id);
    const row = fullRow(this.db.prepare("SELECT state FROM operations WHERE id=?").get(id), ["state"], "unaccepted operation state");
    if (row.state !== "pending") throw new StoreError("STORE_CORRUPT", "terminal or unknown operation plan is immutable");
    const result = this.db.prepare("UPDATE operations SET plan_json=?, updated_at_ms=MAX(?, created_at_ms) WHERE id=? AND state='pending'").run(planJson, this.now(), id);
    if (Number(result.changes) !== 1) throw new StoreError("STORE_CORRUPT", "unaccepted plan update was not applied exactly once");
  }
  succeed(id: OperationId, resultJson: string): void {
    this.scope.requireLive(); const current = this.read.operationById(id);
    if (!current) throw new StoreError("STORE_CORRUPT", `missing operation ${id}`);
    let result: unknown;
    try { result = JSON.parse(resultJson); } catch { throw new StoreError("STORE_CORRUPT", `operation ${id} result is not valid JSON`); }
    const invalid = operationResultCheck(current.kind)(result) ?? operationResultRelationCheck(current.kind, current.plan, result, this.planContext(current));
    if (invalid) throw new StoreError("STORE_CORRUPT", `operation ${id} result: ${invalid}`);
    if (current.state === "succeeded") {
      if (current.resultJson === resultJson) return;
      throw new StoreError("STORE_CORRUPT", `operation ${id} terminal state is immutable`);
    }
    if (current.state === "failed") throw new StoreError("STORE_CORRUPT", `operation ${id} terminal state is immutable`);
    const updated = this.db.prepare("UPDATE operations SET state='succeeded', result_json=?, error_code=NULL, updated_at_ms=MAX(?, created_at_ms) WHERE id=? AND state IN ('pending','unknown')").run(resultJson, this.now(), id);
    if (Number(updated.changes) !== 1) throw new StoreError("STORE_CORRUPT", `operation ${id} transition was not applied exactly once`);
  }
  fail(id: OperationId, code: ErrorCode): void {
    this.scope.requireLive();
    if (!isErrorCode(code) || isPreacceptOnlyFailure(code)) throw new StoreError("STORE_CORRUPT", `accepted operation ${id} cannot transition to preaccept or invalid failure`);
    const current = this.read.operationById(id);
    if (!current) throw new StoreError("STORE_CORRUPT", `missing operation ${id}`);
    if (current.state === "failed" && current.errorCode === code) return;
    if (current.state === "failed" || current.state === "succeeded") throw new StoreError("STORE_CORRUPT", `operation ${id} terminal state is immutable`);
    const updated = this.db.prepare("UPDATE operations SET state='failed', result_json=NULL, error_code=?, updated_at_ms=MAX(?, created_at_ms) WHERE id=? AND state IN ('pending','unknown')").run(code, this.now(), id);
    if (Number(updated.changes) !== 1) throw new StoreError("STORE_CORRUPT", `operation ${id} transition was not applied exactly once`);
  }
  unknown(id: OperationId): void {
    this.scope.requireLive(); const current = this.read.operationById(id);
    if (!current) throw new StoreError("STORE_CORRUPT", `missing operation ${id}`);
    if (current.state === "unknown") return;
    if (current.state !== "pending") throw new StoreError("STORE_CORRUPT", `operation ${id} terminal state is immutable`);
    const result = this.db.prepare("UPDATE operations SET state='unknown', updated_at_ms=MAX(?, created_at_ms) WHERE id=? AND state='pending'").run(this.now(), id);
    if (Number(result.changes) !== 1) throw new StoreError("STORE_CORRUPT", `operation ${id} transition was not applied exactly once`);
  }
}
