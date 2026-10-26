/** An installation fixture copies runtime artifacts, never checkout source. */
import { cpSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";

export function productionModulePaths(source: string): string[] {
  const lock = JSON.parse(readFileSync(join(source, "package-lock.json"), "utf8")) as {
    packages: Record<string, { dev?: boolean; optional?: boolean }>;
  };
  const modules = new Set<string>();
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (!key.startsWith("node_modules/") || entry.dev === true || entry.optional === true && !existsSync(join(source, key))) continue;
    const parts = key.split("/");
    modules.add(parts[1]!.startsWith("@") ? parts.slice(0, 3).join("/") : parts.slice(0, 2).join("/"));
  }
  return [...modules].sort();
}

export function copyInstalledProduct(source: string, prefix: string, options: { engine?: boolean } = {}): void {
  const paths = [DEPLOYMENT_LAYOUT.schema, "package.json", "package-lock.json",
    ...DEPLOYMENT_LAYOUT.workspaces.flatMap(workspace => [`${workspace.root}/dist`, `${workspace.root}/package.json`])];
  for (const path of paths) cpSync(join(source, path), join(prefix, path), { recursive: true });
  for (const path of productionModulePaths(source)) {
    if (options.engine === false && path === "node_modules/@earendil-works/pi-coding-agent") continue;
    // npm's workspace links are relative to the installation's own packages.
    cpSync(join(source, path), join(prefix, path), { recursive: true, verbatimSymlinks: true });
  }
}
