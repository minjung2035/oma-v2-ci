/** Resolve assets only within this installation's signed Mac bundle. */
import { basename, dirname } from "node:path";
import { StoreError } from "../../domain/errors.js";

export function macBundleResources(libdir: string): string {
  let resources = libdir;
  while (basename(resources) !== "Resources" && dirname(resources) !== resources) resources = dirname(resources);
  if (basename(resources) !== "Resources" || basename(dirname(resources)) !== "Contents")
    throw new StoreError("UNSUPPORTED_PROFILE", "This operation requires the signed OMA app bundle");
  return resources;
}
