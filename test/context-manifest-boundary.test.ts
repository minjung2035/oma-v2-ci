import test from "node:test";
import assert from "node:assert/strict";
import { contextEntriesCheck } from "@oma/domain/context-policy";

const digest = "0123456789abcdef".repeat(4);
const goal = Object.freeze({ path: "GOAL.md", bytes: 12, sha256: digest });
const decision = Object.freeze({ path: "decisions/0001.md", bytes: 8, sha256: digest });
const valid = Object.freeze([goal, decision]);

function check(value: unknown): string | null {
  return contextEntriesCheck(value, { requireSorted: true });
}

test("a canonical manifest retains its frozen order and exact metadata", () => {
  const before = JSON.stringify(valid);
  assert.equal(check(valid), null);
  assert.equal(contextEntriesCheck(valid, { requireSorted: true, contentBytes: 20 }), null);
  assert.equal(JSON.stringify(valid), before);
});

// Physical effect spies are exercised by context-recovery-corruption-oracle.test.ts.
test("unsafe paths are rejected by the canonical manifest policy", () => {
  for (const path of ["../GOAL.md", "/GOAL.md", ".git/config", "decisions/../GOAL.md", "decisions/nested/one.md", "decisions\\one.md", "GOAL.md\0"]) {
    assert.notEqual(check([{ ...goal, path }]), null, path);
  }
});

test("duplicate unordered and incomplete manifests are rejected instead of repaired", () => {
  const cases: unknown[] = [
    [goal, goal], [decision, goal], [decision], [],
    [{ ...goal, injected: true }], [{ path: "GOAL.md", bytes: 12 }],
  ];
  for (const value of cases) {
    const before = JSON.stringify(value);
    assert.notEqual(check(value), null, before);
    assert.equal(JSON.stringify(value), before);
  }
});

test("manifest byte and digest validation rejects coercion and aggregate overflow", () => {
  for (const bytes of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY, "12", null]) {
    assert.notEqual(check([{ ...goal, bytes }]), null, String(bytes));
  }
  for (const sha256 of [digest.toUpperCase(), digest.slice(1), `${digest}0`, "z".repeat(64), null]) {
    assert.notEqual(check([{ ...goal, sha256 }]), null, String(sha256));
  }
  assert.notEqual(check([{ ...goal, bytes: Number.MAX_SAFE_INTEGER }, decision]), null);
  assert.notEqual(contextEntriesCheck(valid, { requireSorted: true, contentBytes: 19 }), null);
  assert.notEqual(contextEntriesCheck(valid, { requireSorted: true, maxBytes: 19 }), null);
  assert.notEqual(contextEntriesCheck(valid, { requireSorted: true, maxFiles: 1 }), null);
  assert.equal(check([{ ...goal, bytes: 0 }]), null, "entry shape is distinct from nonempty GOAL content policy");
});
