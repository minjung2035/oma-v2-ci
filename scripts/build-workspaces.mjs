#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { workspaceManifests } from "./check-modules.mjs";
import { copyWorkspaceAssets } from "./workspace-assets.mjs";
import { workspaceBuildCache } from "./workspace-build-cache.mjs";
import { darwinExecutables } from "./workspace-executables.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaces = workspaceManifests(root);
const byName = new Map(workspaces.map(workspace => [workspace.manifest.name, workspace]));
const selected = process.argv.slice(2);
const ordered = [], active = new Set(), done = new Set();
const visit = name => {
  if (!byName.has(name)) throw new Error(`unknown workspace ${name}`);
  if (active.has(name)) throw new Error(`workspace build cycle ${name}`);
  if (done.has(name)) return;
  active.add(name);
  for (const dependency of Object.keys(byName.get(name).manifest.dependencies ?? {})) if (dependency.startsWith("@oma/")) visit(dependency);
  active.delete(name); done.add(name); ordered.push(byName.get(name));
};
(selected.length ? selected : [...byName.keys()]).forEach(visit);
const cacheDirectory = join(root, ".scratch");
const cachePath = join(cacheDirectory, "workspace-build-cache.json");
const cacheStat = lstatSync(cacheDirectory, { throwIfNoEntry: false });
if (cacheStat && (!cacheStat.isDirectory() || cacheStat.isSymbolicLink())) throw new Error("invalid workspace cache directory");
if (!cacheStat) mkdirSync(cacheDirectory);
const cache = workspaceBuildCache(root, workspaces);
let records = {};
try {
  const stat = lstatSync(cachePath);
  if (stat.isFile() && !stat.isSymbolicLink()) {
    const prior = JSON.parse(readFileSync(cachePath, "utf8"));
    if (prior?.schema === 1 && prior.workspaces && typeof prior.workspaces === "object") records = prior.workspaces;
  }
} catch { /* Missing or unreadable cache: clean build. */ }
const dependenciesOf = workspace => Object.fromEntries(Object.keys(workspace.manifest.dependencies ?? {})
  .filter(name => name.startsWith("@oma/")).sort().map(name => [name, records[name] ? cache.outputDigest(records[name]) : null]));
const stale = new Set();
for (const workspace of ordered) {
  const name = workspace.manifest.name;
  if (lstatSync(join(root, workspace.path, "dist"), { throwIfNoEntry: false })?.isSymbolicLink())
    throw new Error(`symlinked workspace output ${name}`);
  const dependencies = dependenciesOf(workspace);
  if (Object.keys(dependencies).some(name => stale.has(name)) || !cache.fresh(workspace, records[name], dependencies)) stale.add(name);
}
// Build outputs are replaceable, never durable application state. Repair only
// their owner bits, never follow links, and never reuse a tampered tsc cache.
const remove = path => {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return;
  if (!stat.isDirectory()) { unlinkSync(path); return; }
  chmodSync(path, (stat.mode & 0o7777) | 0o700);
  for (const name of readdirSync(path)) remove(join(path, name));
  rmdirSync(path);
};
const rebuilding = ordered.filter(workspace => stale.has(workspace.manifest.name));
const before = new Map(rebuilding.map(workspace => [workspace.manifest.name, cache.before(workspace)]));
for (const workspace of rebuilding) {
  const output = join(root, workspace.path, "dist");
  if (lstatSync(output, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`symlinked workspace output ${workspace.manifest.name}`);
  remove(output); remove(join(root, workspace.path, ".tsbuildinfo"));
  // A consumer's compiler must see dependency declaration assets on the
  // first build too. before() rejects every overlap with compiler-owned paths.
  mkdirSync(output);
  copyWorkspaceAssets(join(root, workspace.path), workspace.manifest.oma?.assets ?? []);
}
if (rebuilding.length) {
  const result = spawnSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-b", ...ordered.map(workspace => workspace.path)],
    { cwd: root, stdio: "inherit", timeout: 600000, killSignal: "SIGKILL" });
  if (result.error || result.signal || result.status !== 0) {
    if (result.error || result.signal) console.error(result.error?.message ?? result.signal);
    process.exit(result.status || 1);
  }
}

// Executable artifacts are owned by the application workspace.
for (const workspace of rebuilding) {
  const executables = darwinExecutables(workspace.manifest);
  if (process.platform === "darwin") for (const executable of executables) {
    const compiled = spawnSync("/usr/bin/xcrun", [...executable.compilerArguments,
      join(root, workspace.path, "dist", executable.source), ...executable.linkArguments,
      "-o", join(root, workspace.path, "dist", executable.output)],
    { cwd: root, stdio: "inherit", timeout: 120000, killSignal: "SIGKILL" });
    if (compiled.error || compiled.signal || compiled.status !== 0) {
      if (compiled.error || compiled.signal) console.error(compiled.error?.message ?? compiled.signal);
      process.exit(compiled.status || 1);
    }
  }
  const command = workspace.manifest.oma?.modelCommand;
  if (command !== undefined) {
    if (workspace.manifest.name !== "@oma/app" || command !== "libexec/oma") throw new Error("unreviewed generated command owner");
    const { modelCommandScript } = await import(new URL("../packages/domain/dist/resident-paths.js", import.meta.url));
    const target = join(root, workspace.path, "dist", command);
    mkdirSync(dirname(target), {recursive:true}); writeFileSync(target, modelCommandScript(), {mode:0o755}); chmodSync(target, 0o755);
  }
  for (const file of Object.values(workspace.manifest.bin ?? {})) chmodSync(join(root, workspace.path, file), 0o755);
}
// Publish only after compilation and all build-owned writes have succeeded.
for (const workspace of rebuilding) records[workspace.manifest.name] = cache.record(workspace, dependenciesOf(workspace), before.get(workspace.manifest.name));
cache.assertPolicyUnchanged();
const temporary = `${cachePath}.${process.pid}.tmp`;
try {
  writeFileSync(temporary, JSON.stringify({ schema: 1, workspaces: records }), { flag: "wx" });
  renameSync(temporary, cachePath);
} finally {
  if (lstatSync(temporary, { throwIfNoEntry: false })) unlinkSync(temporary);
}
console.log(`Workspace build: ${rebuilding.length}/${ordered.length} recompiled`);
