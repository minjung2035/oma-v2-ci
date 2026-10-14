#!/usr/bin/env node
/** Independent source closure and deployable extension payload, without workspace relocation. */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleRecordProblems } from "./vendor-bundle-lib.mjs";
import { TUI_PUBLIC_SUBPATHS } from "./architecture/rules/surface-rules.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [module, flag, target, ...extra] = process.argv.slice(2);
if (!["tui", "extension"].includes(module) || flag !== "--out" || !target || extra.length)
  throw new Error("usage: build-module.mjs <tui|extension> --out <new-directory>");
const output = resolve(target);
if (existsSync(output)) throw new Error("module output already exists; existing artifacts are never replaced");
mkdirSync(output, { recursive: false });
execFileSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", join(root, `tsconfig.${module}.json`), "--outDir", output],
  { cwd: root, stdio: "inherit" });
const forbidden = ["runtime", "application", "storage", "broker", "store"];
for (const name of forbidden)
  if (existsSync(join(output, "src", name)) || existsSync(join(output, "src", `${name}.js`)))
    throw new Error(`independent ${module} build reached ${name}`);
if (module === "extension") {
  if (existsSync(join(output, "src/tui")) || existsSync(join(output, "src/platform")))
    throw new Error("extension build reached the presentation or platform implementation");
  const vendor = join(root, "src/extension/vendor");
  for (const bundle of readdirSync(vendor)) {
    const source = join(vendor, bundle), manifest = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8"));
    const problems = bundleRecordProblems(manifest, source);
    if (problems.length) throw new Error(`${bundle}: ${problems.join("; ")}`);
    const copied = join(output, "src/extension/vendor", bundle);
    cpSync(source, copied, { recursive: true });
    const copiedProblems = bundleRecordProblems(manifest, copied);
    if (copiedProblems.length) throw new Error(`${bundle} copied payload differs: ${copiedProblems.join("; ")}`);
  }
}
const dependencies = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).dependencies;
const names = module === "extension" ? ["@earendil-works/pi-coding-agent", "typebox"]
  : ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui", "typebox"];
writeFileSync(join(output, "package.json"), JSON.stringify({ name: `@oma/${module}`, private: true, type: "module",
  ...(module === "extension" ? { main: "src/pi-extension.js", exports: { ".": "./src/pi-extension.js" },
    pi: { extensions: ["./src/pi-extension.js"] } } : {
    exports: Object.fromEntries(TUI_PUBLIC_SUBPATHS.map(name => [`./${name}`, {
      types: `./src/tui/${name}.d.ts`, default: `./src/tui/${name}.js`,
    }])) }),
  dependencies: Object.fromEntries(names.map(name => [name, dependencies[name]])) }, null, 2) + "\n");
console.log(JSON.stringify({ status: "BUILT", module, output, vendor: module === "extension" ? "verified before and after copy" : "not included" }));
