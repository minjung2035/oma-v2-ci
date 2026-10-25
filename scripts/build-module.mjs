#!/usr/bin/env node
/** Export one independently compiled workspace without mutating shared build outputs. */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [module, flag, target, ...extra] = process.argv.slice(2);
if (!["tui", "extension"].includes(module) || flag !== "--out" || !target || extra.length)
  throw new Error("usage: build-module.mjs <tui|extension> --out <new-directory>");
const output = resolve(target);
if (existsSync(output)) throw new Error("module output already exists; existing artifacts are never replaced");
mkdirSync(output, { recursive: false });
execFileSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", join(root, `packages/${module}/tsconfig.json`),
  "--outDir", join(output, "dist"), "--tsBuildInfoFile", join(output, ".tsbuildinfo")], { cwd: root, stdio: "inherit" });
cpSync(join(root, `packages/${module}/package.json`), join(output, "package.json"));
console.log(JSON.stringify({ status: "BUILT", module, output, source: `@oma/${module} workspace` }));
