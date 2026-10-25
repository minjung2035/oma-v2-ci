/** Copy declared build assets exactly; never follow links or replace compiler output. */
import { constants, copyFileSync, lstatSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

function assetParts(asset) {
  if (typeof asset !== "string" || asset.includes("\\") || asset.includes("\0") ||
      asset.split("/").some(part => !part || part === "." || part === ".."))
    throw new Error(`invalid build asset path: ${String(asset)}`);
  return asset.split("/");
}

export function copyWorkspaceAssets(directory, assets) {
  const source = join(directory, "src"), output = join(directory, "dist");
  for (const root of [source, output]) {
    const stat = lstatSync(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`invalid asset root: ${root}`);
  }
  const ensureDirectory = path => {
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat) mkdirSync(path);
    else if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`invalid asset destination: ${path}`);
  };
  const copy = (from, to) => {
    const stat = lstatSync(from);
    if (stat.isSymbolicLink()) throw new Error(`linked build asset: ${from}`);
    if (stat.isFile()) copyFileSync(from, to, constants.COPYFILE_EXCL);
    else if (stat.isDirectory()) {
      // Existing directories can hold compiler output, so no recursive merge.
      mkdirSync(to);
      for (const name of readdirSync(from).sort()) copy(join(from, name), join(to, name));
    } else throw new Error(`nonregular build asset: ${from}`);
  };
  for (const asset of assets) {
    const parts = assetParts(asset);
    let from = source, to = output;
    for (const name of parts.slice(0, -1)) {
      from = join(from, name); to = join(to, name);
      const stat = lstatSync(from);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`invalid asset parent: ${from}`);
      ensureDirectory(to);
    }
    copy(join(from, parts.at(-1)), join(to, parts.at(-1)));
  }
}

/** The installed artifact must retain every declared asset, including empty
 * directories. Comparing data never evaluates unverified vendor code. */
export function workspaceAssetSnapshot(directory, tree, assets) {
  if (!["src", "dist"].includes(tree)) throw new Error("invalid asset tree");
  const result = {};
  const root = lstatSync(join(directory, tree));
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error("invalid asset root");
  const walk = (path, relative) => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`linked build asset: ${path}`);
    if (stat.isDirectory()) {
      result[relative] = "directory";
      for (const name of readdirSync(path).sort()) walk(join(path, name), `${relative}/${name}`);
    } else if (stat.isFile()) result[relative] = createHash("sha256").update(readFileSync(path)).digest("hex");
    else throw new Error(`nonregular build asset: ${path}`);
  };
  for (const asset of assets) {
    const parts = assetParts(asset);
    let path = join(directory, tree);
    for (const part of parts.slice(0, -1)) {
      path = join(path, part);
      const stat = lstatSync(path);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`invalid asset parent: ${path}`);
    }
    walk(join(path, parts.at(-1)), asset);
  }
  return result;
}
