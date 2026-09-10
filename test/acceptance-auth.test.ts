import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/store.js";
import { sha256Hex } from "../src/hash.js";
import { gitFixture, gitAuth, seedGit } from "./fixtures/git-crash.js";
import { lifecycleFixture } from "./fixtures/lifecycle-crash.js";
import { ALL_CAPS, resolvedSpec } from "./fixtures/spec.js";

for (const method of ["mail.send", "git.submit", "git.integrate", "context.publish", "agent.create"]) {
  test(`AUTH-003: ${method} rechecks authority after asynchronous preparation before acceptance`, async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-accept-auth-"));
    const store = new Store(join(root, "runtime.sqlite"));
    const lifecycle = lifecycleFixture(root, store);
    try {
      seedGit(root);
      store.transaction(() => { for (const name of ["a", "b"]) store.insertAgent({ name, role: "resident", profile: "p", desired: "enabled", incarnation: 1, specHash: "fixture", specJson: resolvedSpec(ALL_CAPS, "p", name), createdBy: null }); });
      const { git, mail } = gitFixture(root, store);
      const info = JSON.parse(readFileSync(join(root, "git-fixture.json"), "utf8"));
      const key = `${method}-race`;
      const revoke = () => store.transaction(() => {
        if (method === "context.publish") store.updateAgent({ name: "a", specJson: resolvedSpec([], "p", "a") });
        else if (method === "git.submit") store.updateAgent({ name: "a", desired: "stopped" });
        else store.updateAgent({ name: "a", incarnation: 2 });
      });
      let operation;
      if (method === "git.submit") {
        const body = readFileSync(join(root, "candidate.bundle"));
        operation = git.submit(gitAuth, key, { candidate: info.candidate, exportRef: info.exportRef, prerequisites: [info.base], to: ["b"], subject: "candidate", body: "body", paths: [], bundle: { bytes: body.length, sha256: sha256Hex(body), mediaType: "application/x-git-bundle" } }, (async function* () { yield body; revoke(); })());
      } else if (method === "context.publish") {
        const body = Buffer.from("# goal\n");
        operation = git.publishContext(gitAuth, key, { expected: null, entries: [{ path: "GOAL.md", bytes: body.length, sha256: sha256Hex(body) }], content: { bytes: body.length, sha256: sha256Hex(body), mediaType: "application/vnd.oma.context-v1" } }, (async function* () { yield body; revoke(); })());
      } else {
        operation = method === "mail.send" ? mail.send(gitAuth, key, { to: ["b"], subject: "mail", kind: "message", body: "body" })
          : method === "git.integrate" ? git.integrate(gitAuth, key, { candidate: info.candidate, expected: info.base })
          : lifecycle.lifecycle.create(gitAuth, { name: "child", from: info.base, brief: "brief" }, key);
        revoke();
      }
      await assert.rejects(operation, { code: method === "context.publish" ? "CAPABILITY_DENIED" : "STALE_RUN" });
      assert.equal(store.getOperation("a", key), null);
      assert.equal(store.getAgent("child"), null);
      assert.equal(store.pendingDeliveries("b").length, 0);
      if (method === "mail.send") {
        const continued = await mail.send({ ...gitAuth, incarnation: 2, capabilities: new Set(["mail.send"]) }, "continue-current",
          { to: ["a"], subject: "continue", kind: "message", body: "next" },
          { kind: "agent.continue", params: { note: "next" } });
        assert.equal(continued.state, "succeeded", "continue uses mail.send, not agent.manage.self");
      }
    } finally { if (method === "agent.create") lifecycle.cleanup(); store.close(); rmSync(root, { recursive: true, force: true }); }
  });
}

for (const method of ["mail.send", "git.submit"] as const) {
  test(`MAIL-001: ${method} snapshots acceptance-time membership and preserves a concurrent winner`, async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-route-accept-"));
    const store = new Store(join(root, "runtime.sqlite"));
    try {
      seedGit(root);
      store.transaction(() => {
        for (const name of ["a", "b", "c"]) store.insertAgent({ name, role: "resident", profile: "p", desired: "enabled", incarnation: 1, specHash: "fixture", specJson: resolvedSpec(ALL_CAPS, "p", name), createdBy: null });
        store.follow("news", "b");
      });
      const { git, mail } = gitFixture(root, store);
      const info = JSON.parse(readFileSync(join(root, "git-fixture.json"), "utf8"));
      const key = "route-race";
      const send = () => method === "mail.send"
        ? mail.send(gitAuth, key, { to: ["topic/news"], subject: "mail", kind: "message", body: "body" })
        : git.submit(gitAuth, key, { candidate: info.base, exportRef: info.exportRef, prerequisites: [], to: ["topic/news"], subject: "candidate", body: "body", paths: [] }, (async function* () {})());
      const effect = method === "mail.send" ? "materialize" : "publishGated";
      const publish = mail[effect].bind(mail);
      mail[effect] = async id => {
        // The first acceptance is committed; change membership before the loser retries.
        mail[effect] = publish;
        store.transaction(() => { store.unfollow("news", "c"); store.follow("news", "b"); });
        await publish(id);
      };
      const first = send();
      const second = send();
      store.transaction(() => { store.unfollow("news", "b"); store.follow("news", "c"); });
      const outcomes = await Promise.allSettled([first, second]);
      assert.ok(outcomes[0]?.status === "fulfilled");
      assert.ok(outcomes[1]?.status === "fulfilled");
      assert.equal(outcomes[0].value.operation, outcomes[1].value.operation);
      assert.deepEqual(store.subscribers("news"), ["b"]);
      const operation = store.getOperation("a", key)!;
      const plan = JSON.parse(operation.planJson);
      assert.deepEqual(plan.message.recipients, ["c"]);
      assert.equal(store.getDelivery(plan.message.id, "b"), null);
      assert.ok(store.getDelivery(plan.message.id, "c"));
      assert.equal((await send()).operation, operation.id);
      assert.equal(store.pendingDeliveries("c").length, 1);
    } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
  });
}
