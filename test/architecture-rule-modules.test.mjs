import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { importRuleFindings } from "../scripts/architecture/rules/import-rules.mjs";
import { transactionRuleFindings } from "../scripts/architecture/rules/transaction-rules.mjs";
import { ownershipRuleFindings } from "../scripts/architecture/rules/ownership-rules.mjs";
import { schemaDuplicationFindings } from "../scripts/architecture/rules/schema-duplication-rules.mjs";
import { contractDirectionFindings } from "../scripts/architecture/rules/contract-direction-rules.mjs";
import { effectOwnershipFindings } from "../scripts/architecture/rules/effect-ownership-rules.mjs";

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "oma-architecture-rule-"));
  for (const [file, content] of Object.entries(files)) {
    const target = join(root, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, typeof content === "string" ? content : JSON.stringify(content, null, 2));
  }
  return root;
}
function withFixture(files, run) {
  const root = fixture(files);
  try { return run(root); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

const minimalMethods = `export const PUBLIC_METHODS = {
  "mail.send": { mode: "mutation" },
  "status.get": { mode: "read" },
} as const;`;
const ownerMap = () => ({
  version: 1,
  registryOwners: {
    method: { path: "src/protocol/methods.ts", symbolTemplate: 'PUBLIC_METHODS["{mutation}"]' },
  },
  requiredMutationDimensions: ["workflow", "persistence", "recovery", "cli", "tests"],
  recoveryStrategies: { "transaction-complete": "db", "physical-replay": "physical" },
  fanoutStages: ["method", "tests"],
  mutations: {
    "mail.send": {
      workflow: [{ path: "src/owner.ts", symbol: "run" }],
      persistence: [{ path: "src/owner.ts", symbol: "run" }],
      recovery: { strategy: "transaction-complete", owners: [] },
      cli: [{ path: "src/owner.ts", symbol: "run" }],
      tests: [{ path: "test/owner.test.ts", symbol: "oracle" }],
    },
  },
});

test("architecture imports rule accepts helper-based command orchestration", () => withFixture({
  "src/cli/commands/send.ts": `import { readBody } from "../effects.js"; export const run = readBody;`,
}, root => assert.deepEqual(importRuleFindings(root), [])));

test("architecture imports rule rejects raw command I/O", () => withFixture({
  "src/cli/commands/send.ts": `import { readFileSync } from "node:fs"; export const run = readFileSync;`,
}, root => assert.ok(importRuleFindings(root).some(value => value.rule === "cli-command-import"))));

test("architecture transaction rule accepts transaction-complete owner with no replay", () => withFixture({
  "implementation/mutation-owners.json": ownerMap(),
}, root => assert.deepEqual(transactionRuleFindings(root), [])));

test("architecture transaction rule rejects physical owner on transaction-complete mutation", () => {
  const map = ownerMap();
  map.mutations["mail.send"].recovery.owners.push({ path: "src/recover.ts", symbol: "recover" });
  return withFixture({ "implementation/mutation-owners.json": map }, root =>
    assert.ok(transactionRuleFindings(root).some(value => value.rule === "transaction-complete-recovery")));
});

test("architecture ownership rule accepts exhaustive machine-readable owners", () => withFixture({
  "src/protocol/methods.ts": minimalMethods,
  "src/owner.ts": "export const run = 1;",
  "test/owner.test.ts": "export const oracle = 1;",
  "implementation/mutation-owners.json": ownerMap(),
}, root => assert.deepEqual(ownershipRuleFindings(root), [])));

test("architecture ownership rule rejects mutation vocabulary drift", () => {
  const map = ownerMap();
  map.mutations["route.follow"] = map.mutations["mail.send"];
  return withFixture({
    "src/protocol/methods.ts": minimalMethods,
    "src/owner.ts": "export const run = 1;",
    "test/owner.test.ts": "export const oracle = 1;",
    "implementation/mutation-owners.json": map,
  }, root => assert.ok(ownershipRuleFindings(root).some(value => value.rule === "mutation-ownership-exhaustiveness")));
});

test("architecture schema duplication rule accepts centralized registry dimensions", () => withFixture({
  "implementation/mutation-owners.json": ownerMap(),
}, root => assert.deepEqual(schemaDuplicationFindings(root), [])));

test("architecture schema duplication rule rejects per-mutation central registry copies", () => {
  const map = ownerMap();
  map.mutations["mail.send"].method = { path: "src/other.ts", symbol: "duplicate" };
  return withFixture({ "implementation/mutation-owners.json": map }, root =>
    assert.ok(schemaDuplicationFindings(root).some(value => value.rule === "mutation-registry-duplication")));
});

const directionPlan = () => ({
  version: 1,
  targetFrozenContractAliases: 0,
  currentFrozenContractAliases: 1,
  items: {
    capability: {
      contract: "implementation/contracts/identity.ts",
      implementation: "src/domain/capabilities.ts",
      symbol: "Capability",
    },
  },
});

test("architecture contract-direction rule accepts only explicitly planned frozen debt", () => withFixture({
  "implementation/contracts.ts": "export {};",
  "implementation/contracts/identity.ts": `export type Capability = import('../../src/domain/capabilities.js').Capability;`,
  "implementation/contract-direction-plan.json": directionPlan(),
}, root => assert.deepEqual(contractDirectionFindings(root), [])));

test("architecture contract-direction rule rejects a new unplanned implementation dependency", () => withFixture({
  "implementation/contracts.ts": "export {};",
  "implementation/contracts/identity.ts": `export type Capability = import('../../src/domain/capabilities.js').Capability; export type Leak = import('../../src/store.js').Transaction;`,
  "implementation/contract-direction-plan.json": directionPlan(),
}, root => assert.ok(contractDirectionFindings(root).some(value => value.rule === "contract-direction"))));

test("architecture effect ownership rule accepts dedicated effect, transport and exit owners", () => withFixture({
  "src/cli/effects.ts": `import { readFileSync } from "node:fs"; export const read = readFileSync;`,
  "src/cli/transport.ts": `import { existsSync } from "node:fs"; export const probe = existsSync;`,
  "src/cli/exit.ts": `export const stop = () => process.exit(2);`,
}, root => assert.deepEqual(effectOwnershipFindings(root), [])));

test("architecture effect ownership rule rejects raw I/O and exit outside owners", () => withFixture({
  "src/cli/rogue.ts": `import { readFileSync } from "node:fs"; export const stop = () => { readFileSync('x'); process.exit(2); };`,
}, root => {
  const findings = effectOwnershipFindings(root);
  assert.ok(findings.some(value => value.rule === "cli-effect-owner"));
  assert.ok(findings.some(value => value.rule === "cli-exit-owner"));
}));
