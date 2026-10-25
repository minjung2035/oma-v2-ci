#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { chmodSync, lstatSync, readdirSync, unlinkSync, rmdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { workspaceManifests } from "./check-modules.mjs";
import { copyWorkspaceAssets } from "./workspace-assets.mjs";

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
for (const workspace of ordered) {
  const output = join(root, workspace.path, "dist");
  if (lstatSync(output, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`symlinked workspace output ${workspace.manifest.name}`);
  remove(output); remove(join(root, workspace.path, ".tsbuildinfo"));
}
const result = spawnSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-b", ...ordered.map(workspace => workspace.path), "--force"],
  { cwd: root, stdio: "inherit", timeout: 600000, killSignal: "SIGKILL" });
if (result.error || result.signal || result.status !== 0) {
  if (result.error || result.signal) console.error(result.error?.message ?? result.signal);
  process.exit(result.status || 1);
}

for (const workspace of ordered)
  copyWorkspaceAssets(join(root, workspace.path), workspace.manifest.oma?.assets ?? []);

// Executable artifacts are owned by the application workspace.
for (const workspace of ordered) {
  const command = workspace.manifest.oma?.modelCommand;
  if (command !== undefined) {
    if (workspace.manifest.name !== "@oma/app" || command !== "libexec/oma") throw new Error("unreviewed generated command owner");
    const { modelCommandScript } = await import(new URL("../packages/domain/dist/resident-paths.js", import.meta.url));
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const target = join(root, workspace.path, "dist", command);
    mkdirSync(dirname(target), {recursive:true}); writeFileSync(target, modelCommandScript(), {mode:0o755}); chmodSync(target, 0o755);
  }
  for (const file of Object.values(workspace.manifest.bin ?? {})) chmodSync(join(root, workspace.path, file), 0o755);
}
