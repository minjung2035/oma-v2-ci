/** P6: an administrator's bounded read snapshot, not another durable entity. */
export const LEDGER_TABLES = Object.freeze([
  "agents", "operations", "subscriptions", "deliveries", "batches", "usage", "attestations",
] as const);
export const V1_LEDGER_TABLES = Object.freeze(LEDGER_TABLES.filter(table => table !== "attestations"));
export function ledgerTables(version: number): readonly LedgerTable[] {
  return version === 1 ? V1_LEDGER_TABLES : LEDGER_TABLES;
}
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
