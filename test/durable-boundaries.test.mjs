/** P0-7 (PRIORITY-0.md): the durable boundaries come from the code, and each
 * one has a test that kills, retries or restarts right after it. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkDurableBoundaries, durableBoundaries } from "../scripts/durable-boundaries.mjs";

test("P0-7: every durable boundary in the code has a registered kill/retry/restart test", () => {
  assert.deepEqual(checkDurableBoundaries(), []);
  assert.ok(durableBoundaries().length > 40, "the scan finds the product's boundaries");
});

test("P0-7: a new boundary without a test, a stale entry, or a test that does not exist is a finding", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-p0-7-"));
  try {
    mkdirSync(join(root, "src")); mkdirSync(join(root, "test")); mkdirSync(join(root, "implementation"));
    writeFileSync(join(root, "production-files.txt"), "src/owner.ts\n");
    writeFileSync(join(root, "src/owner.ts"), "export function commitIt(store) { store.transaction(tx => tx.x()); }\n");
    writeFileSync(join(root, "test/it.test.mjs"), 'test("kills right after commitIt", () => {});\n');
    const registry = boundaries => writeFileSync(join(root, "implementation/durable-boundaries.json"), JSON.stringify({ boundaries }));
    registry([]);
    assert.match(checkDurableBoundaries(root).join("\n"), /src\/owner\.ts#commitIt: a durable boundary \(db-commit\) has no registered/);
    registry([{ owner: "src/owner.ts#commitIt", fact: "a fact", tests: [{ file: "test/it.test.mjs", title: "a test that is not there" }] },
      { owner: "src/owner.ts#gone", fact: "a fact", tests: [{ file: "test/it.test.mjs", title: "kills right after commitIt" }] }]);
    const findings = checkDurableBoundaries(root).join("\n");
    assert.match(findings, /has no test titled "a test that is not there"/);
    assert.match(findings, /src\/owner\.ts#gone: registered, but no such durable boundary exists/);
    registry([{ owner: "src/owner.ts#commitIt", fact: "a fact", tests: [{ file: "test/it.test.mjs", title: "kills right after commitIt" }] }]);
    assert.deepEqual(checkDurableBoundaries(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
