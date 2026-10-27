/** The only native boundary of the SDK-free file policy (NATIVE-025). */
import { constants, openSync } from "node:fs";
import { WorkspaceRefusal } from "./errors.js";
export { directoryNames, mkdirAt, openAt, reopenDirectory, unlinkAt } from "@oma/file-descriptors";

function assertProfile(): void {
  if (process.platform !== "linux" && process.platform !== "darwin")
    throw new WorkspaceRefusal("descriptor file access requires a supported POSIX platform");
}

/** A borrowed file description, not an independent cursor or directory path. */
export function descriptorPath(fd: number): string {
  if (!Number.isSafeInteger(fd) || fd < 0) throw new TypeError("invalid file descriptor");
  assertProfile();
  return `${process.platform === "linux" ? "/proc/self" : "/dev"}/fd/${fd}`;
}

export function openRoot(root: string): number {
  assertProfile();
  return openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
}

