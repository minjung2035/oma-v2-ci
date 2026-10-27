/** Read-only observation of installation files hidden from model code.
 * Shared by both platform recipes; no state mutation or execution authority. */
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
import { StoreError } from "@oma/domain/errors";

export function productSurfaceMasks(libdir: string): readonly { path: string; kind: "dir" | "file" }[] {
  const masks: { path: string; kind: "dir" | "file" }[] = [];
  for (const path of DEPLOYMENT_LAYOUT.productSurface) {
    const found = lstatSync(join(libdir, path), { throwIfNoEntry: false });
    if (found === undefined) continue;
    if (found.isSymbolicLink()) throw new StoreError("UNSUPPORTED_PROFILE", `installed product path ${path} is a link`);
    masks.push({ path, kind: found.isDirectory() ? "dir" : "file" });
  }
  return Object.freeze(masks);
}
