/** Linux's exact inherited descriptor lookup. No caller constructs proc-fd
 * strings or substitutes an unchecked pathname on another operating system. */
import { StoreError } from "@oma/domain/errors";
export function inheritedDescriptorPath(fd: number, purpose: "read" | "execute"): string {
  if (!Number.isSafeInteger(fd) || fd < 0) throw new TypeError("invalid inherited descriptor");
  if (process.platform !== "linux") throw new StoreError("UNSUPPORTED_PROFILE",
    `G-FILES: exact descriptor ${purpose} lookup is unverified on this platform`);
  return `/proc/self/fd/${fd}`;
}
