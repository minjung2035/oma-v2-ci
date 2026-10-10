/** The host selects package filesystem effects; Runtime receives only the port. */
import type { PackageDirectories } from "../ports/package-files.js";
import { listOwnedDirectory, repairOwnedEntryMode } from "../storage/directory.js";
import { listHostStaged, repairHostStagedEntryMode } from "./host/files.js";
export const packageDirectories: PackageDirectories = process.platform === "darwin"
  ? Object.freeze({ list: listHostStaged, repair: (path: string) => repairHostStagedEntryMode(path) !== null })
  : Object.freeze({ list: listOwnedDirectory, repair: (path: string) => repairOwnedEntryMode(path) !== null });
