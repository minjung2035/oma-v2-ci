#!/usr/bin/env node
/** Pack and install each workspace with only its declared dependency closure. */
import assert from "node:assert/strict";
import { workspaceAssetSnapshot } from "./workspace-assets.mjs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, realpathSync, openSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { workspaceManifests, workspaceExportSource } from "./check-modules.mjs";
import { isolatedLock } from "./package-isolation-lock.mjs";
import { isolatedDeclarationDiagnostics, formatDeclarationDiagnostics } from "./isolated-declarations.mjs";

const root = process.cwd();
const workspaces = workspaceManifests(root);
const byName = new Map(workspaces.map(item => [item.manifest.name, item]));
const productLock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const scratch = mkdtempSync(join(tmpdir(), "oma-package-isolation-"));
const env = { ...process.env };
delete env.NODE_PATH;
delete env.NODE_OPTIONS;
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
let commandNumber = 0;
const command = (args, cwd) => {
  // Pack metadata names every asset. Stream it rather than losing a complete
  // tarball listing to execFileSync's incidental pipe buffer limit.
  const index = commandNumber++, stdout = join(scratch, `npm-${index}.stdout`), stderr = join(scratch, `npm-${index}.stderr`);
  const descriptors = [];
  let primary;
  try {
    descriptors.push(openSync(stdout, "wx", 0o600));
    descriptors.push(openSync(stderr, "wx", 0o600));
    execFileSync(npm, args, { cwd, env, stdio: ["ignore", descriptors[0], descriptors[1]], timeout: 120000 });
    return readFileSync(stdout, "utf8");
  } catch (error) {
    primary = error;
    if (existsSync(stdout)) error.stdout = readFileSync(stdout, "utf8");
    if (existsSync(stderr)) error.stderr = readFileSync(stderr, "utf8");
    throw error;
  } finally {
    const failures = [];
    for (const fd of descriptors.reverse()) try { closeSync(fd); } catch (error) { failures.push(error); }
    if (failures.length) {
      const error = new AggregateError(primary ? [primary, ...failures] : failures, "package command output cleanup failed");
      error.stdout = primary?.stdout; error.stderr = primary?.stderr;
      throw error;
    }
  }
};

try {
  const archives = new Map();
  const archiveRoot = join(scratch, "archives"); mkdirSync(archiveRoot);
  for (const workspace of workspaces) {
    const result = JSON.parse(command(["pack", "--json", "--ignore-scripts", "--pack-destination", archiveRoot], resolve(root, workspace.path)))[0];
    const paths = result.files.map(file => file.path);
    if (paths.some(path => path.startsWith("apps/oma/src/") || path.startsWith("node_modules/"))) throw new Error(`${workspace.manifest.name}: packed development tree`);
    for (const [subpath, entry] of Object.entries(workspace.manifest.exports)) {
      if (!workspaceExportSource(workspace, subpath) || !paths.includes(entry.default.slice(2)) || !paths.includes(entry.types.slice(2)))
        throw new Error(`${workspace.manifest.name}: export ${subpath} missing from tarball`);
    }
    archives.set(workspace.manifest.name, { path: join(archiveRoot, result.filename), integrity: result.integrity });
  }
  function verifyWorkspace(workspace) {
    const closure = new Set();
    const visit = name => {
      if (closure.has(name)) return;
      closure.add(name);
      for (const dependency of Object.keys(byName.get(name).manifest.dependencies ?? {})) if (byName.has(dependency)) visit(dependency);
    }; visit(workspace.manifest.name);
    const directory = join(scratch, workspace.manifest.name.slice(5)); mkdirSync(directory);
    const manifest = { name: "oma-isolation-check", private: true, type: "module",
      dependencies: Object.fromEntries([...closure].map(name => [name, `file:${archives.get(name).path}`])),
      devDependencies: { "@types/node": "^26.0.0" } };
    writeFileSync(join(directory, "package.json"), JSON.stringify(manifest));
    writeFileSync(join(directory, "package-lock.json"), JSON.stringify(isolatedLock({ manifest, closure, archives, byName, productLock })));
    command(["ci", "--ignore-scripts", "--no-audit", "--no-fund"], directory);
    for (const candidate of workspaces) {
      const present = existsSync(join(directory, "node_modules", candidate.manifest.name));
      if (present !== closure.has(candidate.manifest.name)) throw new Error(`unexpected installed workspace: ${candidate.manifest.name}`);
    }
    for (const name of closure) {
      const owner = byName.get(name), assets = owner.manifest.oma?.assets ?? [];
      assert.deepEqual(workspaceAssetSnapshot(join(directory, "node_modules", name), "dist", assets),
        workspaceAssetSnapshot(join(root, owner.path), "src", assets), `${name}: installed assets differ from owned source`);
    }
    const smoke = workspace.manifest.oma?.isolationSmoke;
    if (smoke !== undefined) {
      if (typeof smoke !== "string" || !/^test\/[a-z-]+\.mjs$/.test(smoke)) throw new Error("invalid isolated runtime smoke path");
      const target = join(directory, "installed-runtime.mjs");
      writeFileSync(target, readFileSync(join(root, workspace.path, smoke)));
      execFileSync(process.execPath, [target], { cwd: directory, env, stdio: "pipe", timeout: 30000 });
    }
    const publicNames = Object.keys(workspace.manifest.exports).map(subpath => workspace.manifest.name + (subpath === "." ? "" : subpath.slice(1)));
    const imports = publicNames.map(name => `await import(${JSON.stringify(name)});`).join("\n");
    writeFileSync(join(directory, "smoke.mjs"), imports + "\n");
    execFileSync(process.execPath, [join(directory, "smoke.mjs")], { cwd: directory, env, stdio: "pipe", timeout: 30000 });
    writeFileSync(join(directory, "types.mts"), publicNames.map((name, index) => `export type API${index} = typeof import(${JSON.stringify(name)});`).join("\n"));
    const declared = isolatedDeclarationDiagnostics(join(directory, "types.mts"),
      [...closure].map(name => join(directory, "node_modules", name)));
    for (const entry of Object.values(workspace.manifest.exports))
      if (!declared.checkedDeclarationFiles.includes(realpathSync(join(directory, "node_modules", workspace.manifest.name, entry.types))))
        throw new Error(`${workspace.manifest.name}: public declaration ${entry.types} was not checked`);
    if (declared.diagnostics.length) throw new Error(formatDeclarationDiagnostics(declared.diagnostics));
    console.log(`${workspace.manifest.name}: packed install, ${publicNames.length} public entries, authored declarations PASS; ${smoke ? "installed runtime PASS; " : ""}` +
      `external declaration diagnostics=${declared.externalDiagnostics}; closure=${[...closure].join(",")}`);
  }
  const failures = [];
  for (const workspace of workspaces) {
    try { verifyWorkspace(workspace); }
    catch (error) {
      console.error(`${workspace.manifest.name}: isolated verification FAIL`);
      if (error.stdout) console.error(String(error.stdout));
      if (error.stderr) console.error(String(error.stderr));
      failures.push(new Error(`${workspace.manifest.name}: ${error.message}`, { cause: error }));
    }
    finally {
      try { rmSync(join(scratch, workspace.manifest.name.slice(5)), { recursive: true, force: true }); }
      catch (error) {
        console.error(`${workspace.manifest.name}: isolated cleanup FAIL`);
        failures.push(new Error(`${workspace.manifest.name}: isolated cleanup failed`, { cause: error }));
      }
    }
  }
  if (failures.length) throw new AggregateError(failures, `${failures.length}/${workspaces.length} isolated workspaces failed`);
} catch (error) {
  if (error.stdout) console.error(String(error.stdout));
  if (error.stderr) console.error(String(error.stderr));
  throw error;
} finally { rmSync(scratch, { recursive: true, force: true }); }
