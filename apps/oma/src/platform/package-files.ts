/** The host selects package filesystem effects; Runtime receives only the port. */
import type { PackageDirectories } from "../ports/package-files.js";
import { listOwnedDirectory, repairOwnedEntryMode } from "@oma/storage/directory";
import { listHostStaged, repairHostStagedEntryMode } from "@oma/platform-mac/files";
export const packageDirectories: PackageDirectories = process.platform === "darwin"
  ? Object.freeze({ list: listHostStaged, repair: (path: string) => repairHostStagedEntryMode(path) !== null })
  : Object.freeze({ list: listOwnedDirectory, repair: (path: string) => repairOwnedEntryMode(path) !== null });
