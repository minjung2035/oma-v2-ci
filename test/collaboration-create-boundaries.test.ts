/** Accepted selected creation over original native quarantine, independent Git
 * workspaces, Lifecycle/ResidentRuntime and Mail. Real child SIGKILL and fresh
 * original-owner recovery; no Worker/Pi activation, peer-auth, power-loss or
 * macOS qualification is claimed. No fixture replaces a failed effect. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentCreateInput } from "@oma/contracts";
import type { GitRepository } from "@oma/git/repository";
import type { DecodedOperation } from "@oma/protocol/operation-codec";
import { Store } from "@oma/storage";
import { ExecutionJournal } from "@oma/storage/execution-journal";
import { createRootId, createSourceRequestKey, createSourcePublicationId, exportRefForRequestKey } from "@oma/domain/derived";
import { sha256Hex } from "@oma/domain/canonical-json";
import { isValidFullOid } from "@oma/domain/identifiers";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { nativeLifecycleExecution } from "./fixtures/native-lifecycle-execution.js";
import { gitFixture, gitAuth, seedGit, gitCommand } from "./fixtures/git-crash.js";
import { ALL_CAPS, makeValidAgent, makeValidResolvedSpec, withWorkerCapacity } from "./fixtures/spec.js";
import { removeTree } from "./fixtures/cleanup.js";

const childScript = `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { Store } from "@oma/storage";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { nativeLifecycleExecution } from ${JSON.stringify(new URL("./fixtures/native-lifecycle-execution.js", import.meta.url).href)};
import { gitFixture, gitAuth } from ${JSON.stringify(new URL("./fixtures/git-crash.js", import.meta.url).href)};
import { ALL_CAPS, makeValidResolvedSpec, withWorkerCapacity } from ${JSON.stringify(new URL("./fixtures/spec.js", import.meta.url).href)};
const [root, point] = process.argv.slice(1);
const { input, key } = JSON.parse(fs.readFileSync(join(root, "create-input.json"), "utf8"));
const store = new Store(join(root, "runtime.sqlite"));
const units = await nativeLifecycleExecution(store, root, { initialize: false });
const owner = new AbortController();
const f = gitFixture(root, store, { ownerSignal: owner.signal, execution: units.executionOwner });
const die = () => { fs.writeSync(1, point + "\\n"); process.kill(process.pid, "SIGKILL"); };
if (point === "source-cas") {
  const port = f.git.repository.submission, publish = port.publishRef;
  port.publishRef = (ref, oid) => { publish(ref, oid); die(); };
}
if (point === "workspace-publication") {
  const sync = fs.fsyncSync;
  fs.fsyncSync = fd => {
    const result = sync(fd), workspace = join(root, "agents", input.name, "workspace");
    if (fs.existsSync(join(workspace, ".git"))) {
      const parent = fs.statSync(join(root, "agents", input.name)), observed = fs.fstatSync(fd);
      if (parent.dev === observed.dev && parent.ino === observed.ino) die();
    }
    return result;
  };
  syncBuiltinESMExports();
}
if (point === "ready-commit") {
  const transaction = store.transaction.bind(store);
  store.transaction = body => {
    const result = transaction(body);
    if (store.getAgent(input.name)?.desired === "enabled") die();
    return result;
  };
}
if (point === "initial-mail") {
  const publish = f.mail.publishGated.bind(f.mail);
  f.mail.publishGated = async (...args) => { await publish(...args); die(); };
}
const lifecycle = createLifecycleModule(store, units, { ...f.paths,
  hasGoal: () => false, activationAllowed: () => false, ownerSignal: owner.signal },
  withWorkerCapacity((_parent, input) => makeValidResolvedSpec(input.name, "p", ALL_CAPS.filter(capability => capability !== "context.publish"), input.from, input.brief)), f.mail, f.git);
const bytes = fs.readFileSync(join(root, "create.bundle"));
await lifecycle.create(gitAuth, input, key, (async function* () { yield bytes; })());
throw new Error("the requested original creation boundary was not reached");
`;

for (const point of ["source-cas", "workspace-publication", "ready-commit", "initial-mail"] as const) {
  test(`001. Selected create: actual SIGKILL at ${point} retains one root, frozen source/spec and initial brief`, async t => {
    const root = fs.mkdtempSync(join(tmpdir(), "oma-create-boundary-"));
    let store: Store | undefined;
    t.after(() => { store?.close(); removeTree(root); });
    seedGit(root);
    const info: unknown = JSON.parse(fs.readFileSync(join(root, "git-fixture.json"), "utf8"));
    assert.ok(info !== null && typeof info === "object" && "candidate" in info && "base" in info && isValidFullOid(info.candidate) && isValidFullOid(info.base));
    const base = info.base;
    const key = "original-create", operation = createRootId(gitAuth.actor, key), exportRef = exportRefForRequestKey(createSourceRequestKey(key));
    gitCommand(join(root, "seed"), ["update-ref", exportRef, info.candidate]);
    gitCommand(join(root, "seed"), ["bundle", "create", join(root, "create.bundle"), exportRef, `^${info.base}`]);
    const bytes = fs.readFileSync(join(root, "create.bundle"));
    const brief = "\uFEFFOriginal independent task\r\nDo not infer completion.\r\n";
    const input: AgentCreateInput = { name: "child", from: info.candidate, brief,
      content: { bytes: bytes.length, sha256: sha256Hex(bytes), mediaType: "application/x-git-bundle" },
      collaboration: { version: "collaboration-v1", freeze: { version: "create-root-v1", operation, dateMs: 1700000000000 },
        stage: { exportRef, prerequisites: [info.base] } } };
    fs.writeFileSync(join(root, "create-input.json"), JSON.stringify({ key, input }));
    ExecutionJournal.initialize(root);
    store = new Store(join(root, "runtime.sqlite"));
    store.transaction(tx => tx.insertAgent(makeValidAgent("a", { from: base, capabilities: ALL_CAPS.filter(capability => capability !== "context.publish") })));
    store.close(); store = undefined;
    const child = spawnSync(process.execPath, ["--input-type=module", "--eval", childScript, root, point],
      { encoding: "utf8", timeout: 60000, maxBuffer: 1024 * 1024, killSignal: "SIGKILL" });
    assert.equal(child.error, undefined, child.stderr); assert.equal(child.status, null, child.stderr);
    assert.equal(child.signal, "SIGKILL", child.stderr); assert.equal(child.stdout, `${point}\n`, child.stderr);
    store = new Store(join(root, "runtime.sqlite"));
    store.bindRepositoryIdentity({ society: "crash" });
    const accepted = store.getOperation(gitAuth.actor, key);
    assert.ok(accepted?.kind === "agent.create"); assert.equal(accepted.id, operation); assert.equal(accepted.state, "pending");
    const original = { id: accepted.id, planJson: accepted.planJson, requestHash: accepted.requestHash };
    const source = accepted.plan.source?.publication;
    assert.ok(source?.local); assert.equal(source.local.dependency, createSourcePublicationId(operation));
    assert.equal(source.commit, info.candidate); assert.equal(source.publication, operation);
    const bundle = fs.readFileSync(source.local.bundle.path); assert.deepEqual(bundle, bytes);
    const message = accepted.plan.initialMessage; assert.ok(message);
    const delivery = store.getDelivery(message.id, input.name); assert.ok(delivery);
    assert.equal(delivery.presented, 0); assert.equal(delivery.acknowledged, 0);
    assert.equal(delivery.materialized, point === "initial-mail" ? 1 : 0);
    assert.equal(store.getAgent(input.name)?.desired, point === "ready-commit" || point === "initial-mail" ? "enabled" : "provisioning");
    assert.deepEqual(ExecutionJournal.inspect(root), [], "original quarantine scopes settled before these kill boundaries; no Worker activation occurred");
    store.transaction(tx => tx.updateAgent({ name: "a", desired: "retired" }));
    let publications = 0;
    for (let restart = 0; restart < 2; restart++) {
      const units = await nativeLifecycleExecution(store, root, { initialize: false });
      try {
        const owner = new AbortController(), f = gitFixture(root, store, { ownerSignal: owner.signal, execution: units.executionOwner });
        const repository = Reflect.get(f.git, "repository") as { submission: GitRepository["submission"] };
        const publish = repository.submission.publishRef;
        repository.submission.publishRef = (ref, oid) => { publications++; publish(ref, oid); };
        const lifecycle = createLifecycleModule(store, units, { ...f.paths, hasGoal: () => false,
          activationAllowed: () => false, ownerSignal: owner.signal },
          withWorkerCapacity((_parent, value) => makeValidResolvedSpec(value.name, "p", ALL_CAPS.filter(capability => capability !== "context.publish"), value.from, value.brief)), f.mail, f.git);
        if (restart === 0) {
          owner.abort();
          await assert.rejects(lifecycle.reconcileCreate(operation, false), error =>
            error !== null && typeof error === "object" && "code" in error && error.code === "BROKER_UNAVAILABLE");
          assert.deepEqual(store.getDelivery(message.id, input.name), delivery, "accepted delegation cannot authorize a stale broker tenure");
          assert.equal(store.getOperation(gitAuth.actor, key)?.state, "pending");
          const currentOwner = new AbortController();
          const current = gitFixture(root, store, { ownerSignal: currentOwner.signal, execution: units.executionOwner });
          const currentRepository = Reflect.get(current.git, "repository") as { submission: GitRepository["submission"] };
          const currentPublish = currentRepository.submission.publishRef;
          currentRepository.submission.publishRef = (ref, oid) => { publications++; currentPublish(ref, oid); };
          const recovery = createLifecycleModule(store, units, { ...current.paths, hasGoal: () => false,
            activationAllowed: () => false, ownerSignal: currentOwner.signal },
            withWorkerCapacity((_parent, value) => makeValidResolvedSpec(value.name, "p", ALL_CAPS.filter(capability => capability !== "context.publish"), value.from, value.brief)), current.mail, current.git);
          await recovery.reconcileCreate(operation, false);
        }
        assert.equal((await lifecycle.create(gitAuth, input, key)).operation, operation, "same-key replay observes acceptance without rebuilding its source");
        await lifecycle.reconcileCreate(operation, false);
        const completed: DecodedOperation | null = store.getOperation(gitAuth.actor, key); assert.equal(completed?.state, "succeeded");
        assert.deepEqual({ id: completed?.id, planJson: completed?.planJson, requestHash: completed?.requestHash }, original);
        assert.deepEqual(fs.readFileSync(source.local.bundle.path), bundle);
        assert.equal(gitCommand(join(root, "agents/child/workspace"), ["rev-parse", "HEAD"]), info.candidate);
        assert.equal(gitCommand(root, ["--git-dir", join(root, "repos/project.git"), "rev-parse", source.publishedRef]), info.candidate);
        assert.equal(gitCommand(root, ["--git-dir", join(root, "repos/project.git"), "rev-parse", "refs/heads/main"]), info.base);
        const observed = f.mail.readRecord(input.name, message.id); assert.equal(observed.state, "published");
        if (observed.state === "published") assert.equal(observed.record.body, brief);
        assert.equal(sha256Hex(fs.readFileSync(f.mail.objectPath(message.id))), message.sha256);
        const current = store.getDelivery(message.id, input.name); assert.ok(current);
        assert.deepEqual({ ...current, materialized: delivery.materialized, materializedAtMs: delivery.materializedAtMs }, delivery);
        assert.equal(current.materialized, 1);
        assert.equal(store.getAgent(input.name)?.incarnation, 0); assert.equal(store.getAgent(input.name)?.desired, "enabled");
        assert.equal(store.acceptedOperationPage().items.length, 1, "no independent submit, replacement create, activation or ACK is accepted");
        assert.deepEqual(ExecutionJournal.inspect(root), []);
      } finally { await units.closeExecution(); }
      store.close(); store = new Store(join(root, "runtime.sqlite"));
    }
    assert.equal(publications, 0, "the observed accepted source CAS is never replaced");
  });
}

test("002. Selected create: full enabled capacity refuses before source ingress or any accepted publication", async t => {
  const root = fs.mkdtempSync(join(tmpdir(), "oma-create-capacity-"));
  const store = new Store(join(root, "runtime.sqlite"));
  let units: Awaited<ReturnType<typeof nativeLifecycleExecution>> | undefined;
  t.after(async () => { try { await units?.closeExecution(); } finally { store.close(); removeTree(root); } });
  seedGit(root);
  const base = gitCommand(root, ["--git-dir", join(root, "repos/project.git"), "rev-parse", "refs/heads/main"]);
  const candidate = gitCommand(join(root, "seed"), ["rev-parse", "HEAD"]);
  const capabilities = ALL_CAPS.filter(capability => capability !== "context.publish");
  store.transaction(tx => tx.insertAgent(makeValidAgent("a", { from: base, capabilities })));
  units = await nativeLifecycleExecution(store, root);
  const owner = new AbortController(), f = gitFixture(root, store, { ownerSignal: owner.signal, execution: units.executionOwner });
  const lifecycle = createLifecycleModule(store, units, { ...f.paths, hasGoal: () => false,
    activationAllowed: () => false, ownerSignal: owner.signal },
    withWorkerCapacity((_parent, value) => makeValidResolvedSpec(value.name, "p", capabilities, value.from, value.brief), 1), f.mail, f.git);
  assert.equal(lifecycle.creation(gitAuth).workerCount, 1);
  const key = "capacity-refused", operation = createRootId(gitAuth.actor, key), exportRef = exportRefForRequestKey(createSourceRequestKey(key));
  gitCommand(join(root, "seed"), ["update-ref", exportRef, candidate]);
  gitCommand(join(root, "seed"), ["bundle", "create", join(root, "create.bundle"), exportRef, `^${base}`]);
  const bytes = fs.readFileSync(join(root, "create.bundle"));
  const input: AgentCreateInput = { name: "child", from: candidate, brief: "Independent task",
    content: { bytes: bytes.length, sha256: sha256Hex(bytes), mediaType: "application/x-git-bundle" },
    collaboration: { version: "collaboration-v1", freeze: { version: "create-root-v1", operation, dateMs: 1700000000000 },
      stage: { exportRef, prerequisites: [base] } } };
  let ingress = false;
  await assert.rejects(lifecycle.create(gitAuth, input, key, (async function* () { ingress = true; yield bytes; })()), error =>
    error !== null && typeof error === "object" && "code" in error && error.code === "LIMIT_EXCEEDED");
  assert.equal(ingress, false); assert.equal(store.getAgent("child"), null);
  assert.equal(store.getOperation(gitAuth.actor, key), null); assert.equal(store.acceptedOperationPage().items.length, 0);
  assert.equal(fs.existsSync(join(root, "agents/child")), false);
  assert.deepEqual(ExecutionJournal.inspect(root), []);
  assert.equal(gitCommand(root, ["--git-dir", join(root, "repos/project.git"), "rev-parse", "refs/heads/main"]), base);
});
