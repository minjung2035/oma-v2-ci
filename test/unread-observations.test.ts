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
import { chmodSync, linkSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { observedStorageBytes, EXCLUDED_USAGE_TREES } from "../src/storage/quota.js";
import { EXCLUDED_USAGE_TREES as MIRRORED_USAGE_TREES } from "../src/extension/workspace-guard.js";
import { StoreError } from "../src/domain/errors.js";
import { readMailbox, unreadCount, type MailboxPaths } from "../src/tui/sources/mail.js";
import { TuiApp, type AppPorts } from "../src/tui/app.js";
import type { Terminal } from "../src/tui/screen.js";
import { unknownDashboard } from "./fixtures/dashboard.js";

const CTRL_X = Buffer.from([0x18]);
const RIGHT = Buffer.from(`${String.fromCharCode(27)}[C`);

function terminal(): Terminal & { frames: string[][] } {
  const frames: string[][] = [];
  return { frames, columns: 110, rows: 20, draw(lines) { frames.push([...lines]); }, onKeys() {}, onResize() {}, repaint() {}, restore() {} };
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
    // P0V-66: what waits for the session is the ledger's (unknown here); the
    // mailbox that could not be listed makes what arrived unknown, not 0.
    assert.match(last(), /Mail\s+unknown \(.*\) · New arrivals unknown \(mailbox unreadable\)/);
    assert.doesNotMatch(last(), /\b0 new arrivals/, "the Dashboard counted an unlisted mailbox as none waiting");
    app.feed(RIGHT); app.feed(RIGHT);
    assert.match(last(), /Part of the mailbox is unreadable \(EACCES/, "the Mail screen did not say part of the mailbox was unread");
    assert.match(last(), /settled/, "what could be read was not shown");
  });
});

test("DR13 / INV02: a message file that cannot be read now is not 'no message'; it is still counted as waiting and the rest is still shown", { skip: process.getuid?.() === 0 }, () => {
  const root = mkdtempSync(join(tmpdir(), "oma-av7-entry-"));
  try {
    const pending = join(root, "new"), cur = join(root, "cur");
    mkdirSync(pending); mkdirSync(cur);
    writeFileSync(join(pending, "m1"), "From: worker-a\nSubject: readable\n\nbody\n");
    writeFileSync(join(pending, "m2"), "From: worker-b\nSubject: sealed\n\nbody\n");
    chmodSync(join(pending, "m2"), 0o000);
    const paths: MailboxPaths = { newDir: pending, curDir: cur };
    // P0V-43: the count asks the directory's names (lstat), which answer that
    // m2 is a regular file -- a message waiting, whether or not it can be read
    // now. Only a name that does not answer is the count's unknown (DR13).
    assert.equal(unreadCount(paths), 2, "an unreadable message was counted as no message");
    const read = readMailbox(paths);
    assert.deepEqual(read.rows.map(row => row.id), ["m1"], "what could be read is still shown");
    assert.match(read.unreadable ?? "", /EACCES/);
    chmodSync(join(pending, "m2"), 0o600);
    assert.equal(unreadCount(paths), 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test("UX-10b / FI-4, INV04: regenerated trees under the state root are not charged; a same-named file is", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-av7-excluded-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.deepEqual([...MIRRORED_USAGE_TREES].sort(), [...EXCLUDED_USAGE_TREES].sort(),
    "the workspace guard's exclusion set is the storage owner's, mirrored");
  const workspace = join(root, "workspaces", "alice");
  for (const tree of ["node_modules", ".git", ".venv", "target", "dist", "build"]) {
    mkdirSync(join(workspace, tree), { recursive: true });
    writeFileSync(join(workspace, tree, "bulk.bin"), "x".repeat(64 * 1024));
  }
  const authored = join(workspace, "src"); mkdirSync(authored, { recursive: true });
  const measured = observedStorageBytes(root);
  // An excluded tree contributes nothing -- not even its own directory inode.
  writeFileSync(join(workspace, "node_modules", "big.bin"), "x".repeat(128 * 1024));
  assert.ok(observedStorageBytes(root) > measured, "diagnostics include every tree");
  // A file carrying an excluded name is authored content and counts.
  writeFileSync(join(authored, "node_modules"), "z".repeat(1024));
  assert.ok(observedStorageBytes(root) > measured, "authored bytes are still observed");
  // The walked root itself is never excluded, even when its name is on the list.
  assert.ok(observedStorageBytes(join(workspace, "node_modules")) > 0);
});

test("DR27/INV10: an empty stored inode has positive cost; a hardlink does not double-charge its data", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-empty-storage-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const empty = join(root, "empty"); writeFileSync(empty, "");
  assert.ok(observedStorageBytes(empty) >= 1);
  const before = observedStorageBytes(root);
  for (let n = 0; n < 100; n++) writeFileSync(join(root, `empty-${n}`), "");
  assert.ok(observedStorageBytes(root) >= before + 100);
  const large = join(root, "large"); writeFileSync(large, "x".repeat(128 * 1024));
  const one = observedStorageBytes(root);
  linkSync(large, join(root, "alias"));
  assert.ok(observedStorageBytes(root) < one + observedStorageBytes(large));
});
