import assert from "node:assert/strict";
import type { LedgerSnapshot } from "./store.js";

/** Independent arithmetic oracle: never call production's effective-cost helper. */
export function assertUsage(snapshot: LedgerSnapshot): ReadonlyMap<string, number> {
  const totals = new Map<string, number>();
  for (const row of snapshot.usage) {
    const amount = row.outcome === "reserved" || row.outcome === "unknown" ? row.reservedUnits : row.reportedUnits;
    assert.ok(typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 0, "USAGE_EFFECTIVE_AMOUNT");
    assert.ok(snapshot.agents.some(agent => agent.name === row.actor && agent.incarnation >= row.incarnation), "USAGE_OWNER_OR_FUTURE_RUN");
    const next = (totals.get(row.actor) ?? 0) + amount;
    assert.ok(Number.isSafeInteger(next), "USAGE_TOTAL_OVERFLOW"); totals.set(row.actor, next);
    if (row.detailsJson !== null) {
      const details: unknown = JSON.parse(row.detailsJson);
      assert.ok(details !== null && typeof details === "object" && !Array.isArray(details), "USAGE_DETAILS_SHAPE");
      for (const key of Object.keys(details))
        assert.ok(!/payload|prompt|token.?stream|response.?body|credential|authorization/i.test(key), "USAGE_PRIVATE_PAYLOAD");
    }
  }
  return totals;
}
