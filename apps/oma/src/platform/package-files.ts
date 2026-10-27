/** The host selects package filesystem effects; Runtime receives only the port. */
import type { PackageDirectories } from "../ports/package-files.js";
import { listOwnedDirectory, repairOwnedEntryMode } from "@oma/storage/directory";
export const packageDirectories: PackageDirectories = Object.freeze({
  list: listOwnedDirectory, repair: (path: string) => repairOwnedEntryMode(path) !== null,
});
