import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { changeLocality } from "./change-locality.mjs";
import { registryOwnerSymbol } from "./architecture/rules/shared.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mapPath = join(root, "implementation", "mutation-owners.json");
const ownership = JSON.parse(readFileSync(mapPath, "utf8"));

function fail(message) {
  console.error(`mutation-locality: ${message}`);
  process.exit(1);
}

function ownerSymbol(owner, mutation) {
  const symbol = registryOwnerSymbol(root, owner, mutation);
  if (symbol !== null) return symbol;
  fail(`registry owner has no symbol for ${mutation}`);
}

function registryRefs(mutation) {
  return Object.entries(ownership.registryOwners).map(([dimension, owner]) => ({
    dimension,
    path: owner.path,
    symbol: ownerSymbol(owner, mutation),
  }));
}

function refsFor(mutation, spec) {
  const refs = registryRefs(mutation);
  for (const dimension of ownership.requiredMutationDimensions) {
    if (!(dimension in spec)) fail(`${mutation} is missing ${dimension}`);
  }
  for (const dimension of ["workflow", "persistence", "cli", "tests"]) {
    const values = spec[dimension];
    if (!Array.isArray(values) || values.length === 0)
      fail(`${mutation}.${dimension} must contain at least one owner`);
    for (const value of values) refs.push({ dimension, ...value });
  }
  const recovery = spec.recovery;
  if (!recovery || !Object.hasOwn(ownership.recoveryStrategies, recovery.strategy) || !Array.isArray(recovery.owners))
    fail(`${mutation}.recovery has an invalid strategy/owners shape`);
  if (recovery.strategy === "physical-replay" && recovery.owners.length === 0)
    fail(`${mutation} requires a physical recovery owner`);
  if (recovery.strategy === "transaction-complete" && recovery.owners.length !== 0)
    fail(`${mutation} is transaction-complete and must not name a physical recovery owner`);
  for (const value of recovery.owners) refs.push({ dimension: "recovery", ...value });
  for (const ref of refs) {
    if (typeof ref.path !== "string" || typeof ref.symbol !== "string" || ref.symbol.length === 0)
      fail(`${mutation}.${ref.dimension} has an invalid owner reference`);
    if (!existsSync(join(root, ref.path))) fail(`${mutation}.${ref.dimension} points to missing ${ref.path}`);
  }
  return refs;
}

function metrics(mutation, spec) {
  const refs = refsFor(mutation, spec);
  const pipeline = new Set();
  for (const stage of ownership.fanoutStages) {
    for (const ref of refs) if (ref.dimension === stage) pipeline.add(ref.path);
  }
  const runtime = new Set(refs.filter(ref => !["tests", "cli"].includes(ref.dimension)).map(ref => ref.path));
  const tests = new Set(refs.filter(ref => ref.dimension === "tests").map(ref => ref.path));
  const all = new Set(refs.map(ref => ref.path));
  return {
    mutation,
    recovery: spec.recovery.strategy,
    pipelineFiles: pipeline.size,
    runtimeFiles: runtime.size,
    testFiles: tests.size,
    totalFiles: all.size,
    refs,
  };
}

const json = process.argv.includes("--json");
const args = process.argv.slice(2);
const option = name => {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  if (!args[at + 1] || args[at + 1].startsWith("--")) fail(`${name} requires a revision`);
  return args[at + 1];
};
const since = option("--since"), until = option("--until");
if (until !== undefined && since === undefined) fail("--until requires --since");
const requested = args.filter((arg, index) => arg !== "--json" && arg !== "--since" && arg !== "--until" &&
  args[index - 1] !== "--since" && args[index - 1] !== "--until");
const names = requested.length > 0 ? requested : Object.keys(ownership.mutations);
for (const name of names) if (!Object.hasOwn(ownership.mutations, name)) fail(`unknown mutation ${name}`);
const rows = names.map(name => metrics(name, ownership.mutations[name]));

const changes = since === undefined ? null : changeLocality(root, since, until, rows);
if (json) {
  const inventory = rows.map(({ refs, ...row }) => row);
  console.log(JSON.stringify(changes === null ? inventory : { inventory, changes }, null, 2));
  process.exit(0);
}

const header = ["mutation", "pipeline", "runtime", "tests", "total", "recovery"];
const body = rows.map(row => [row.mutation, row.pipelineFiles, row.runtimeFiles, row.testFiles, row.totalFiles, row.recovery]);
const widths = header.map((value, index) => Math.max(String(value).length, ...body.map(row => String(row[index]).length)));
const render = row => row.map((value, index) => String(value).padEnd(widths[index])).join("  ");
console.log("Owner inventory (related files, not files edited per feature):");
console.log(render(header));
console.log(render(widths.map(width => "-".repeat(width))));
for (const row of body) console.log(render(row));

if (requested.length === 1) {
  console.log("\nowners:");
  for (const ref of rows[0].refs)
    console.log(`${ref.dimension.padEnd(15)} ${ref.path} :: ${ref.symbol}`);
}

if (changes !== null) {
  console.log(`\nActual changeset: ${changes.from} -> ${changes.to}`);
  console.log(`${changes.totalFiles} changed files; ${JSON.stringify(changes.counts)}`);
  for (const file of changes.changedFiles) console.log(file);
  console.log(changes.meaning);
}
