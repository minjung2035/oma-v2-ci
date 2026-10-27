/** DB-005/009: operation durability mechanism, not a workflow engine.
 * SQL/terminal immutability stay in OperationTransitions, decoding in LedgerReader,
 * and the single live transaction remains owned by Store/TransactionScope.
 */
import type { Actor, OperationId, RequestKey } from "@oma/contracts/identity";
import type { ErrorCode } from "@oma/contracts/errors";
import type { LedgerReader } from "./ledger-reader.js";
import type { OperationTransitions } from "./operation-transitions.js";
import type { NewOperation } from "@oma/contracts/ledger";
import type { TransactionScope } from "./transaction.js";
import { StoreError } from "@oma/domain/errors";

import { reused } from "@oma/domain/request-identity";
export type KeyClassification = "retry" | "reused" | "absent";

/** No database connection, transaction runner, effect callback or recovery policy
 * is accepted here. Coordinators still spell out their physical ordering.
 */
export class OperationJournal {
  constructor(
    private readonly read: Pick<LedgerReader, "operation" | "operationById" | "recoverableIds">,
    private readonly write: OperationTransitions,
    private readonly scope: Pick<TransactionScope, "requireLive">,
  ) {}

  get(actor: Actor, key: RequestKey) { return this.read.operation(actor, key); }
  getById(id: OperationId) { return this.read.operationById(id); }
  recoverableIds() { return this.read.recoverableIds(); }

  classifyKey(actor: Actor, key: RequestKey, hash: string): KeyClassification {
    const existing = this.get(actor, key);
    return existing === null ? "absent" : existing.requestHash === hash ? "retry" : "reused";
  }

  insert(operation: NewOperation): void { this.write.insert(operation); }

  /** Identical key/hash means lookup, never permission to replay an effect. */
  accept(operation: NewOperation): "inserted" | "retry" {
    this.scope.requireLive();
    const before = this.classifyKey(operation.actor, operation.requestKey, operation.requestHash);
    if (before === "retry") return "retry";
    if (before === "reused") throw reused(operation.actor, operation.requestKey);
    try { this.insert(operation); return "inserted"; }
    catch (error) {
      if (error instanceof StoreError && error.code === "REQUEST_KEY_REUSED") {
        if (this.classifyKey(operation.actor, operation.requestKey, operation.requestHash) === "retry") return "retry";
        throw reused(operation.actor, operation.requestKey);
      }
      throw error;
    }
  }

  /** Only the original, not-yet-committed acceptance transaction may prepare. */
  prepare(id: OperationId, planJson: string): void { this.write.updatePlan(id, planJson); }
  succeed(id: OperationId, resultJson: string): void { this.write.succeed(id, resultJson); }
  fail(id: OperationId, code: ErrorCode): void { this.write.fail(id, code); }
  markUnknown(id: OperationId): void { this.write.unknown(id); }
}
