/** Resolve a public package entry for syntax-driven collaborator tests. */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
export function workspaceSource(specifier) {
  if (!/^@oma\/[a-z][a-z-]*(?:\/|$)/.test(specifier) && !/^#oma-test\/app\/[a-z][a-z0-9/-]*$/.test(specifier))
    throw new Error(`not a workspace API: ${specifier}`);
  const resolved = fileURLToPath(import.meta.resolve(specifier));
  if (!/\/(?:packages\/[^/]+|apps\/oma)\/dist\/.+\.js$/.test(resolved)) throw new Error(`unexpected workspace entry ${resolved}`);
  return resolved.replace(/(\/(?:packages\/[^/]+|apps\/oma))\/dist\//, "$1/src/").replace(/\.js$/, ".ts");
}

/** A collaborator may load only an entry that its owning package exports. */
export function workspaceEntryForSource(file) {
  const match = /^(packages\/[^/]+|apps\/oma)\/src\/(.+)\.ts$/.exec(file);
  if (!match) throw new Error(`not a workspace source: ${file}`);
  const manifest = JSON.parse(readFileSync(resolve(match[1], "package.json"), "utf8"));
  if (match[1] === "apps/oma") {
    const specifier = `#oma-test/app/${match[2]}`;
    if (workspaceSource(specifier) !== resolve(file)) throw new Error(`private test/source mismatch: ${file}`);
    return specifier;
  }
  const subpath = Object.keys(manifest.exports).find(name => manifest.exports[name].types === `./dist/${match[2]}.d.ts`);
  if (subpath === undefined) throw new Error(`source has no public entry: ${file}`);
  const specifier = manifest.name + (subpath === "." ? "" : subpath.slice(1));
  if (workspaceSource(specifier) !== resolve(file)) throw new Error(`export/source mismatch: ${file}`);
  return specifier;
}
