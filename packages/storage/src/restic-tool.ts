/** Pinned host-tool bytes and owned file capability; no subprocess dependency. */
import { closeSync, fchmodSync, fstatSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { RESTIC_RELEASE } from "@oma/domain/deployment";
import { StoreError } from "@oma/domain/errors";
import { withAsyncCleanup } from "@oma/native/cleanup";
import { openRegularBeneath, withinDirectory } from "@oma/native/files";
import { repairOwnedEntryMode } from "./directory.js";
import { digestDescriptor } from "./cache-trees.js";

export function managedResticPath(env: NodeJS.ProcessEnv = process.env): string | null {
  if (process.platform !== "linux" || (process.arch !== "x64" && process.arch !== "arm64")) return null;
  const data = env.XDG_DATA_HOME ?? (env.HOME ? join(env.HOME, ".local/share") : null);
  if (data === null || !isAbsolute(data)) return null;
  return join(data, "oma-toolchain", "restic", RESTIC_RELEASE.version, `linux-${process.arch}`, "restic");
}
export async function openResticTool(env: NodeJS.ProcessEnv = process.env): Promise<number | null> {
  const managed = managedResticPath(env), executable = env.OMA_RESTIC_COMMAND ?? managed;
  if (executable === null || executable === undefined) return null;
  if (!isAbsolute(executable)) throw new StoreError("UNSUPPORTED_PROFILE", "OMA_RESTIC_COMMAND must be absolute");
  if (executable === managed) repairOwnedEntryMode(executable);
  let fd: number;
  try { fd = withinDirectory(executable, (parent, name) => openRegularBeneath(parent, name)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  try {
    const pin = RESTIC_RELEASE.linux[process.arch as "x64" | "arm64"];
    const stat = fstatSync(fd);
    if (pin === undefined || (stat.mode & 0o022) !== 0 || await digestDescriptor(fd) !== pin.binarySha256)
      throw new StoreError("UNSUPPORTED_PROFILE", "Restic differs from the pinned host tool; run npm run setup:storage");
    if ((stat.mode & 0o100) === 0 && executable === managed && stat.uid === process.getuid?.()) fchmodSync(fd, stat.mode | 0o100);
    return fd;
  } catch (error) { return withAsyncCleanup(async () => { throw error; }, () => closeSync(fd)); }
}

