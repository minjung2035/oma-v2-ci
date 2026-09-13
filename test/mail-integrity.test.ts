import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, linkSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { Store, StoreError } from "../src/store.js";
import * as productionMail from "../src/mail.js";
import { gitFixture, gitAuth, seedGit } from "./fixtures/git-crash.js";
import { ALL_CAPS, resolvedSpec, storedSpec } from "./fixtures/spec.js";
import { sendWithStop } from "./fixtures/mail-faults.js";
import { overwritePublished, removeTree } from "./fixtures/cleanup.js";
import { corruptOperationForTest } from "./fixtures/corruption.js";

for (const gated of [false, true]) {
  test(`MAIL-007/008: ${gated ? "gated" : "ordinary"} publication verifies source, existing destinations and frozen metadata`, async () => {
    for (const fault of ["source", "new", "cur", "symlink", "dangling", "plan"]) {
      const root = mkdtempSync(join(tmpdir(), "oma-mail-integrity-"));
      const store = new Store(join(root, "runtime.sqlite"));
      try {
        store.transaction(() => {
          for (const name of ["a", "b"]) store.insertAgent({ name, role: "resident", profile: "p", desired: "enabled", incarnation: 1, ...storedSpec(ALL_CAPS, "p", name), createdBy: null });
        });
        const { mail, git } = gitFixture(root, store);
        assert.equal(Object.hasOwn(productionMail, "StopSignal"), false, "COMP-006: no production fault-signal export");
        assert.equal("stopAfter" in mail, false, "COMP-006: no production stop-point field");
        const publish = gated ? mail.publishGated.bind(mail) : mail.materialize.bind(mail);
        if (gated) {
          seedGit(root);
          const info = JSON.parse(readFileSync(join(root, "git-fixture.json"), "utf8"));
          mail.publishGated = async () => { throw new Error("publication paused"); };
          // The coordinator reports the closed coordinator-level failure; the
          // oracle is that publication never completes as a success.
          await assert.rejects(git.submit(gitAuth, "original", { candidate: info.base, exportRef: info.exportRef, prerequisites: [], to: ["b"], subject: "candidate", body: "body", paths: [] }, (async function* () {})()),
            (error: unknown) => error instanceof StoreError && /submit effect or observation failed/.test(error.message));
        } else {
          await assert.rejects(sendWithStop(mail, store, gitAuth, "original", { to: ["b"], subject: "original", kind: "message", body: "body" }, "accepted"));
        }
        const operation = store.getOperation("a", "original")!;
        const plan = JSON.parse(operation.planJson);
        const id = plan.message.id;
        const object = mail.objectPath(id);
        const bad = Buffer.from(readFileSync(object));
        bad[0] = bad[0]! ^ 1;
        const target = fault === "new" ? mail.inboxNewPath("b", id) : mail.inboxCurPath("b", id);
        mkdirSync(dirname(target), { recursive: true });
        if (fault === "plan") {
          // Accepted plan bytes are immutable through the Store API, so this
          // boundary violation uses the explicit raw corruption fixture.
          delete plan.message.sha256;
          corruptOperationForTest(join(root, "runtime.sqlite"), operation.id, "plan_json", JSON.stringify(plan));
        } else if (fault === "source") overwritePublished(object, bad);
        else if (fault === "symlink" || fault === "dangling") symlinkSync(fault === "symlink" ? object : join(root, "missing"), target);
        else writeFileSync(target, bad);
        await assert.rejects(publish(operation.id), { code: "STORE_CORRUPT" });
        if (fault === "plan") {
          // Corrupt accepted bytes stay unreadable: no delivery state is reported.
          assert.throws(() => store.getDelivery(id, "b"),
            (error: unknown) => error instanceof StoreError && error.code === "STORE_CORRUPT");
        } else assert.equal(store.getDelivery(id, "b")!.materialized, 0, fault);
      } finally { store.close(); removeTree(root); }
    }
  });
}

test("MAIL-005/008: replies and batch preparation reject corrupt originals; duplicate hardlinks drain", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-mail-original-"));
  const store = new Store(join(root, "runtime.sqlite"));
  try {
    store.transaction(() => {
      for (const name of ["a", "b"]) store.insertAgent({ name, role: "resident", profile: "p", desired: "enabled", incarnation: 1, ...storedSpec(ALL_CAPS, "p", name), createdBy: null });
    });
    const { mail } = gitFixture(root, store);
    await mail.send(gitAuth, "original", { to: ["b"], subject: "original", kind: "message", body: "body" });
    const plan = JSON.parse(store.getOperation("a", "original")!.planJson);
    const id = plan.message.id;
    const object = mail.objectPath(id);
    const original = readFileSync(object);
    const corrupt = Buffer.from(original); corrupt[corrupt.length - 1] = corrupt[corrupt.length - 1]! ^ 1;
    overwritePublished(object, corrupt);
    await assert.rejects(mail.send(gitAuth, "reply", { to: ["b"], subject: "reply", kind: "message", body: "body", replyToMessage: id }), { code: "STORE_CORRUPT" });
    await assert.rejects(mail.prepare({ ...gitAuth, actor: "b" }), { code: "STORE_CORRUPT" });
    assert.equal(store.getOperation("a", "reply"), null);
    assert.equal(store.preparedBatches("b").length, 0);
    overwritePublished(object, original);
    const current = mail.inboxCurPath("b", id);
    mkdirSync(dirname(current), { recursive: true });
    linkSync(object, current);
    mail.moveToCur("b", [id]);
    assert.equal(existsSync(mail.inboxNewPath("b", id)), false);
    assert.deepEqual(readFileSync(current), original);
  } finally { store.close(); removeTree(root); }
});
