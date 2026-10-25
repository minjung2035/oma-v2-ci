/** P6: independent set/cross-row inspection. Never runs transitions or reconcile. */
import { isAbsolute } from "node:path";
import { LEDGER_TABLES, type LedgerTable } from "@oma/storage/diagnostic-snapshot";
import { decodeOperation, type DecodedOperation } from "@oma/protocol/operation-codec";
import { decodeAgentRow, decodeSubscriptionRow, decodeDeliveryRow, decodeBatchRow, decodeBatchManifest } from "@oma/storage/rows";
import { type AgentRow, type SubscriptionRow, type DeliveryRow, type BatchRow } from "@oma/contracts/ledger";
import { LineageSnapshot } from "@oma/domain/lineage";
import { isValidOperationId, isValidSocietyName } from "@oma/domain/identifiers";
import { ownedMessages } from "@oma/domain/durable";
import { fullRow, safeInteger } from "@oma/storage/rows";
import { SCHEMA_USER_VERSION_READABLE } from "@oma/protocol/persisted-formats";
import { StoreError } from "@oma/domain/errors";

export type DiagnosticSeverity = "corrupt" | "unknown";
export interface DiagnosticIssue {
  readonly severity: DiagnosticSeverity;
  readonly code: string;
  readonly entity: LedgerTable | "snapshot" | "filesystem" | "git" | "units";
  readonly identity: string | null;
}
export interface IntegrityReport {
  readonly status: "PASS" | "FAIL" | "UNKNOWN";
  readonly issues: readonly DiagnosticIssue[];
  readonly issueCount: number;
  readonly truncated: boolean;
  readonly scanned: Readonly<Record<LedgerTable, number>>;
  readonly pendingOperations: number;
  readonly unknownOperations: number;
}
export interface LedgerFacts {
  readonly agents: readonly AgentRow[];
  readonly operations: readonly DecodedOperation[];
  readonly subscriptions: readonly SubscriptionRow[];
  readonly deliveries: readonly DeliveryRow[];
  readonly batches: readonly BatchRow[];
}
export interface InspectionContext { readonly stateRoot: string; readonly society: string }
export class DiagnosticLedger {
  private readonly entries: DiagnosticIssue[] = [];
  private total = 0;
  private corrupt = false;
  private unknown = false;
  constructor(private readonly maxIssues = 100) {
    if (!Number.isSafeInteger(maxIssues) || maxIssues < 1) throw new RangeError("invalid diagnostic issue budget");
  }
  add(severity: DiagnosticSeverity, code: string, entity: DiagnosticIssue["entity"], identity: string | null = null): void {
    this.total++;
    this.corrupt ||= severity === "corrupt";
    this.unknown ||= severity === "unknown";
    if (this.entries.length < this.maxIssues) this.entries.push(Object.freeze({ severity, code, entity, identity }));
  }
  report(facts: LedgerFacts, scanned: Record<LedgerTable, number>): IntegrityReport {
    return Object.freeze({ status: this.corrupt ? "FAIL" : this.unknown || this.total > this.entries.length ? "UNKNOWN" : "PASS",
      issues: Object.freeze([...this.entries]), issueCount: this.total, truncated: this.total > this.entries.length,
      scanned: Object.freeze({ ...scanned }),
      pendingOperations: facts.operations.filter(row => row.state === "pending").length,
      unknownOperations: facts.operations.filter(row => row.state === "unknown").length });
  }
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function closed(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return record(value) && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
}
const messageOf = (operation: DecodedOperation, messageId: string) =>
  ownedMessages(operation.plan).find(message => message.id === messageId);

/** PASS means consistency in this snapshot, NOT settled effects or release proof.
 * Pending/unknown intent remains pending/unknown; historical intent is not
 * compared to today's desired state or subscription membership.
 */
export function inspectLedger(raw: unknown, context: InspectionContext, options: { maxRows?: number; maxIssues?: number } = {}) {
  const ledger = new DiagnosticLedger(options.maxIssues);
  const scanned: Record<LedgerTable, number> = { agents: 0, operations: 0, subscriptions: 0, deliveries: 0, batches: 0, attestations: 0 };
  const facts: { -readonly [K in keyof LedgerFacts]: LedgerFacts[K][number][] } = {
    agents: [], operations: [], subscriptions: [], deliveries: [], batches: [],
  };
  const finish = () => {
    for (const rows of Object.values(facts)) { for (const row of rows) Object.freeze(row); Object.freeze(rows); }
    return { facts: Object.freeze(facts) as LedgerFacts, ledger, scanned, report: ledger.report(facts, scanned) };
  };
  const maxRows = options.maxRows ?? 10000;
  if (!Number.isSafeInteger(maxRows) || maxRows < 1) throw new RangeError("invalid diagnostic row budget");
  if (!isAbsolute(context.stateRoot) || !isValidSocietyName(context.society) ||
      !closed(raw, ["schemaVersion", "tables", "integrity", "foreignKeys"]) ||
      (typeof raw.schemaVersion !== "number" || !SCHEMA_USER_VERSION_READABLE.includes(raw.schemaVersion)) || !closed(raw.tables, LEDGER_TABLES) ||
      !Array.isArray(raw.integrity) || !Array.isArray(raw.foreignKeys)) {
    ledger.add("corrupt", "UNSUPPORTED_OR_INVALID_SNAPSHOT", "snapshot"); return finish();
  }
  const tables: Record<LedgerTable, readonly unknown[]> = { agents: [], operations: [], subscriptions: [], deliveries: [], batches: [], attestations: [] };
  let totalRows = 0;
  for (const table of LEDGER_TABLES) {
    const rows = raw.tables[table];
    if (!Array.isArray(rows)) { ledger.add("corrupt", "INVALID_TABLE_SNAPSHOT", table); return finish(); }
    totalRows += rows.length;
    if (totalRows > maxRows) { ledger.add("unknown", "ROW_BUDGET_EXCEEDED", "snapshot"); return finish(); }
    tables[table] = rows; scanned[table] = rows.length;
  }
  if (raw.integrity.length !== 1 || raw.integrity[0] !== "ok") ledger.add("corrupt", "SQLITE_INTEGRITY", "snapshot");
  if (raw.foreignKeys.length) ledger.add("corrupt", "SQLITE_FOREIGN_KEY", "snapshot");
  const check = <T>(entity: LedgerTable, identity: string | null, body: () => T): T | undefined => {
    try { return body(); }
    catch (error) { ledger.add(error instanceof StoreError && error.code === "STORE_CORRUPT" ? "corrupt" : "unknown",
      error instanceof StoreError && error.code === "STORE_CORRUPT" ? "INVALID_ROW_OR_RELATION" : "VALIDATION_UNAVAILABLE", entity, identity); return undefined; }
  };
  const decoded = <T>(table: LedgerTable, decode: (value: unknown) => T): T[] => {
    const result: T[] = [];
    for (const row of tables[table]) { const value = check(table, null, () => decode(row)); if (value !== undefined) result.push(value); }
    return result;
  };
  const unique = <T>(rows: readonly T[], key: (row: T) => string, table: LedgerTable): Map<string, T> => {
    const index = new Map<string, T>();
    for (const row of rows) {
      const id = key(row);
      if (index.has(id)) ledger.add("corrupt", "DUPLICATE_IDENTITY", table, id);
      else index.set(id, row);
    }
    return index;
  };
  const expect = (condition: boolean, table: LedgerTable, identity: string, code: string) => {
    if (!condition) ledger.add("corrupt", code, table, identity);
  };
  facts.agents = decoded("agents", decodeAgentRow);
  facts.subscriptions = decoded("subscriptions", decodeSubscriptionRow);
  facts.deliveries = decoded("deliveries", decodeDeliveryRow);
  facts.batches = decoded("batches", decodeBatchRow);
  const agents = unique(facts.agents, row => row.name, "agents");
  const batches = unique(facts.batches, row => row.id, "batches");
  unique(facts.subscriptions, row => `${row.topic}/${row.agent}`, "subscriptions");
  const deliveries = unique(facts.deliveries, row => `${row.messageId}/${row.recipient}`, "deliveries");
  check("agents", null, () => new LineageSnapshot(facts.agents));
  const rawAgents = new Map<string, unknown>();
  for (const row of tables.agents) if (record(row) && typeof row.name === "string" && agents.has(row.name)) rawAgents.set(row.name, row);
  const rawOperations = new Map<string, unknown>();
  for (const row of tables.operations) {
    if (!record(row) || !isValidOperationId(row.id)) { ledger.add("corrupt", "INVALID_OPERATION_ID", "operations"); continue; }
    if (rawOperations.has(row.id)) ledger.add("corrupt", "DUPLICATE_IDENTITY", "operations", row.id);
    else rawOperations.set(row.id, row);
  }
  const byOperation = new Map<string, unknown[]>();
  for (const row of tables.deliveries) if (record(row) && typeof row.operation_id === "string") {
    const values = byOperation.get(row.operation_id) ?? []; values.push(row); byOperation.set(row.operation_id, values);
  }
  const rawAttestations = new Map<string, unknown>();
  const sequences = new Set<number>();
  for (const row of tables.attestations) check("attestations", null, () => {
    const value = fullRow(row, ["sequence", "operation_id"], "attestation index");
    const sequence = safeInteger(value.sequence, "attestation sequence", 1);
    if (!isValidOperationId(value.operation_id) || rawAttestations.has(value.operation_id) || sequences.has(sequence))
      throw new StoreError("STORE_CORRUPT", "invalid or duplicate attestation index");
    const operation = rawOperations.get(value.operation_id);
    if (!record(operation) || operation.kind !== "attest.record") throw new StoreError("STORE_CORRUPT", "attestation index has no fact");
    sequences.add(sequence); rawAttestations.set(value.operation_id, value);
  });
  for (const [id, row] of rawOperations) {
    const operation = check("operations", id, () => decodeOperation(row, { stateRoot: context.stateRoot,
      repositoryIdentity: { society: context.society }, relations: {
        attestation: target => rawAttestations.get(target) ?? null,
        operation: target => rawOperations.get(target) ?? null,
        agent: target => rawAgents.get(target) ?? null,
        deliveries: target => byOperation.get(target) ?? [],
      } }));
    if (operation) {
      facts.operations.push(operation);
      expect(agents.has(operation.actor), "operations", id, "MISSING_ACTOR");
      expect(operation.updatedAtMs >= operation.createdAtMs, "operations", id, "TIME_REGRESSION");
    }
  }
  const operations = unique(facts.operations, row => row.id, "operations");
  unique(facts.operations, row => `${row.actor}/${row.requestKey}`, "operations");
  for (const row of facts.subscriptions) expect(agents.has(row.agent), "subscriptions", `${row.topic}/${row.agent}`, "MISSING_ACTOR");
  for (const row of facts.deliveries) {
    const identity = `${row.messageId}/${row.recipient}`;
    expect(agents.has(row.recipient), "deliveries", identity, "MISSING_RECIPIENT");
    const operation = operations.get(row.operationId), message = operation ? messageOf(operation, row.messageId) : undefined;
    expect(message !== undefined && message.recipients.includes(row.recipient), "deliveries", identity, "MESSAGE_OWNERSHIP");
    if (row.batchId !== null) {
      const batch = batches.get(row.batchId);
      expect(batch !== undefined && batch.agent === row.recipient && decodeBatchManifest(batch.messageIdsJson).includes(row.messageId) &&
        (batch.state === "completed") === (row.presented === 1), "deliveries", identity, "BATCH_OWNERSHIP");
    }
  }
  for (const row of facts.batches) {
    const actor = agents.get(row.agent);
    expect(actor !== undefined && row.incarnation <= actor.incarnation, "batches", row.id, "BATCH_INCARNATION");
    const manifest = decodeBatchManifest(row.messageIdsJson);
    const linked = facts.deliveries.filter(value => value.batchId === row.id);
    expect(linked.length === manifest.length && linked.every(value => value.recipient === row.agent) &&
      manifest.every(id => linked.some(value => value.messageId === id && value.recipient === row.agent)), "batches", row.id, "BATCH_EXACT_SET");
  }
  for (const operation of facts.operations) if (operation.kind === "mail.ack" && operation.state === "succeeded")
    expect(deliveries.get(`${operation.plan.message}/${operation.plan.recipient}`)?.acknowledged === 1,
      "operations", operation.id, "ACK_FACT_MISSING");
  return finish();
}
