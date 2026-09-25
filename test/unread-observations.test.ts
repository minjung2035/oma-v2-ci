/** AV7 -- INV02 and arch §23.5 where an observation decides what is admitted
 * or shown: a directory that exists and cannot be read is neither empty nor
 * absent.
 *
 * Storage admission measured a root it could not see as 0 bytes, although
 * every other entry of the same walk that could not be seen was unavailable.
 * The Dashboard counted a Principal mailbox it could not list as 0 messages
 * waiting, and the Mail screen showed it as "no mail" -- the conversions of a
 * missing observation into "0" the Dashboard's own contract rules out.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { observedStorageBytes } from "../src/storage/quota.js";
import { StoreError } from "../src/domain/errors.js";
import { readMailbox, unreadCount, type MailboxPaths } from "../src/tui/sources/mail.js";
import { TuiApp, type AppPorts } from "../src/tui/app.js";
import type { Terminal } from "../src/tui/screen.js";
import { unknownDashboard } from "./fixtures/dashboard.js";

const CTRL_X = Buffer.from([0x18]);
const RIGHT = Buffer.from(`${String.fromCharCode(27)}[C`);

function terminal(): Terminal & { frames: string[][] } {
  const frames: string[][] = [];
  return { frames, columns: 110, rows: 20, draw(lines) { frames.push([...lines]); }, onKeys() {}, onResize() {}, restore() {} };
}

// Needs a user a mode of 000 refuses, as every verification lane runs as.
function withSealedDirectory(run: (root: string, sealed: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "oma-av7-"));
  const sealed = join(root, "sealed");
  mkdirSync(sealed);
  try {
    chmodSync(sealed, 0o000);
    run(root, sealed);
  } finally {
    chmodSync(sealed, 0o700);
    rmSync(root, { recursive: true, force: true });
  }
}

test("AV7 / INV02: storage below a root that cannot be observed is unavailable, not 0 bytes", () => {
  withSealedDirectory((root, sealed) => {
    assert.equal(observedStorageBytes(join(root, "absent")), 0, "an absent root holds nothing");
    assert.throws(() => observedStorageBytes(join(sealed, "state")),
      (error: unknown) => error instanceof StoreError && error.code === "BROKER_UNAVAILABLE",
      "a root that could not be observed was measured as empty");
  });
});

test("AV7 / INV02, arch §23.5: a mailbox that cannot be listed is not an empty one, on the Dashboard or the Mail screen", () => {
  withSealedDirectory((root, sealed) => {
    const cur = join(root, "cur");
    mkdirSync(cur);
    writeFileSync(join(cur, "m1"), "From: worker-a\nSubject: settled\n\nbody\n");
    const paths: MailboxPaths = { newDir: sealed, curDir: cur };
    assert.equal(unreadCount(paths), null, "an unlisted mailbox was counted as 0 waiting");
    const read = readMailbox(paths);
    assert.equal(read.rows.length, 1, "what could be read is still shown");
    assert.match(read.unreadable ?? "", /EACCES/);
    assert.equal(unreadCount({ newDir: join(root, "absent"), curDir: cur }), 0, "an absent directory holds no mail");

    // The real app over this mailbox, as V28A drives it.
    const screen = terminal();
    const ports: AppPorts = {
      configFields: () => [], extensions: () => [],
      dashboard: () => ({ ...unknownDashboard(), unread: unreadCount(paths) }),
      mail: () => readMailbox(paths), body: () => null,
      setField: () => ({ kind: "saved" }), setExtension: () => {}, submitPrompt: () => ({ kind: "accepted" }), quit: () => {},
    };
    const app = new TuiApp(ports, screen, 262144);
    app.refresh(); app.draw();
    const last = () => (screen.frames.at(-1) ?? []).join("\n");
    app.feed(CTRL_X);
    assert.match(last(), /Mail\s+unknown \(메일함을 읽지 못함\)/);
    assert.doesNotMatch(last(), /0건/, "the Dashboard counted an unlisted mailbox as none waiting");
    app.feed(RIGHT); app.feed(RIGHT);
    assert.match(last(), /메일함 일부를 읽지 못함 \(EACCES/, "the Mail screen did not say part of the mailbox was unread");
    assert.match(last(), /settled/, "what could be read was not shown");
  });
});

test("DR13 / INV02: a message file that cannot be read now is not 'no message'; the count is unknown and the rest is still shown", { skip: process.getuid?.() === 0 }, () => {
  const root = mkdtempSync(join(tmpdir(), "oma-av7-entry-"));
  try {
    const pending = join(root, "new"), cur = join(root, "cur");
    mkdirSync(pending); mkdirSync(cur);
    writeFileSync(join(pending, "m1"), "From: worker-a\nSubject: readable\n\nbody\n");
    writeFileSync(join(pending, "m2"), "From: worker-b\nSubject: sealed\n\nbody\n");
    chmodSync(join(pending, "m2"), 0o000);
    const paths: MailboxPaths = { newDir: pending, curDir: cur };
    assert.equal(unreadCount(paths), null, "an unreadable message was counted as no message");
    const read = readMailbox(paths);
    assert.deepEqual(read.rows.map(row => row.id), ["m1"], "what could be read is still shown");
    assert.match(read.unreadable ?? "", /EACCES/);
    chmodSync(join(pending, "m2"), 0o600);
    assert.equal(unreadCount(paths), 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
