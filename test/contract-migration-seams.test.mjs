import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { contractOwners, migrateContractImports } from "../scripts/contract-imports.mjs";
const owners = contractOwners(fs.readFileSync("implementation/contracts.ts", "utf8"));
const migrate = text => migrateContractImports(text, "src/lifecycle/example.ts", owners).text;
const js = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, removeComments: true } }).outputText;
test("P2 migration: aliases and runtime bytes survive a multi-owner import", () => {
  const source = 'import type { Actor as Owner, Receipt, AuthContext, HostConfigV1 } from "../../implementation/contracts.js";\nexport const value = 42;';
  const after = migrate(source);
  assert.match(after, /Actor as Owner.*contracts\/identity.js/);
  assert.match(after, /Receipt.*contracts\/durable.js/);
  assert.match(after, /AuthContext.*contracts\/runtime.js/);
  assert.match(after, /HostConfigV1.*contracts\/host.js/);
  assert.equal(js(after), js(source));
  assert.equal(migrate(after), after);
});
test("P2 migration: per-specifier types and qualified inline import types are narrowed", () => {
  const source = 'import { type Receipt as R } from "../../implementation/contracts.js"; type X = import("../../implementation/contracts.js").PublicMethods["mail.send"]; export type { OperationPlan as Plan } from "../../implementation/contracts.js";';
  const after = migrate(source);
  assert.match(after, /import type \{ Receipt as R \}/);
  assert.match(after, /contracts\/public-wire.js/);
  assert.match(after, /export type \{ OperationPlan as Plan \}/);
  assert.equal(js(after), js(source));
});
test("P2 migration: runtime, wildcard and unknown imports fail closed", () => {
  for (const source of [
    'import { Receipt } from "../../implementation/contracts.js";',
    'import type * as C from "../../implementation/contracts.js";',
    'import "../../implementation/contracts.js";',
    'export type * from "../../implementation/contracts.js";',
    'type C = import("../../implementation/contracts.js");',
    'import type { Missing } from "../../implementation/contracts.js";',
  ]) assert.throws(() => migrate(source));
});
test("P2 migration: facade owner changes are followed, duplicate/empty owners rejected", () => {
  const custom = contractOwners('export type { Internal as External } from "./contracts/value.js";');
  const after = migrateContractImports('import type { External as X } from "../../implementation/contracts.js";', "src/a/b.ts", custom).text;
  assert.match(after, /Internal as X/);
  assert.throws(() => contractOwners(""));
  assert.throws(() => contractOwners('export type { A } from "./a.js"; export type { A } from "./b.js";'));
});
