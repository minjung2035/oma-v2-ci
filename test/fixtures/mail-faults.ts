// Fault injection lives only in tests; production has no stop-point API.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { dirname, join } from "node:path";
import { messageIdForOperation } from "@oma/domain/derived";
import type { AuthContext, MailInput } from "@oma/contracts";
import type { MailModule } from "@oma/mail";
import type { Store } from "@oma/storage";

export type MailStopPoint = "stage" | "object" | "accepted" | "archive" | `inbox-${number}`;
export class StopSignal extends Error {
  constructor(readonly point: MailStopPoint) { super(`stop at ${point}`); }
}

/** `halt` lets a child-process harness stop at the checkpoint itself, before any
 * workflow cleanup runs; without it the stop is an exception, not process death. */
export async function sendWithStop(mail: MailModule, store: Store, auth: AuthContext, key: string, input: MailInput, point?: MailStopPoint,
  halt?: (point: MailStopPoint) => void) {
  if (!point) return mail.send(auth, key, input);
  const probeId = messageIdForOperation("op-00000000-0000-4000-8000-000000000001", 0);
  const root = dirname(dirname(mail.objectPath(probeId)));
  const stage = join(dirname(root), "staging", "mail-objects");
  const fsync = fs.fsyncSync;
  const transaction = store.transaction;
  let stopped = false;
  let inboxes = 0;
  const stop = () => { stopped = true; halt?.(point); throw new StopSignal(point); };
  /** A directory fence fsync also runs before its entries are written
   * (ensureDurableDirectory). A boundary means the entry is already published,
   * so the condition waits for observable content. */
  const published = (directory: string): boolean => {
    try { return fs.readdirSync(directory).length > 0; } catch { return false; }
  };
  fs.fsyncSync = fd => {
    fsync(fd);
    if (stopped) return;
    const path = fs.readlinkSync(`/proc/self/fd/${fd}`);
    const stat = fs.fstatSync(fd);
    if (point === "stage" && stat.isFile() && dirname(path) === stage) stop();
    if (!stat.isDirectory()) return;
    if (point === "object" && path === join(root, "objects")) {
      if (published(path)) stop();
      return;
    }
    if (point === "archive" && path === join(root, "archive", "cur")) {
      if (published(path)) stop();
      return;
    }
    if (point.startsWith("inbox-") && path.startsWith(join(root, "inboxes") + "/") && path.endsWith("/new") &&
      published(path) && ++inboxes === Number(point.slice(6))) stop();
  };
  if (point === "accepted") store.transaction = new Proxy(transaction, {
    apply(target, receiver, args) {
      const result = Reflect.apply(target, receiver, args);
      if (!stopped) stop();
      return result;
    },
  });
  syncBuiltinESMExports();
  try {
    const receipt = await mail.send(auth, key, input);
    if (stopped) throw new StopSignal(point);
    throw new Error(`mail fault boundary not reached: ${point}; ${receipt.state}`);
  } finally {
    fs.fsyncSync = fsync;
    store.transaction = transaction;
    syncBuiltinESMExports();
  }
}
