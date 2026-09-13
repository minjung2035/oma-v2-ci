/** P6: an administrator's bounded read snapshot, not another durable entity. */
export const LEDGER_TABLES = Object.freeze([
  "agents", "operations", "subscriptions", "deliveries", "batches", "usage",
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
/** Defaults bound this admin tool only; no host/runtime configuration is added. */
export const DIAGNOSTIC_READ_LIMITS: DiagnosticReadLimits = Object.freeze({
  maxRows: 10000, maxBytes: 32 * 1024 * 1024, maxDatabaseBytes: 64 * 1024 * 1024,
});
