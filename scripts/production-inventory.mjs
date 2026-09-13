#!/usr/bin/env node
import { lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const slash = value => value.split(sep).join("/");
function repositoryPath(value) {
  if (typeof value !== "string" || !value || isAbsolute(value) || value.includes("\\") || value.includes("\0") ||
      value.split("/").some(part => !part || part === "." || part === ".."))
    throw new Error(`invalid production manifest path: ${String(value)}`);
  return value;
}
export function collectProductionFiles(rootInput = process.cwd()) {
  const root = realpathSync(rootInput);
  const manifest = JSON.parse(readFileSync(join(root, "production-manifest.json"), "utf8"));
  if (!Array.isArray(manifest) || manifest.length === 0) throw new Error("production manifest must be a nonempty array");
  const expand = entry => {
    const file = join(root, repositoryPath(entry));
    const stat = lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error(`symlink in production source: ${entry}`);
    const canonical = relative(root, realpathSync(file));
    if (canonical === ".." || canonical.startsWith(`..${sep}`) || isAbsolute(canonical)) throw new Error(`production source escapes root: ${entry}`);
    if (stat.isDirectory()) return readdirSync(file).sort().flatMap(name => expand(`${entry}/${name}`));
    if (!stat.isFile()) throw new Error(`nonregular production source: ${entry}`);
    if (entry.endsWith(".md")) return [];
    if (entry.endsWith(".in") && !entry.startsWith("implementation/systemd/")) throw new Error(`unsupported .in language: ${entry}`);
    return [slash(entry)];
  };
  const files = manifest.flatMap(expand).sort();
  if (new Set(files.map(file => realpathSync(join(root, file)))).size !== files.length)
    throw new Error("duplicate production source identity");
  // These are fixed runtime source roots, not a previous generated file list.
  // Removing a root from the input manifest cannot silently lower coverage/LOC.
  const required = ["src", "implementation/contracts.ts", "implementation/schema-v1.sql", "implementation/systemd"].flatMap(expand);
  const listed = new Set(files);
  const missing = required.filter(file => !listed.has(file));
  if (missing.length) throw new Error(`production manifest omits current runtime sources: ${missing.join(", ")}`);
  return files;
}
export function writeProductionInventory(root = process.cwd()) {
  const files = collectProductionFiles(root);
  writeFileSync(join(root, "production-files.txt"), `${files.join("\n")}\n`);
  return files;
}
export function assertProductionInventory(root = process.cwd()) {
  const current = collectProductionFiles(root);
  const bytes = readFileSync(join(root, "production-files.txt"), "utf8");
  const recorded = bytes.split(/\r?\n/).filter(Boolean);
  if (bytes !== `${current.join("\n")}\n`) {
    const present = new Set(recorded), expected = new Set(current);
    throw new Error(`stale production-files.txt; missing=[${current.filter(file => !present.has(file)).join(", ")}]; ` +
      `extra=[${recorded.filter(file => !expected.has(file)).join(", ")}]; regenerate with node scripts/loc.mjs --inventory-only; LOC/hash remain separately unverified`);
  }
  return current;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.some(value => value !== "--write")) throw new Error("usage: production-inventory.mjs [--write]");
    const write = args.includes("--write");
    const files = write ? writeProductionInventory() : assertProductionInventory();
    console.log(JSON.stringify({ status: write ? "SOURCE_LIST_GENERATED" : "SOURCE_LIST_CURRENT", files: files.length,
      loc: "NOT_MEASURED", runtimeProof: false }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
