#!/usr/bin/env node
import { chmodSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(join(root, "tsconfig.build.json"), "utf8"));
if (config.compilerOptions?.rootDir !== "." || config.compilerOptions?.outDir !== "dist")
  throw new Error("deployment layout requires rootDir='.' and outDir='dist'; no implicit flattening");
const output = join(root, "dist");
if (lstatSync(output, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error("refuse to clean a symlinked outDir");
rmSync(output, { recursive: true, force: true });
const require = createRequire(import.meta.url);
const tsc = join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");
const compiled = spawnSync(process.execPath, [tsc, "-p", join(root, "tsconfig.build.json")], {
  cwd: root, stdio: "inherit", timeout: 600000, killSignal: "SIGKILL",
});
if (compiled.error || compiled.signal || compiled.status !== 0) process.exit(compiled.status ?? 1);
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
