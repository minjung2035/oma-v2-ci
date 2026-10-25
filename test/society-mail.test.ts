import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, linkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishMailNoticeView } from "#oma-test/app/views/mail-notices";
import { mailNoticeViewPath } from "@oma/storage/mail-notices";
import { readSocietyMail, principalMailbox, unreadCount } from "#oma-test/app/application/mail";

test("Society mail includes sent GOAL, peer replies and board; notices use ledger provenance and real names", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-society-mail-"));
  try {
    const put = (n: number, from: string, to: string, subject: string, audience = "archive", reply = "") => {
      const id = `m-00000000-0000-4000-8000-${String(n).padStart(12, "0")}-0`;
      const dir = join(root, "mail", audience, "cur");
      mkdirSync(dir, { recursive: true });
      const path = join(dir, id + ":2,");
      writeFileSync(path, `From: ${from}@demo.oma.invalid\nTo: ${to}@demo.oma.invalid\nSubject: ${subject}\nMessage-ID: <${id}@demo.oma.invalid>\nX-OMA-Kind: result\n${reply ? `In-Reply-To: <${reply}@demo.oma.invalid>\n` : ""}\nbody`);
      return { id, path };
    };
    const goal = put(1, "principal", "residents", "GOAL");
    put(2, "engine", "worker-1", "peer response", "archive", goal.id);
    put(3, "worker-1", "engine", "another response", "archive", goal.id);
    put(4, "engine", "residents", "review thread", "workers");
    const notice = put(5, "engine", "principal", "applied");
    put(6, "worker-1", "principal", "completion notice (agent-authored)");
    put(7, "engine", "principal", "unpublished", "objects");
    const store = { integrationNoticeRequester: (id: string) => id === notice.id ? "engine" : null };
    publishMailNoticeView(store, root);
    const inbox = principalMailbox(root);
    mkdirSync(inbox.newDir, { recursive: true });
    linkSync(notice.path, join(inbox.newDir, notice.id));
    // Duplicate publication links cannot duplicate a row.
    linkSync(goal.path, join(root, "mail", "workers", "cur", goal.id + ":2,"));
    const result = readSocietyMail(root, ["principal", "engine", "worker-1"]);
    assert.equal(result.unreadable, null);
    assert.equal(result.omitted, 0);
    assert.equal(result.rows.length, 6);
    assert.ok(result.rows.some(row => row.subject === "GOAL" && row.from === "principal"));
    assert.ok(result.rows.some(row => row.subject === "peer response" && row.from === "engine"));
    assert.ok(result.rows.some(row => row.subject === "another response" && row.from === "worker-1"));
    const automatic = result.rows.find(row => row.subject === "applied")!;
    assert.equal(automatic.from, "OMA");
    assert.equal(automatic.kind, "notice");
    assert.equal(automatic.requester, "engine");
    assert.equal(automatic.unread, true);
    assert.equal(result.rows.find(row => row.subject.startsWith("completion notice"))!.kind, "result");
    assert.equal(unreadCount(inbox), 1, "viewing does not acknowledge delivery");
    rmSync(mailNoticeViewPath(root));
    const offline = readSocietyMail(root);
    assert.equal(offline.rows.length, 6);
    assert.match(offline.unreadable!, /notice metadata/);
    assert.equal(offline.rows.find(row => row.subject === "applied")!.from, "engine");
    publishMailNoticeView(store, root);
    publishMailNoticeView(store, root);
    const recovered = readSocietyMail(root);
    assert.equal(recovered.unreadable, null);
    assert.equal(recovered.rows.length, 6);
    assert.equal(recovered.rows.find(row => row.subject === "applied")!.from, "OMA");
    assert.equal(unreadCount(inbox), 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Society mail bounds header reads and reports older mail; notice metadata fails explicitly", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-society-mail-bound-"));
  try {
    const dir = join(root, "mail", "archive", "cur");
    mkdirSync(dir, { recursive: true });
    for (let n = 0; n < 205; n++) {
      const id = `m-00000000-0000-4000-8000-${String(n).padStart(12, "0")}-0`;
      writeFileSync(join(dir, id + ":2,"), `From: worker-1@demo.oma.invalid\nSubject: ${n}\n\nbody`);
    }
    publishMailNoticeView({ integrationNoticeRequester: () => null }, root);
    const result = readSocietyMail(root);
    assert.equal(result.rows.length, 200);
    assert.equal(result.omitted, 5);
    assert.equal(result.unreadable, null);
    writeFileSync(mailNoticeViewPath(root), JSON.stringify({ schema: 1, messages: [{ id: result.rows[0]!.id, requester: "bad\nactor" }] }));
    const invalid = readSocietyMail(root);
    assert.equal(invalid.rows.length, 200);
    assert.match(invalid.unreadable!, /notice metadata/);
    assert.ok(invalid.rows.every(row => row.from === "worker-1"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
