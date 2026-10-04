#!/usr/bin/env node
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(join(root, "tsconfig.build.json"), "utf8"));
if (config.compilerOptions?.rootDir !== "." || config.compilerOptions?.outDir !== "dist")
  throw new Error("deployment layout requires rootDir='.' and outDir='dist'; no implicit flattening");
const output = join(root, "dist");
if (lstatSync(output, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error("refuse to clean a symlinked outDir");
const require = createRequire(import.meta.url);
const tsc = join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");

// A no-change rebuild is pure cost: `tsc --listFilesOnly` resolves the exact
// file set the compile will read, so hashing every listed input (plus the
// configs, the compiler itself and the lockfile that can swap types under it)
// proves the outputs must be identical. The stamp also lists every emitted
// file; a missing output or a different input set falls back to the full
// clean compile, so a skipped build can never leave stale files in dist.
const stampPath = join(output, ".build-stamp.json");
const hash = createHash("sha256");
const listed = spawnSync(process.execPath, [tsc, "-p", join(root, "tsconfig.build.json"), "--listFilesOnly"], {
  cwd: root, encoding: "utf8", timeout: 120000, killSignal: "SIGKILL",
});
if (listed.error || listed.signal || listed.status !== 0) process.exit(listed.status ?? 1);
const extraInputs = ["tsconfig.json", "tsconfig.build.json", "package.json", "package-lock.json",
  join("node_modules", "typescript", "package.json")];
for (const name of [...listed.stdout.trim().split("\n").sort(), ...extraInputs]) {
  const absolute = resolve(root, name);
  hash.update(relative(root, absolute).split(sep).join("/"));
  hash.update("\0");
  hash.update(readFileSync(absolute));
  hash.update("\0");
}
const digest = hash.digest("hex");
let prior = {};
try { prior = JSON.parse(readFileSync(stampPath, "utf8")); } catch { /* no stamp: full build */ }
const fresh = prior.digest === digest && Array.isArray(prior.outputs) &&
  prior.outputs.every(file => existsSync(join(output, file)) && !lstatSync(join(output, file)).isDirectory());
if (!fresh) {
  rmSync(output, { recursive: true, force: true });
  const compiled = spawnSync(process.execPath, [tsc, "-p", join(root, "tsconfig.build.json")], {
    cwd: root, stdio: "inherit", timeout: 600000, killSignal: "SIGKILL",
  });
  if (compiled.error || compiled.signal || compiled.status !== 0) process.exit(compiled.status ?? 1);
  const emitted = [];
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (absolute !== stampPath) emitted.push(relative(output, absolute).split(sep).join("/"));
    }
  };
  walk(output);
  writeFileSync(stampPath, JSON.stringify({ digest, outputs: emitted.sort() }));
}
// Rebuilding a linked package must preserve executable permissions for its commands.
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const commands = typeof manifest.bin === "string" ? [manifest.bin] : Object.values(manifest.bin ?? {});
for (const command of commands) chmodSync(join(root, command), 0o755);
// AV16, CLI-001: the sandbox's `oma` command, written from its one owner.
{
  const { DEPLOYMENT_LAYOUT } = await import(pathToFileURL(join(output, "src/domain/deployment.js")).href);
  const { modelCommandScript } = await import(pathToFileURL(join(output, "src/sandbox.js")).href);
  const command = join(root, DEPLOYMENT_LAYOUT.modelCommand);
  mkdirSync(dirname(command), { recursive: true });
  writeFileSync(command, modelCommandScript(), { mode: 0o755 });
  chmodSync(command, 0o755);
}
const checked = spawnSync(process.execPath, [join(root, "scripts/check-package.mjs"), "--root", root], {
  cwd: root, stdio: "inherit", timeout: 60000, killSignal: "SIGKILL",
});
if (checked.error || checked.signal || checked.status !== 0) process.exit(checked.status ?? 1);
