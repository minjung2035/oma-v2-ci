// INF-003: pure arithmetic; the caller owns reservation transaction atomicity.
import { LineageSnapshot, type LineageNode } from "./lineage.js";
import { StoreError } from "./errors.js";

export interface UsageCostFact {
  readonly actor: string;
  readonly outcome: "reserved" | "completed" | "cancelled" | "unknown";
  readonly reservedUnits: number;
  readonly reportedUnits: number | null;
}
export interface BudgetLimits {
  readonly societyUnits: number; readonly lineageUnits: number; readonly principalReservedUnits: number;
}
function unitsOf(row: UsageCostFact): number {
  const value = row.outcome === "completed" || row.outcome === "cancelled" ? row.reportedUnits : row.reservedUnits;
  if (value === null || !Number.isSafeInteger(value) || value < 0)
    throw new StoreError("STORE_CORRUPT", "invalid settled usage units");
  return value;
}
export function sumUsage<N extends LineageNode>(
  graph: LineageSnapshot<N>, usage: readonly UsageCostFact[], root: string | null, residentsOnly = false,
): number {
  const names = new Set((root === null ? graph.all() : graph.descendants(root)).map(node => node.name));
  let total = 0;
  for (const row of usage) {
    graph.node(row.actor); // unknown attribution is corruption, never silently excluded
    if (!names.has(row.actor) || (residentsOnly && row.actor === "principal")) continue;
    total += unitsOf(row);
    if (!Number.isSafeInteger(total)) throw new StoreError("STORE_CORRUPT", "usage sum exceeds integer range");
  }
  return total;
}
export function permitsReservation<N extends LineageNode>(
  graph: LineageSnapshot<N>, usage: readonly UsageCostFact[], cfg: BudgetLimits,
  actor: string, requestedUnits: number, isPrincipal: boolean,
): boolean {
  graph.node(actor);
  if (!Number.isSafeInteger(requestedUnits) || requestedUnits < 0) return false;
  for (const limit of [cfg.societyUnits, cfg.lineageUnits, cfg.principalReservedUnits])
    if (!Number.isSafeInteger(limit) || limit < 0) throw new StoreError("UNSUPPORTED_PROFILE", "invalid inference budget limit");
  if (cfg.principalReservedUnits > cfg.societyUnits) throw new StoreError("UNSUPPORTED_PROFILE", "principal reserve exceeds society budget");
  if (requestedUnits > cfg.societyUnits - sumUsage(graph, usage, null)) return false;
  if (!isPrincipal && requestedUnits > cfg.societyUnits - cfg.principalReservedUnits - sumUsage(graph, usage, null, true)) return false;
  // Includes the actor itself and every ancestor (including Principal), as before.
  for (const ancestor of graph.ancestors(actor))
    if (requestedUnits > cfg.lineageUnits - sumUsage(graph, usage, ancestor.name)) return false;
  return true;
}
