import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "@oma/storage";
import { sha256Hex } from "@oma/domain/canonical-json";
import { LifecycleModule } from "@oma/lifecycle";
import { PolicyExecution } from "./fixtures/execution.js";
import { gitFixture, gitAuth, seedGit } from "./fixtures/git-crash.js";
import { ALL_CAPS, makeValidAgent, makeValidResolvedSpec } from "./fixtures/spec.js";

for (const method of ["mail.send", "git.submit", "git.integrate", "context.publish", "agent.create"]) {
  test(`AUTH-003: ${method} rechecks authority after asynchronous preparation before acceptance`, async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-accept-auth-"));
    const store = new Store(join(root, "runtime.sqlite"));
    try {
      seedGit(root);
      const info = JSON.parse(readFileSync(join(root, "git-fixture.json"), "utf8"));
      store.transaction(tx => {
        tx.insertAgent(makeValidAgent("principal", { from: info.base }));
        for (const name of ["a", "b"]) tx.insertAgent(makeValidAgent(name, { from: info.base, createdBy: "principal" }));
      });
      const { git, mail, paths } = gitFixture(root, store);
      // This is a preaccept authority test, not a systemd fixture. Every module
      // uses the same immutable society identity; no real unit is installed.
      const units = new PolicyExecution();
      const lifecycle = createLifecycleModule(store, units,
        { stateRoot: root, projectGit: paths.projectGit, society: paths.society, hasGoal: () => false, activationAllowed: () => true },
        (_parent, input) => makeValidResolvedSpec(input.name, "p", ALL_CAPS, input.from, input.brief), mail);
      const auth = { ...gitAuth, capabilities: new Set(ALL_CAPS) };
      const key = `${method}-race`;
      const revoke = () => {
        // Frozen spec bytes/hash are immutable: corrupting only specJson would
        // test STORE_CORRUPT instead of current live-lease authorization.
        if (method === "context.publish") auth.capabilities.delete("context.publish");
        else store.transaction(tx => {
          if (method === "git.submit") tx.updateAgent({ name: "a", desired: "stopped" });
          else tx.updateAgent({ name: "a", incarnation: 2 });
        });
      };
      let operation;
      if (method === "git.submit") {
        const body = readFileSync(join(root, "candidate.bundle"));
        operation = git.submit(auth, key, { candidate: info.candidate, exportRef: info.exportRef, prerequisites: [info.base], to: ["b"], subject: "candidate", body: "body", paths: [], bundle: { bytes: body.length, sha256: sha256Hex(body), mediaType: "application/x-git-bundle" } }, (async function* () { yield body; revoke(); })());
      } else if (method === "context.publish") {
        const body = Buffer.from("# goal\n");
        operation = git.publishContext(auth, key, { expected: null, entries: [{ path: "GOAL.md", bytes: body.length, sha256: sha256Hex(body) }], content: { bytes: body.length, sha256: sha256Hex(body), mediaType: "application/vnd.oma.context-v1" } }, (async function* () { yield body; revoke(); })());
      } else {
        operation = method === "mail.send" ? mail.send(auth, key, { to: ["b"], subject: "mail", kind: "message", body: "body" })
          : method === "git.integrate" ? git.integrate(auth, key, { candidate: info.candidate, expected: info.base })
          : lifecycle.create(auth, { name: "child", from: info.base, brief: "brief" }, key);
        revoke();
      }
      await assert.rejects(operation, { code: method === "context.publish" ? "CAPABILITY_DENIED" : "STALE_RUN" });
      assert.equal(store.getOperation("a", key), null);
      assert.equal(store.getAgent("child"), null);
      assert.equal(store.pendingDeliveries("b").length, 0);
      if (method === "mail.send") {
        const continued = await mail.send({ ...auth, incarnation: 2, capabilities: new Set(["mail.send"]) }, "continue-current",
          { to: ["a"], subject: "continue", kind: "message", body: "next" },
          { kind: "agent.continue", params: { note: "next" } });
        assert.equal(continued.state, "succeeded", "continue uses mail.send, not agent.manage.self");
      }
    } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
  });
}

for (const method of ["mail.send", "git.submit"] as const) {
  test(`MAIL-001: ${method} snapshots acceptance-time membership and preserves a concurrent winner`, async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-route-accept-"));
    const store = new Store(join(root, "runtime.sqlite"));
    try {
      seedGit(root);
      const info = JSON.parse(readFileSync(join(root, "git-fixture.json"), "utf8"));
      store.transaction(tx => {
        tx.insertAgent(makeValidAgent("principal", { from: info.base }));
        for (const name of ["a", "b", "c"]) tx.insertAgent(makeValidAgent(name, { from: info.base, createdBy: "principal" }));
        tx.follow("news", "b");
      });
      const { git, mail } = gitFixture(root, store);
      const key = "route-race";
      const send = () => method === "mail.send"
        ? mail.send(gitAuth, key, { to: ["topic/news"], subject: "mail", kind: "message", body: "body" })
        : git.submit(gitAuth, key, { candidate: info.base, exportRef: info.exportRef, prerequisites: [], to: ["topic/news"], subject: "candidate", body: "body", paths: [] }, (async function* () {})());
      const changeMembershipAfterAcceptance = () => store.transaction(tx => { tx.unfollow("news", "c"); tx.follow("news", "b"); });
      if (method === "mail.send") {
        const publish = mail.materialize.bind(mail);
        mail.materialize = async (...args: Parameters<typeof mail.materialize>) => {
          mail.materialize = publish; changeMembershipAfterAcceptance(); return publish(...args);
        };
      } else {
        const publish = mail.publishGated.bind(mail);
        mail.publishGated = async (...args: Parameters<typeof mail.publishGated>) => {
          // Preserve the actual publication evidence argument, not just its ID.
          mail.publishGated = publish; changeMembershipAfterAcceptance(); return publish(...args);
        };
      }
      const first = send(); const second = send();
      store.transaction(tx => { tx.unfollow("news", "b"); tx.follow("news", "c"); });
      const outcomes = await Promise.allSettled([first, second]);
      assert.ok(outcomes[0]?.status === "fulfilled"); assert.ok(outcomes[1]?.status === "fulfilled");
      assert.equal(outcomes[0].value.operation, outcomes[1].value.operation);
      assert.deepEqual(store.subscribers("news"), ["b"]);
      const operation = store.getOperation("a", key);
      assert.ok(operation && (operation.kind === "mail.send" || operation.kind === "git.submit"));
      assert.deepEqual(operation.plan.message.recipients, ["c"]);
      assert.equal(store.getDelivery(operation.plan.message.id, "b"), null);
      assert.ok(store.getDelivery(operation.plan.message.id, "c"));
      assert.equal((await send()).operation, operation.id);
      assert.equal(store.pendingDeliveries("c").length, 1);
    } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
  });
}
