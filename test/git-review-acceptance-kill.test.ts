/** Real projected root T, SQLite, frozen mail and SIGKILL. No power-loss claim. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fixture } from "./fixtures/review-fixture.js";

for (const feature of ["Git", "Review"] as const)
  test(`DR46 ${feature} ledger: SIGKILL after projected acceptance, retry and restart preserve intent`, { timeout: 45_000 }, async t => {
    const f = fixture(); t.after(() => f.close());
    const candidate = f.candidateWith({ "change.txt": "fixed candidate\n" });
    await f.submit("alice", candidate);
    const key = "projected-kill", input = feature === "Git"
      ? { candidate, exportRef: "refs/oma/export/kill", prerequisites: [], to: [], paths: [], subject: "candidate", body: "exact result" }
      : { kind: "merge.open", tier: "MEDIUM", title: "the change", reason: "review it", candidate, base: f.base };
    const paths = { stateRoot: f.root, projectGit: f.projectGit, contextGit: `${f.root}/context.git`,
      worldDir: `${f.root}/world`, society: "demo" };
    const code = `
      import { Store } from ${JSON.stringify(import.meta.resolve("@oma/storage"))};
      import { createMailModule } from ${JSON.stringify(new URL(import.meta.resolve("#oma-test/app/broker/mail-composition")).href)};
      import { createGitServices } from ${JSON.stringify(new URL(import.meta.resolve("#oma-test/app/broker/git-composition")).href)};
      const store = new Store(${JSON.stringify(f.root + "/runtime.sqlite")}, 0, { society: "demo" });
      const paths = ${JSON.stringify(paths)}, policy = ${JSON.stringify(f.policy)};
      const mail = createMailModule(paths, store, 64);
      const { git, reviews } = createGitServices(paths, store, mail, policy, () => policy);
      const original = store.transaction.bind(store);
      store.transaction = body => {
        const result = original(body);
        if (store.getOperation("alice", ${JSON.stringify(key)}) !== null) process.kill(process.pid, "SIGKILL");
        return result;
      };
      const auth = { ...${JSON.stringify(f.auth("alice"))}, capabilities: new Set(${JSON.stringify([...f.auth("alice").capabilities])}) };
      ${feature === "Git" ? `await git.submit(auth, ${JSON.stringify(key)}, ${JSON.stringify(input)}, (async function* () {})());`
        : `await reviews.record(auth, ${JSON.stringify(key)}, ${JSON.stringify(input)});`}
      process.exitCode = 99;
    `;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", timeout: 20_000 });
    assert.equal(child.signal, "SIGKILL", child.stderr);
    f.reopen();
    const accepted = f.store.getOperation("alice", key)!;
    assert.equal(accepted.state, "pending");
    assert.equal(accepted.kind, feature === "Git" ? "git.submit" : "attest.record");
    const planJson = accepted.planJson;
    const messages = "messages" in accepted.plan ? accepted.plan.messages : "message" in accepted.plan ? [accepted.plan.message] : [];
    assert.ok(messages.length > 0);
    const bytes = messages.map(message => readFileSync(f.mail.objectPath(message.id)));
    const retry = () => feature === "Git"
      ? f.module.submit(f.auth("alice"), key, input as Parameters<typeof f.module.submit>[2], (async function* () {})())
      : f.reviews.record(f.auth("alice"), key, input as Parameters<typeof f.reviews.record>[2]);
    assert.equal((await retry()).operation, accepted.id);
    if (feature === "Git") await f.module.reconcile(accepted.id);
    else await f.mail.reconcileOperation(accepted.id);
    const settled = f.store.getOperation("alice", key)!;
    assert.equal(settled.state, "succeeded");
    assert.equal(settled.planJson, planJson);
    f.reopen();
    assert.deepEqual(await retry(), { operation: settled.id, state: "succeeded", result: settled.result });
    assert.equal(f.store.getOperation("alice", key)!.planJson, planJson);
    for (const [index, message] of messages.entries()) assert.deepEqual(readFileSync(f.mail.objectPath(message.id)), bytes[index]);
  });
