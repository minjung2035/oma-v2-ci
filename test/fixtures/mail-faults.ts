// Fault injection lives only in tests; production has no stop-point API.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { dirname, join } from "node:path";
import type { AuthContext, MailInput } from "../../implementation/contracts.js";
import type { MailModule } from "../../src/mail.js";
import type { Store } from "../../src/store.js";

export type MailStopPoint = "stage" | "object" | "accepted" | "archive" | `inbox-${number}`;
export class StopSignal extends Error {
  constructor(readonly point: MailStopPoint) { super(`stop at ${point}`); }
}

export async function sendWithStop(mail: MailModule, store: Store, auth: AuthContext, key: string, input: MailInput, point?: MailStopPoint) {
  if (!point) return mail.send(auth, key, input);
  const root = dirname(dirname(mail.objectPath("unused")));
  const stage = join(dirname(root), "staging", `send-${key}`);
  const fsync = fs.fsyncSync;
  const transaction = store.transaction;
  let stopped = false;
  let inboxes = 0;
  const stop = () => { stopped = true; throw new StopSignal(point); };
  fs.fsyncSync = fd => {
    fsync(fd);
    if (stopped) return;
    const path = fs.readlinkSync(`/proc/self/fd/${fd}`);
    const stat = fs.fstatSync(fd);
    if (point === "stage" && stat.isFile() && dirname(path) === stage) stop();
    if (!stat.isDirectory()) return;
    if (
      (point === "object" && path === join(root, "objects")) ||
      (point === "archive" && path === join(root, "archive", "cur"))) stop();
    if (point.startsWith("inbox-") && path.startsWith(join(root, "inboxes") + "/") && path.endsWith("/new") && ++inboxes === Number(point.slice(6))) stop();
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
    // A post-acceptance I/O fault legitimately returns pending from production.
    if (stopped) throw new StopSignal(point);
    throw new Error(`mail fault boundary not reached: ${point}; ${receipt.state}`);
  } finally {
    fs.fsyncSync = fsync;
    store.transaction = transaction;
    syncBuiltinESMExports();
  }
}
