import { createGitModule } from "#oma-test/app/broker/git-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
/** DR46/P0-7: actual SQLite/Git effects and SIGKILL; no systemd/provider claim. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "@oma/storage";
import { GitModule } from "@oma/git";
import { MailModule } from "@oma/mail";
import { makeValidAgent } from "./fixtures/spec.js";
import { gitAuth, gitCommand, seedGit, gitFixture, submitFixture } from "./fixtures/git-crash.js";
import { removeTree } from "./fixtures/cleanup.js";

for (const format of ["sha1", "sha256"] as const) for (const effect of ["compareAndSwap", "authorizeNoop"] as const)
  test(`DR46 witness kill: ${format} ${effect} survives restart, stop and policy change without repeating the effect`, { timeout: 30_000 }, async t => {
    const root = mkdtempSync(join(tmpdir(), "oma-witness-kill-"));
    t.after(() => removeTree(root));
    const path = join(root, "runtime.sqlite");
    const initial = new Store(path);
    let info: { base: string; candidate: string };
    try {
      initial.transaction(tx => { tx.insertAgent(makeValidAgent("a")); tx.insertAgent(makeValidAgent("b")); });
      seedGit(root, format);
      const fixture = gitFixture(root, initial);
      assert.equal((await submitFixture(root, fixture.git, "publish")).state, "succeeded");
      info = JSON.parse(readFileSync(join(root, "git-fixture.json"), "utf8"));
      if (effect === "authorizeNoop")
        assert.equal((await fixture.git.integrate(gitAuth, "advance", { expected: info.base, candidate: info.candidate })).state, "succeeded");
    } finally { initial.close(); }
    const input = { expected: effect === "authorizeNoop" ? info.candidate : info.base, candidate: info.candidate };
    const script = `
      import { Store } from ${JSON.stringify(import.meta.resolve("@oma/storage"))};
      import { gitFixture, gitAuth } from ${JSON.stringify(new URL("./fixtures/git-crash.js", import.meta.url).href)};
      const root = process.argv[1], store = new Store(root + '/runtime.sqlite');
      const { git } = gitFixture(root, store);
      const effects = Reflect.get(Reflect.get(git, 'integrationCoordinator'), 'effects');
      const original = effects[${JSON.stringify(effect)}].bind(effects);
      effects[${JSON.stringify(effect)}] = (...args) => {
        const result = original(...args);
        if (result.kind !== ${JSON.stringify(effect === "authorizeNoop" ? "present" : "candidate")})
          throw new Error('effect was not confirmed: ' + result.kind);
        process.kill(process.pid, 'SIGKILL');
        return result;
      };
      await git.integrate(gitAuth, 'fixed-intent', ${JSON.stringify(input)});
      process.exitCode = 99;
    `;
    const killed = spawnSync(process.execPath, ["--input-type=module", "-e", script, root], { encoding: "utf8", timeout: 15_000 });
    assert.equal(killed.signal, "SIGKILL", killed.stderr);
    const store = new Store(path);
    try {
      const accepted = store.getOperation("a", "fixed-intent")!;
      assert.equal(accepted.kind, "git.integrate");
      assert.equal(accepted.state, "pending");
      const bytes = accepted.planJson;
      if (accepted.kind !== "git.integrate") return assert.fail("wrong kind");
      assert.equal(accepted.plan.noopRef, effect === "authorizeNoop" ? `refs/oma/integrations/${accepted.id}` : null);
      const projectGit = join(root, "repos/project.git");
      let main = info.candidate;
      if (effect === "authorizeNoop") {
        const tree = gitCommand(root, ["--git-dir", projectGit, "rev-parse", `${info.candidate}^{tree}`]);
        main = gitCommand(root, ["-c", "user.name=Third", "-c", "user.email=third@invalid", "--git-dir", projectGit,
          "commit-tree", tree, "-p", info.candidate, "-m", "later main"]);
        gitCommand(root, ["--git-dir", projectGit, "update-ref", "refs/heads/main", main, info.candidate]);
      }
      store.transaction(tx => tx.updateAgent({ name: "a", desired: "stopped" }));
      const paths = { stateRoot: root, society: "crash", projectGit, contextGit: join(root, "repos/context.git"), worldDir: join(root, "world") };
      const mail = createMailModule(paths, store, 64);
      const git = createGitModule(paths, store, mail, { policyRevision: "changed", protectedPaths: ["/"], checks: [] },
        () => assert.fail("proven historical effect must settle before current policy I/O"));
      const effects = Reflect.get(Reflect.get(git, "integrationCoordinator"), "effects");
      Reflect.set(effects, "compareAndSwap", () => assert.fail("CAS repeated"));
      Reflect.set(effects, "authorizeNoop", () => assert.fail("no-op authorization repeated"));
      await git.reconcile(accepted.id);
      const settled = store.getOperation("a", "fixed-intent")!;
      assert.equal(settled.state, "succeeded");
      assert.equal(settled.planJson, bytes);
      assert.deepEqual(settled.result, { kind: "git.integrate", base: input.expected, candidate: input.candidate,
        target: "refs/heads/main", policyRevision: "crash-policy", changed: effect === "compareAndSwap" });
      await git.reconcile(accepted.id);
      assert.equal(store.getOperation("a", "fixed-intent")!.resultJson, settled.resultJson);
      assert.equal(gitCommand(root, ["--git-dir", projectGit, "rev-parse", "refs/heads/main"]), main);
      store.transaction(tx => tx.updateAgent({ name: "a", desired: "enabled" }));
      assert.deepEqual(await git.integrate(gitAuth, "fixed-intent", input), {
        operation: settled.id, state: "succeeded", result: settled.result,
      });
      assert.equal(store.getOperation("a", "fixed-intent")!.planJson, bytes);
    } finally { store.close(); }
  });

for (const format of ["sha1", "sha256"] as const)
  test(`DR46 context witness kill: ${format} authorization settles after restart and stop with frozen mail`, { timeout: 30_000 }, async t => {
    const root = mkdtempSync(join(tmpdir(), "oma-context-witness-kill-"));
    t.after(() => removeTree(root));
    const path = join(root, "runtime.sqlite"), initial = new Store(path);
    const bytes = Buffer.from("# GOAL\nverify crash recovery\n");
    const { sha256Hex } = await import("@oma/domain/canonical-json");
    const body = { entries: [{ path: "GOAL.md", bytes: bytes.length, sha256: sha256Hex(bytes) }],
      content: { bytes: bytes.length, sha256: sha256Hex(bytes), mediaType: "application/vnd.oma.context-v1" as const } };
    let revision: string;
    try {
      initial.transaction(tx => { tx.insertAgent(makeValidAgent("a")); tx.insertAgent(makeValidAgent("b")); });
      seedGit(root, format);
      const { git } = gitFixture(root, initial);
      const first = await git.publishContext(gitAuth, "initial", { expected: null, ...body }, (async function* () { yield bytes; })());
      assert.equal(first.state, "succeeded");
      assert.ok(first.result?.kind === "context.publish");
      revision = first.result.revision;
    } finally { initial.close(); }
    const input = { expected: revision, ...body };
    const script = `
      import { Store } from ${JSON.stringify(import.meta.resolve("@oma/storage"))};
      import { gitFixture, gitAuth } from ${JSON.stringify(new URL("./fixtures/git-crash.js", import.meta.url).href)};
      import { ContextPublicationObserver } from ${JSON.stringify(import.meta.resolve("@oma/git/context-publication"))};
      const root = process.argv[1], store = new Store(root + '/runtime.sqlite');
      const original = ContextPublicationObserver.prototype.authorizeNoop;
      ContextPublicationObserver.prototype.authorizeNoop = function (operation) {
        const confirmed = original.call(this, operation);
        if (!confirmed) throw new Error('context authorization was not confirmed');
        process.kill(process.pid, 'SIGKILL');
        return confirmed;
      };
      const { git } = gitFixture(root, store);
      const bytes = Buffer.from(${JSON.stringify(bytes.toString("utf8"))});
      await git.publishContext(gitAuth, 'fixed-context', ${JSON.stringify(input)}, (async function* () { yield bytes; })());
      process.exitCode = 99;
    `;
    const killed = spawnSync(process.execPath, ["--input-type=module", "-e", script, root], { encoding: "utf8", timeout: 15_000 });
    assert.equal(killed.signal, "SIGKILL", killed.stderr);
    const store = new Store(path);
    try {
      const accepted = store.getOperation("a", "fixed-context")!;
      assert.equal(accepted.kind, "context.publish");
      assert.equal(accepted.state, "pending");
      if (accepted.kind !== "context.publish") return assert.fail("wrong kind");
      assert.equal(accepted.plan.base, revision); assert.equal(accepted.plan.candidate, revision);
      assert.ok(accepted.plan.noopRef);
      const frozen = accepted.planJson;
      store.transaction(tx => tx.updateAgent({ name: "a", desired: "stopped" }));
      const { git } = gitFixture(root, store);
      const publication = Reflect.get(Reflect.get(git, "contextCoordinator"), "publication");
      Reflect.set(publication, "authorizeNoop", () => assert.fail("context authorization repeated"));
      await git.reconcile(accepted.id);
      const settled = store.getOperation("a", "fixed-context")!;
      assert.equal(settled.state, "succeeded"); assert.equal(settled.planJson, frozen);
      assert.ok(settled.result?.kind === "context.publish");
      assert.equal(settled.result.previous, revision); assert.equal(settled.result.revision, revision);
      assert.equal(settled.result.message, accepted.plan.message.id);
      await git.reconcile(accepted.id);
      assert.equal(store.getOperation("a", "fixed-context")!.resultJson, settled.resultJson);
      assert.equal(gitCommand(root, ["--git-dir", join(root, "repos/context.git"), "rev-parse", "refs/heads/main"]), revision);
      store.transaction(tx => tx.updateAgent({ name: "a", desired: "enabled" }));
      assert.deepEqual(await git.publishContext(gitAuth, "fixed-context", input, (async function* () { yield bytes; })()), {
        operation: settled.id, state: "succeeded", result: settled.result,
      });
    } finally { store.close(); }
  });
