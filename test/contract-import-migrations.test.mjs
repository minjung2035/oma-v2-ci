import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { contractOwners, contractImportSnapshot } from "../scripts/contract-imports.mjs";

const root = new URL("../", import.meta.url);
const read = file => readFileSync(new URL(file, root), "utf8");
const owners = contractOwners(read("implementation/contracts.ts"));
const inventory = JSON.parse(read("test/fixtures/contract-import-migrations.json"));

test("P2 import migration: each recorded subsystem preserves aliases and non-import tokens", () => {
  assert.ok(Object.keys(inventory.files).length > 0);
  for (const [file, { sourceBlob, ...expected }] of Object.entries(inventory.files)) {
    assert.match(sourceBlob, /^[0-9a-f]{40}$/);
    assert.deepEqual(contractImportSnapshot(file, read(file), owners, { requireNarrow: true }), expected, file);
  }
});
test("P2 import migration: facade, wrong owner, alias drift, runtime import and code mutation cannot pass", () => {
  const file = "src/sample.ts";
  const before = 'import type { Actor as Name } from "../implementation/contracts.js"; export type Example = Name;';
  const after = before.replace('contracts.js', 'contracts/identity.js');
  const snapshot = contractImportSnapshot(file, before, owners);
  assert.deepEqual(contractImportSnapshot(file, after, owners, { requireNarrow: true }), snapshot);
  for (const invalid of [before, after.replace('/identity.js', '/runtime.js'), after.replace('import type', 'import')])
    assert.throws(() => contractImportSnapshot(file, invalid, owners, { requireNarrow: true }));
  assert.notDeepEqual(contractImportSnapshot(file, after.replace('as Name', 'as Other'), owners), snapshot);
  assert.notDeepEqual(contractImportSnapshot(file, after.replace('= Name', '= string'), owners), snapshot);
});
test("P2 import migration: inline public DTO references resolve to the declared leaf owner", () => {
  const file = "src/sample.ts", before = 'export type Input = import("../implementation/contracts.js").MailInput;';
  const after = before.replace('contracts.js', 'contracts/values.js');
  assert.deepEqual(contractImportSnapshot(file, after, owners, { requireNarrow: true }), contractImportSnapshot(file, before, owners));
  assert.throws(() => contractImportSnapshot(file, after.replace('/values.js', '/public-wire.js'), owners, { requireNarrow: true }));
});
