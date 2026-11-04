/** An installation fixture copies runtime artifacts, never checkout source. */
import { cpSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
import { productionModuleRoots } from "#oma-test/app/runtime/module-inventory";

export function productionModulePaths(source: string): string[] {
  return [...productionModuleRoots(JSON.parse(readFileSync(join(source, "package-lock.json"), "utf8")), path => existsSync(join(source, path)))];
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
