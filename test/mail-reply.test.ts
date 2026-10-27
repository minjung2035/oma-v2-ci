import { createMailModule } from "#oma-test/app/broker/mail-composition";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@oma/storage";
import { MailModule, buildEml, parseEmlHeaders } from "@oma/mail";
import { gitFixture, gitAuth, seedGit } from "./fixtures/git-crash.js";
import { ALL_CAPS, resolvedSpec, storedSpec } from "./fixtures/spec.js";

test("MAIL-004/005: direct replies return to sender, list replies retain lists, and aliases are encoded", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-reply-"));
  const store = new Store(join(root, "runtime.sqlite"));
  try {
    store.transaction(() => {
      for (const name of ["a", "b", "principal"]) store.insertAgent({ name, role: name === "principal" ? "principal" : "resident", profile: "p", desired: "enabled", incarnation: 1, ...storedSpec(ALL_CAPS, "p", name), createdBy: null });
      store.follow("news", "b");
    });
    const { mail, git } = gitFixture(root, store);
    const message = (actor: string, key: string) => JSON.parse(store.getOperation(actor, key)!.planJson).intent.message;
    const headers = (actor: string, key: string) => parseEmlHeaders(readFileSync(mail.objectPath(message(actor, key).id), "utf8"));
    await mail.send(gitAuth, "direct", { to: ["b"], subject: "direct", kind: "message", body: "body" });
    assert.deepEqual(headers("a", "direct").replyTo, ["a@crash.oma.invalid"]);
    await mail.send({ ...gitAuth, actor: "b" }, "reply", { to: [], replyToMessage: message("a", "direct").id, subject: "reply", kind: "message", body: "body" });
    assert.deepEqual(message("b", "reply").recipients, ["a"]);
    assert.deepEqual(headers("b", "reply").replyTo, ["b@crash.oma.invalid"]);
    await mail.send(gitAuth, "reply-again", { to: [], replyToMessage: message("b", "reply").id, subject: "again", kind: "message", body: "body" });
    assert.deepEqual(message("a", "reply-again").recipients, ["b"]);
    for (const alias of ["commons", "residents", "principal"]) {
      await mail.send(gitAuth, alias, { to: [alias], subject: alias, kind: "message", body: "body" });
      assert.deepEqual(message("a", alias).to, [alias]);
      assert.match(readFileSync(mail.objectPath(message("a", alias).id), "utf8"), new RegExp(`To: ${alias}@crash\\.oma\\.invalid`));
    }
    await mail.send(gitAuth, "lists", { to: ["b", "commons", "topic/news"], subject: "lists", kind: "message", body: "body" });
    assert.deepEqual(headers("a", "lists").replyTo, ["commons@crash.oma.invalid", "topic-news@crash.oma.invalid"]);
    await mail.send({ ...gitAuth, actor: "b" }, "list-reply", { to: [], replyToMessage: message("a", "lists").id, subject: "reply", kind: "message", body: "body" });
    assert.deepEqual(message("b", "list-reply").to, ["commons", "topic/news"]);
    seedGit(root);
    const info = JSON.parse(readFileSync(join(root, "git-fixture.json"), "utf8"));
    await git.submit(gitAuth, "candidate", { candidate: info.base, exportRef: info.exportRef, prerequisites: [], to: ["commons"], subject: "candidate", body: "body", paths: [] }, (async function* () {})());
    assert.deepEqual(headers("a", "candidate").replyTo, ["commons@crash.oma.invalid"]);
    const limited = createMailModule({ stateRoot: root, society: "crash" }, store, 3);
    const ids = [message("a", "direct").id];
    for (let index = 0; index < 5; index++) {
      await limited.send(gitAuth, `chain-${index}`, { to: [], replyToMessage: ids.at(-1), subject: "chain", kind: "message", body: "body" });
      ids.push(message("a", `chain-${index}`).id);
    }
    assert.deepEqual(headers("a", "chain-4").references, [ids[0], ...ids.slice(-3, -1)].map(id => `${id}@crash.oma.invalid`));
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("MAIL-003: every generated header input rejects CR/LF injection", async () => {
  const valid = { from: "a@example.invalid", to: ["b@example.invalid"], replyTo: [], subject: "s", kind: "message" as const, contextRevision: null, inReplyTo: null, references: [], messageId: "id@example.invalid", body: "body" };
  for (const patch of [
    { from: "a@example.invalid\r\nBcc: injected@example.invalid" },
    { messageId: "id\r\nBcc: injected@example.invalid" },
    { inReplyTo: "id\r\nBcc: injected@example.invalid" },
    { references: ["id\r\nBcc: injected@example.invalid"] },
  ]) await assert.rejects(buildEml({ ...valid, ...patch }), { code: "INVALID_REQUEST" });
});