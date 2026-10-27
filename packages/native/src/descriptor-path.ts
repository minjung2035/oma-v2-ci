/** Linux's exact inherited descriptor lookup. No caller constructs proc-fd
 * strings or substitutes an unchecked pathname on another operating system. */
import { StoreError } from "@oma/domain/errors";
export function inheritedDescriptorPath(fd: number, purpose: "read" | "execute"): string {
  if (!Number.isSafeInteger(fd) || fd < 0) throw new TypeError("invalid inherited descriptor");
  if (process.platform !== "linux" && process.platform !== "darwin")
    throw new StoreError("UNSUPPORTED_PROFILE", `exact descriptor ${purpose} lookup is unsupported on this platform`);
  return `${process.platform === "linux" ? "/proc" : "/dev"}/fd/${fd}`;
}
