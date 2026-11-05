/** Caller-owned cursors under the same canonical capability used by Git. */
import { closeSync, constants, fstatSync, fsyncSync } from "node:fs";
import { mkdirAt } from "@oma/file-descriptors";
import { openBeneath } from "@oma/native/files";
import { withCleanup } from "@oma/native/cleanup";
import { StoreError } from "@oma/domain/errors";
import type { CanonicalExecution } from "./canonical-command.js";

export function openCanonicalDirectory(repository: string, name: "oma-results" | "oma-preparations",
    execution?: CanonicalExecution, create = false): number | undefined {
  const project = execution?.directories.get(repository);
  if (project === undefined) return undefined;
  if (create) {
    try { mkdirAt(project, name, 0o700); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  }
  const directory = openBeneath(project, name, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    const stat = fstatSync(directory);
    if (stat.uid !== process.getuid?.() || (stat.mode & 0o022) !== 0)
      throw new StoreError("REF_STATE_UNKNOWN", "canonical artifact directory is not privately owned");
    if (create) { fsyncSync(directory); fsyncSync(project); }
    return directory;
  } catch (error) { return withCleanup(() => { throw error; }, () => closeSync(directory)); }
}
