/** MODE-005/006: the guest holder's private, path-free new-session request.
 * It is not a history/death oracle; the holder also observes actual child exit. */
import { closeSync, writeSync } from "node:fs";
import { encodeFrame } from "../frame.js";
import { withCleanup } from "../process/cleanup.js";

export const HOST_SESSION_HANDOFF_ENV = "OMA_HOST_SESSION_HANDOFF";
export const HOST_SESSION_HANDOFF_FD = 3;
export function requestHostNewSession(): boolean {
  if (process.env[HOST_SESSION_HANDOFF_ENV] === undefined) return false;
  if (process.env[HOST_SESSION_HANDOFF_ENV] !== String(HOST_SESSION_HANDOFF_FD))
    throw new Error("Invalid host session handoff descriptor");
  return withCleanup(() => {
    const bytes = encodeFrame({ next: "new" });
    for (let at = 0; at < bytes.length;) {
      const written = writeSync(HOST_SESSION_HANDOFF_FD, bytes, at, bytes.length - at);
      if (written === 0) throw new Error("Host session handoff could not be written");
      at += written;
    }
    return true;
  }, () => closeSync(HOST_SESSION_HANDOFF_FD));
}
