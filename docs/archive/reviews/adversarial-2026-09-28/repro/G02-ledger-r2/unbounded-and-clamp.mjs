// G02-ledger-r2 repro: (1) confirm no UPDATE at_ms write can violate the
// updated_at_ms>=created_at_ms CHECK under wall-clock regression (positive
// control, complementing the shipped r12 test), and (2) demonstrate that the
// LedgerReader full-table reads (listAgents/usages/allSubscriptions) are
// unbounded: N rows in the ledger => N decoded objects held in memory at once,
// with no LIMIT and no caller-supplied cap.
//
// Rules: dist import, mkdtemp under /tmp/oma-adv-*, cleaned at end.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { Store } from "../../../../dist/src/store.js";
import { requestHash } from "../../../../dist/src/hash.js";

// Minimal valid resident spec (mirrors dist/test/fixtures/spec.js shape).
import { makeValidAgent } from "../../../../dist/test/fixtures/spec.js";

const root = mkdtempSync(join(tmpdir(), "oma-adv-G02-ledger-r2-"));
const store = new Store(join(root, "runtime.sqlite"));
try {
  // ---- Part 1: clock regression clamp holds on agent UPDATE ----
  const realNow = Date.now;
  let fake = Date.UTC(2026, 8, 28, 12);
  Date.now = () => fake;
  store.transaction(tx => tx.insertAgent(makeValidAgent("alice")));
  const created = store.getAgent("alice").createdAtMs;
  const startDesired = store.getAgent("alice").desired;
  // Step the wall clock back one hour, then move the agent's desired state.
  fake = created - 3_600_000;
  const nextDesired = startDesired === "provisioning" ? "enabled" : startDesired === "enabled" ? "stopped" : "enabled";
  store.transaction(tx => tx.updateAgent({ name: "alice", desired: nextDesired }));
  const after = store.getAgent("alice");
  assert.ok(after.updatedAtMs >= after.createdAtMs,
    `CLAMP FAILED: updated ${after.updatedAtMs} < created ${after.createdAtMs}`);
  assert.equal(after.updatedAtMs, created, "clamp should pin updated to created on backward clock");
  Date.now = realNow;
  console.log(`PART1 clamp OK: created=${created} updated=${after.updatedAtMs}`);

  // ---- Part 2: unbounded full-table read ----
  const N = 2000;
  store.transaction(tx => {
    for (let i = 0; i < N; i++) tx.insertAgent(makeValidAgent(`r${String(i).padStart(5, "0")}`));
  });
  const before = process.memoryUsage().heapUsed;
  const all = store.listAgents(); // SELECT * FROM agents ORDER BY name -- no LIMIT
  const grew = process.memoryUsage().heapUsed - before;
  assert.equal(all.length, N + 1, "listAgents returns every row with no cap");
  console.log(`PART2 unbounded OK: listAgents returned ${all.length} decoded rows in one array (~${(grew/1024/1024).toFixed(1)}MB heap growth); no LIMIT, no caller cap`);
} finally {
  store.close();
  rmSync(root, { recursive: true, force: true });
}
