import { createMailModule } from "#oma-test/app/broker/mail-composition";
/** V22B child: runs inside a private user+mount namespace whose state root is a
 * real, size-limited tmpfs filled to ENOSPC. It reports what new work and the
 * completion of an already accepted mail did on the full filesystem. The
 * logical storage quota is never involved here.
 */
import { closeSync, existsSync, openSync, readFileSync, readdirSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { AuthContext } from "@oma/contracts";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { errorCodeOf } from "@oma/domain/errors";
import { sha256Hex } from "@oma/domain/canonical-json";
import { ALL_CAPS, makeValidAgent } from "./spec.js";
import { sendWithStop } from "./mail-faults.js";

const root = process.argv[2];
if (!root) throw new Error("full-fs harness requires its tmpfs state root");
const store = new Store(join(root, "runtime.sqlite"));
store.transaction(tx => { tx.insertAgent(makeValidAgent("a")); tx.insertAgent(makeValidAgent("b")); });
const mail = createMailModule({ stateRoot: root, society: "full" }, store, 64);
const auth: AuthContext = { actor: "a", incarnation: 1, role: "resident", channel: "actor", capabilities: new Set(ALL_CAPS),
  peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } };
const input = (subject: string) => ({ to: ["b"], subject, kind: "message" as const, body: "x".repeat(2048) });

const first = await mail.send(auth, "first", input("first"));
await sendWithStop(mail, store, auth, "pending", input("pending"), "accepted").catch(() => undefined);
// Fill every remaining byte of the real filesystem.
const filler = openSync(join(root, "filler"), "w");
let fillCode: string | undefined;
try {
  for (const size of [64 * 1024, 4096, 1]) {
    const chunk = Buffer.alloc(size, 0x61);
    try { for (;;) writeSync(filler, chunk); }
    catch (error) { fillCode = (error as { code?: string }).code; }
  }
} finally { closeSync(filler); }

const report: Record<string, unknown> = { first: first.state, fillCode };
try { report.newWork = { ok: true, state: (await mail.send(auth, "new", input("new"))).state }; }
catch (error) { report.newWork = { ok: false, code: errorCodeOf(error) }; }
report.newRow = store.getOperation("a", "new")?.state ?? null;
const staging = join(root, "staging", "mail-objects");
report.staged = existsSync(staging) ? readdirSync(staging) : [];
try { report.recovery = await mail.reconcilePending(); }
catch (error) { report.recovery = { error: errorCodeOf(error) }; }
const pending = store.getOperation("a", "pending");
if (pending?.kind !== "mail.send") throw new Error("the accepted fixture mail is missing");
const message = pending.plan.message;
report.pending = {
  state: pending.state,
  objectIntact: sha256Hex(readFileSync(mail.objectPath(message.id))) === message.sha256,
  archive: existsSync(mail.archivePath(message.id)),
  materialized: store.deliveriesForOperation(pending.id).every(delivery => delivery.materialized === 1),
};
store.close();
console.log(`REPORT:${JSON.stringify(report)}`);
