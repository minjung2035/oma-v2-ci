import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { importRuleFindings } from "../scripts/architecture/rules/import-rules.mjs";
import { transactionRuleFindings } from "../scripts/architecture/rules/transaction-rules.mjs";
import { ownershipRuleFindings } from "../scripts/architecture/rules/ownership-rules.mjs";
import { schemaDuplicationFindings } from "../scripts/architecture/rules/schema-duplication-rules.mjs";
import { contractDirectionFindings } from "../scripts/architecture/rules/contract-direction-rules.mjs";
import { effectOwnershipFindings } from "../scripts/architecture/rules/effect-ownership-rules.mjs";
import { stateRootFindings, stateTreeFindings } from "../scripts/architecture/rules/state-tree-rules.mjs";
import { ownedStateFindings } from "../scripts/architecture/rules/owned-state-rules.mjs";
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

/** V29A (WP29): the exit-owner rule's exact scope. It follows the spellings
 * that reach the global `process.exit` without the literal call -- a reference,
 * element access, destructuring, `globalThis.process`, a `node:process` import --
 * and leaves alone what only looks similar. Arbitrary data flow is out of scope. */
test("V29A: the exit-owner rule catches every spelling of process.exit it claims to", () => {
  for (const [name, text] of [
    ["direct call", "export const stop = () => process.exit(2);"],
    ["reference", "export const stop = process.exit;"],
    ["element access", "export const stop = () => process['exit'](2);"],
    ["destructuring", "const { exit } = process; export const stop = () => exit(2);"],
    ["renamed destructuring", "const { exit: quit } = process; export const stop = () => quit(2);"],
    ["globalThis", "export const stop = () => globalThis.process.exit(2);"],
    ["module import", "import { exit } from 'node:process'; export const stop = () => exit(2);"],
    ["default module import", "import proc from 'process'; export const stop = () => proc.exit(2);"],
  ]) withFixture({ "src/cli/rogue.ts": text }, root =>
    assert.ok(effectOwnershipFindings(root).some(value => value.rule === "cli-exit-owner"), `${name} escaped the rule`));
});

test("V29A: the exit-owner rule leaves alone what only looks like process.exit", () => withFixture({
  "src/cli/similar.ts": [
    "const app = { exit: (code: number) => code, process: { exit: () => 0 } };",
    "export const a = () => app.exit(2);",
    "export const b = () => app.process.exit();",
    "export const c = 'process.exit(2) in a string';",
    "// process.exit(2) in a comment",
    "export const d = () => process.env.HOME;",
  ].join("\n"),
  "src/cli/exit.ts": "export const stop = () => process.exit(2);",
}, root => assert.deepEqual(effectOwnershipFindings(root), [])));

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
  "src/process/run.ts": `import { spawn } from "node:child_process";
export function runCliProcess(run: CliRun, fence: number | null) {
  return spawn(run.node, run.args, { env: run.env, stdio: childStdio(fence) });
}`,
}, root => assert.deepEqual(fenceFindings(root, "fence-propagation"), [])));

test("architecture fence rule rejects a child started without the society lease", () => withFixture({
  "src/process/run.ts": `import { spawn } from "node:child_process";
export function runCliProcess(run: CliRun) {
  return spawn(run.node, run.args, { env: run.env, stdio: ["ignore", "pipe", "pipe"] });
}`,
}, root => {
  const found = fenceFindings(root, "fence-propagation");
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.match(found[0].reason, /src\/process\/run\.ts#runCliProcess/);
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

test("architecture fence rule never accepts a comment as a propagated descriptor", () => withFixture({
  "src/process/run.ts": `import { spawn } from "node:child_process";
export function runCliProcess(run: CliRun) {
  return spawn(run.node, run.args, { /* society fence is absent */ stdio: [0, 1, 2] });
}`,
  "src/process/async.ts": `import { spawn } from "node:child_process";
export function spawnInTerminal(program: string) {
  return spawn(program, [], { /* private handoff, not a society fence */ stdio: [0, 1, 2, "pipe"] });
}`,
}, root => {
  assert.equal(fenceFindings(root, "fence-propagation").length, 1);
  assert.equal(fenceFindings(root, "fence-exemption-stale").some(value => value.reason.includes("spawnInTerminal passes")), false);
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

test("AV5 / FS-005: the state-tree rule accepts effects through a held parent, a descriptor or a primitive", () => withFixture({
  "src/storage/directory.ts": `import { mkdirSync } from "node:fs"; export function ensureDirectory(path) { mkdirSync(path); }`,
  "src/mail/move.ts": `import { renameSync, unlinkSync, writeFileSync, openSync, constants, mkdirSync } from "node:fs";
import { entryAt, withinDirectory } from "../storage/contained-fs.js";
export function move(a, b, fd) {
  withinDirectory(a, (parent, name) => renameSync(entryAt(parent, name), entryAt(parent, "x")));
  withinDirectory(b, (parent, name) => { mkdirSync(entryAt(parent, name)); unlinkSync(entryAt(parent, name)); });
  writeFileSync(fd, "bytes");
  return openSync(a, constants.O_RDONLY | constants.O_NOFOLLOW);
}`,
  "src/broker.ts": `import { unlinkSync } from "node:fs"; export function listen(path) { unlinkSync(path); }`,
}, root => assert.deepEqual(stateTreeFindings(root), [])));

test("AV5 / FS-005: the state-tree rule rejects a mutation that names a path", () => {
  for (const [name, body] of [
    ["rename", `renameSync(join(root, "a"), join(root, "b"));`],
    ["unlink", `unlinkSync(path);`],
    ["mkdir", `mkdirSync(path, { recursive: true });`],
    ["remove", `fs.rmSync(path, { recursive: true, force: true });`],
    ["create", `openSync(path, constants.O_WRONLY | constants.O_CREAT, 0o600);`],
    ["write", `writeFileSync(join(root, "view.json"), "{}");`],
    ["held name kept in a variable", `const name = entryAt(parent, "x"); unlinkSync(name);`],
  ]) withFixture({
    "src/views/example.ts": `import fs, { renameSync, unlinkSync, mkdirSync, openSync, writeFileSync, constants } from "node:fs";
import { join } from "node:path";
export function effect(root, path, parent, entryAt) { ${body} }`,
  }, root => assert.ok(stateTreeFindings(root).some(value => value.rule === "state-tree-held-parent"), `${name} escaped the rule`));
});

test("AV5 / FS-005: the real tree changes the state tree only through held parents", () => {
  const repository = fileURLToPath(new URL("..", import.meta.url));
  assert.deepEqual(stateTreeFindings(repository), []);
});

test("state-root-judgement (DR18, S-06): a state root is judged by assertStateRoot, never by its layout alone", () => {
  withFixture({ "src/runtime/assets.ts": "export function assertStateRoot(stateRoot) { assertHostDirectoryLayout(stateRoot, true); }",
    "src/entry/broker.ts": "assertStateRoot(stateRoot); assertHostDirectoryLayout(runRoot, true); assertHostDirectoryLayout(cfg.installation.libdir);" },
  root => assert.deepEqual(stateRootFindings(root), []));
  for (const text of ["assertHostDirectoryLayout(stateRoot, true);", "assertHostDirectoryLayout(location.stateRoot);"])
    withFixture({ "src/runtime/society-lease.ts": text },
      root => assert.ok(stateRootFindings(root).some(value => value.rule === "state-root-judgement"), text));
  const repository = fileURLToPath(new URL("..", import.meta.url));
  assert.deepEqual(stateRootFindings(repository), []);
});

test("P0-8/DR32: the owned-state rule accepts the owned primitives and held parents", () => withFixture({
  "src/views/example.ts": `import { renameSync, unlinkSync, mkdirSync, writeFileSync, openSync, constants, readdirSync } from "node:fs";
import { entryAt, withinDirectory } from "../storage/contained-fs.js";
import { ensureOwnedDirectory, ensureOwnedDurableDirectory, ensureOwnedUserDirectory } from "../storage/durable-fs.js";
export function effect(root, parent, fd) {
  ensureOwnedDirectory(join(root, "mail"), root, 0o700);
  ensureOwnedDurableDirectory(join(root, "mail", "inboxes"), root, 0o700);
  ensureOwnedUserDirectory(join(root, "engine"), join(root, ".local", "state", "oma"));
  withinDirectory(join(root, "a"), (held, name) => renameSync(entryAt(held, name), entryAt(held, "x")));
  writeFileSync(fd, "bytes");
  return openSync(join(root, "sockets", "lease"), constants.O_RDONLY | constants.O_NOFOLLOW);
}`,
}, root => assert.deepEqual(ownedStateFindings(root), [])));

test("P0-8/DR32: the owned-state rule rejects a plain ensure or mutation on an oma-owned tail", () => {
  for (const [name, body] of [
    ["plain durable ensure", `ensureDurableDirectory(join(root, "staging"));`],
    ["plain directory ensure", `ensureDirectory(join(root, "mail"));`],
    ["plain user ensure", `ensureUserDirectory(agentDir);`],
    ["plain locked replace", `lockedUserReplace(agentDir, "settings.json", 1024, fn);`],
    ["plain mkdir", `mkdirSync(join(root, "staging"), { recursive: true });`],
    ["plain remove", `rmSync(join(root, "tmp"), { recursive: true, force: true });`],
    ["plain list of an owned root", `readdirSync(join(stateRoot, "mail", "inboxes"));`],
    ["plain probe of an owned root", `lstatSync(join(paths.stateRoot, "world"));`],
  ]) withFixture({
    "src/views/example.ts": `import { renameSync, unlinkSync, mkdirSync, rmSync, readdirSync, lstatSync } from "node:fs";
import { ensureDirectory, ensureDurableDirectory } from "../storage/durable-fs.js";
import { ensureUserDirectory } from "../runtime/user-files.js";
import { lockedUserReplace } from "../runtime/locked-files.js";
import { join } from "node:path";
export function effect(root, stateRoot, paths, agentDir, fn) { ${body} }`,
  }, root => assert.ok(ownedStateFindings(root).some(value => /owned-state-(plain-helper|raw-access|raw-observation)/.test(value.rule)),
    `${name} escaped the rule`));
});

test("P0-8/DR32: the owned-state rule leaves user-path observations and descriptors alone, but still audits mutations", () => {
  withFixture({
    "src/tui/example.ts": `import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
export function effect(cwd, fd, project) {
  if (existsSync(join(cwd, "oma.json"))) readdirSync(project);
  readFileSync(join(cwd, "package.json"), "utf8");
  writeFileSync(fd, "bytes");
  return fd;
}`,
  }, root => assert.deepEqual(ownedStateFindings(root), []));
  // A mutation still answers the audit: the user-path file carries its
  // exemption in the rule's map, so a plain mutation is never invisible.
  withFixture({
    "src/tui/example.ts": `import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
export function effect(cwd) { const scratch = mkdtempSync(join(cwd, "oma-")); rmSync(scratch, { recursive: true, force: true }); }`,
  }, root => assert.ok(ownedStateFindings(root).some(value => value.rule === "owned-state-raw-access")));
});

test("P0-8/DR32: the owned-state rule reaches node:fs/promises bindings, not look-alike names", () => {
  // The async names are ordinary words (`open`, `readdir`, `stat`), so unlike
  // the *Sync names they are only trusted where the callee is actually bound
  // to the module: a named import, a namespace or default import, an
  // `fs.promises.*` reach-through, a `promises` named import or alias, a
  // destructured binding, or `await import`.
  for (const [name, text] of [
    ["named import create", `import { open } from "node:fs/promises"; export const f = async p => (await open(p, "w")).close();`],
    ["named import renamed", `import { rm as remove } from "node:fs/promises"; export const f = async p => remove(p);`],
    ["namespace import", `import * as fsp from "node:fs/promises"; export const f = async p => fsp.rm(p, { recursive: true });`],
    ["default import", `import fsp from "node:fs/promises"; export const f = async p => fsp.unlink(p);`],
    ["fs.promises member", `import fs from "node:fs"; export const f = async p => fs.promises.writeFile(p, "x");`],
    ["fs namespace promises", `import * as fs from "node:fs"; export const f = async p => fs.promises.mkdir(p);`],
    ["named promises import", `import { promises as fsp } from "node:fs"; export const f = async p => fsp.rename(p, p);`],
    ["promises alias", `import { promises } from "node:fs"; const fsp = promises; export const f = async p => fsp.truncate(p);`],
    ["destructured promises", `import * as fs from "node:fs"; const { rmdir } = fs.promises; export const f = async p => rmdir(p);`],
    ["await import", `export const f = async p => { const { open } = await import("node:fs/promises"); (await open(p, "w")).close(); };`],
    ["async symlink's created name", `import { symlink } from "node:fs/promises"; export const f = async (target, staged) => symlink(target, staged);`],
    ["async observation of an owned root", `import { readdir } from "node:fs/promises"; export const f = async store => readdir(store);`],
  ]) withFixture({
    "src/views/example.ts": text,
  }, root => assert.ok(ownedStateFindings(root).some(value => /owned-state-(raw-access|raw-observation)/.test(value.rule)),
    `${name} escaped the rule`));
  // And what only looks like the module is left alone: local functions with
  // the same names, methods on an object that is not the promises namespace,
  // and an async observation of a caller-owned path.
  withFixture({
    "src/views/example.ts": `const open = async p => p; const readdir = async d => [];
const db = { open: async p => p, mkdir: async p => p };
export const f = async (p, d) => { await open(p); await readdir(d); await db.open(p); await db.mkdir(p); };`,
    "src/views/other.ts": `import * as fsp from "node:fs/promises"; export const f = async path => fsp.readdir(path);`,
  }, root => assert.deepEqual(ownedStateFindings(root), []));
});

test("P0-8/DR32: an owned tail under its alias names still flags a raw observation", () => {
  // `stateRoot`-shaped names were not the only carriers -- the store, the
  // generations directories and the names the stage and ledger code carry
  // them under are the same owned tails, and a raw observation of them is
  // audited the same way.
  for (const name of ["store", "generations", "real", "local", "destPath", "staged", "mirror", "packageStore", "dataDir", "journal"])
    withFixture({
      "src/views/example.ts": `import { lstatSync } from "node:fs";
export function probe(${name}) { return lstatSync(${name}); }`,
    }, root => assert.ok(ownedStateFindings(root).some(value => value.rule === "owned-state-raw-observation"),
      `${name} escaped the rule`));
  // A name the rule does not claim -- `path`, `dir`, `root` -- stays out of
  // the observation arm's reach; the mutation arm audits the file regardless.
  withFixture({
    "src/views/example.ts": `import { lstatSync } from "node:fs";
export function probe(path) { return lstatSync(path); }`,
  }, root => assert.deepEqual(ownedStateFindings(root), []));
});

test("P0-8/DR32: the owned-state rule reports a stale exemption", () => {
  const repository = fileURLToPath(new URL("..", import.meta.url));
  assert.deepEqual(ownedStateFindings(repository), []);
});
