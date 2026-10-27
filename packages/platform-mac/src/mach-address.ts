/** Public rendezvous spelling only. A name grants no actor/broker identity. */
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { StoreError } from "@oma/domain/errors";
export function machRendezvousName(path: string): string {
  if (!isAbsolute(path) || path.includes("\0"))
    throw new StoreError("UNSUPPORTED_PROFILE", "Mach endpoint requires an absolute, NUL-free address");
  return `com.oma.rpc.${createHash("sha256").update(path).digest("hex")}`;
}
