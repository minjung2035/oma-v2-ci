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
import { fenceRuleFindings } from "../scripts/architecture/rules/fence-rules.mjs";
import { fenceExemptSpawnOwners } from "../scripts/architecture-owners.mjs";

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

/** REC-007: the rule that has to catch the next unfenced child.
 *
 * The society lease reached the broker and the engine and not the CLI the
 * engine starts, and nothing failed -- because "did this spawn get the fence"
 * was a question only a reviewer asked. These hold the rule to both directions
 * of it: a child started without the lease and without a written reason fails,
 * and a written reason for a spawn that no longer exists fails too, so the
 * exemption list cannot quietly become a list of places nobody checked.
 */
const fenceFindings = (root, rule) => fenceRuleFindings(root).filter(value => value.rule === rule);

test("architecture fence rule accepts a child started with the society lease", () => withFixture({
  "src/extension/cli-process.ts": `import { spawn } from "node:child_process";
export function runCliProcess(run: CliRun, fence: number | null) {
  return spawn(run.node, run.args, { env: run.env, stdio: childStdio(fence) });
}`,
}, root => assert.deepEqual(fenceFindings(root, "fence-propagation"), [])));

test("architecture fence rule rejects a child started without the society lease", () => withFixture({
  "src/extension/cli-process.ts": `import { spawn } from "node:child_process";
export function runCliProcess(run: CliRun) {
  return spawn(run.node, run.args, { env: run.env, stdio: ["ignore", "pipe", "pipe"] });
}`,
}, root => {
  const found = fenceFindings(root, "fence-propagation");
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.match(found[0].reason, /src\/extension\/cli-process\.ts#runCliProcess/);
}));

test("architecture fence rule names the enclosing function, not whatever declaration encloses the call", () => withFixture({
  // The first version of this rule walked up to any variable declaration, so
  // `const child = spawn(...)` was reported as a site called `child` -- and an
  // exemption written for the real function would then never be claimed. An
  // exemption that cannot be matched to the spawn it excuses is worse than no
  // exemption: it reads as a decision that was made and is not in force.
  "src/runtime/resident.ts": `export async function startResident(options: Options) {
  const child = spawnSandboxed(options.command, options.args, options.env);
  return child;
}`,
}, root => {
  const found = fenceFindings(root, "fence-propagation");
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.match(found[0].reason, /src\/runtime\/resident\.ts#startResident/);
}));

test("architecture fence rule rejects a written exemption for a spawn that is not there", () => withFixture({
  "src/process/async.ts": "export const nothing = 1;",
}, root => {
  const stale = fenceFindings(root, "fence-exemption-stale").map(value => value.reason);
  for (const site of Object.keys(fenceExemptSpawnOwners))
    assert.ok(stale.some(reason => reason.includes(site)),
      `${site} is exempted from the fence and nothing noticed that it does not exist: ${stale.join(" | ")}`);
}));

test("architecture fence rule rejects an exemption for a spawn that now passes the fence", () => {
  const site = Object.keys(fenceExemptSpawnOwners)[0];
  const [file, name] = site.split("#");
  return withFixture({
    [file]: `import { spawn } from "node:child_process";
export function ${name}(fence: number) { return spawn("/bin/true", [], { stdio: [0, 1, 2, fence] }); }`,
  }, root => {
    const stale = fenceFindings(root, "fence-exemption-stale").map(value => value.reason);
    assert.ok(stale.some(reason => reason.includes(`${site} passes a fence`)), stale.join(" | "));
  });
});
