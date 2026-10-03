/** P6: an administrator's bounded read snapshot, not another durable entity.
 * One supported schema version means one fixed ledger table set. */
export const LEDGER_TABLES = Object.freeze([
  "agents", "operations", "subscriptions", "deliveries", "batches", "attestations",
] as const);
export type LedgerTable = typeof LEDGER_TABLES[number];
export interface DiagnosticSnapshot {
  readonly schemaVersion: number;
  readonly tables: Readonly<Record<LedgerTable, readonly unknown[]>>;
  readonly integrity: readonly string[];
  readonly foreignKeys: readonly unknown[];
}
export interface DiagnosticReadLimits {
  readonly maxRows: number;
  readonly maxBytes: number;
  readonly maxDatabaseBytes: number;
}
/** Shared finite ledger-read budgets: admin snapshots and operational full-set
 * collectors. Only admin snapshots use maxDatabaseBytes; no host setting is added. */
export const DIAGNOSTIC_READ_LIMITS: DiagnosticReadLimits = Object.freeze({
  maxRows: 10000, maxBytes: 32 * 1024 * 1024, maxDatabaseBytes: 64 * 1024 * 1024,
});
