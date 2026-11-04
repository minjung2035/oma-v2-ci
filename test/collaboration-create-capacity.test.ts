/** Two real accepted selected creates, one remaining enabled slot. Original
 * completion, workspace and Mail owners settle the race; no activation or
 * process-death/capacity inference is introduced. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentCreateInput, Receipt } from "@oma/contracts";
import { Store } from "@oma/storage";
import { ExecutionJournal } from "@oma/storage/execution-journal";
import { createRootId } from "@oma/domain/derived";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { nativeLifecycleExecution, type NativeLifecycleExecution } from "./fixtures/native-lifecycle-execution.js";
import { gitFixture, gitAuth, seedGit, gitCommand } from "./fixtures/git-crash.js";
import { ALL_CAPS, makeValidAgent, makeValidResolvedSpec, withWorkerCapacity } from "./fixtures/spec.js";
import { removeTree } from "./fixtures/cleanup.js";

test("001. Selected create capacity: accepted sibling stays pending across reopen without another name or enabled-slot eviction", { timeout: 30000 }, async t => {
  const root = fs.mkdtempSync(join(tmpdir(), "oma-create-capacity-"));
  let store: Store | undefined, units: NativeLifecycleExecution | undefined;
  let release: (() => void) | undefined, first: Promise<Receipt> | undefined;
  t.after(async () => {
    release?.(); await first?.catch(() => {});
    await units?.closeExecution(); store?.close(); removeTree(root);
  });
  seedGit(root);
  const base = gitCommand(root, ["--git-dir", join(root, "repos/project.git"), "rev-parse", "refs/heads/main"]);
  const capabilities = ALL_CAPS.filter(capability => capability !== "context.publish");
  store = new Store(join(root, "runtime.sqlite"));
  store.transaction(tx => tx.insertAgent(makeValidAgent("a", { from: base, brief: "Original parent", capabilities })));
  units = await nativeLifecycleExecution(store, root);
  let owner = new AbortController();
  let f = gitFixture(root, store, { ownerSignal: owner.signal, execution: units.executionOwner });
  const compose = (maximum: number) => createLifecycleModule(store!, units!, { ...f.paths,
    hasGoal: () => false, activationAllowed: () => false, ownerSignal: owner.signal },
    withWorkerCapacity((_parent, input) => makeValidResolvedSpec(input.name, "p", capabilities, input.from, input.brief), maximum), f.mail, f.git);
  let lifecycle = compose(2);
  const input = (name: string, key: string): AgentCreateInput => ({ name, from: base, brief: `\uFEFFIndependent ${name}\r\n`,
    collaboration: { version: "collaboration-v1", freeze: { version: "create-root-v1", operation: createRootId("a", key), dateMs: 1700000000000 } } });
  const firstInput = input("first", "first-create"), secondInput = input("second", "second-create");
  let entered!: () => void;
  const atPublication = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const complete = f.git.completeCreateSource.bind(f.git);
  f.git.completeCreateSource = async id => {
    await complete(id);
    if (id === firstInput.collaboration!.freeze.operation) { entered(); await gate; }
  };
  first = lifecycle.create(gitAuth, firstInput, "first-create");
  await Promise.race([atPublication, first.then(() => assert.fail("the original completion boundary was bypassed"))]);
  await assert.rejects(lifecycle.create(gitAuth, secondInput, "second-create"), error =>
    error !== null && typeof error === "object" && "code" in error && error.code === "BROKER_UNAVAILABLE");
  const firstAccepted = store.getOperation("a", "first-create"), secondAccepted = store.getOperation("a", "second-create");
  assert.ok(firstAccepted?.kind === "agent.create" && secondAccepted?.kind === "agent.create");
  assert.equal(firstAccepted.state, "pending"); assert.equal(secondAccepted.state, "pending");
  assert.equal(store.getAgent("first")?.desired, "provisioning"); assert.equal(store.getAgent("second")?.desired, "provisioning");
  assert.equal(lifecycle.creation(gitAuth).workerCount, 1);
  release!(); assert.equal((await first).state, "succeeded");
  assert.equal(store.getAgent("first")?.desired, "enabled");
  await lifecycle.reconcileCreate(secondAccepted.id, false);
  assert.equal(store.getOperation("a", "second-create")?.state, "pending");
  assert.equal(store.getAgent("second")?.desired, "provisioning");
  assert.equal(lifecycle.creation(gitAuth).workerCount, 2);
  assert.ok(secondAccepted.plan.initialMessage);
  let delivery = store.getDelivery(secondAccepted.plan.initialMessage.id, "second"); assert.ok(delivery);
  assert.equal(delivery.materialized, 0); assert.equal(delivery.presented, 0); assert.equal(delivery.acknowledged, 0);
  await assert.rejects(lifecycle.create(gitAuth, input("third", "third-create"), "third-create"), error =>
    error !== null && typeof error === "object" && "code" in error && error.code === "LIMIT_EXCEEDED");
  assert.equal(store.getOperation("a", "third-create"), null); assert.equal(store.getAgent("third"), null);
  assert.deepEqual(ExecutionJournal.inspect(root), []);
  owner.abort();
  await units.closeExecution(); units = undefined; store.close();
  store = new Store(join(root, "runtime.sqlite"));
  units = await nativeLifecycleExecution(store, root, { initialize: false });
  owner = new AbortController();
  f = gitFixture(root, store, { ownerSignal: owner.signal, execution: units.executionOwner });
  lifecycle = compose(2);
  await lifecycle.reconcileCreate(secondAccepted.id, false);
  assert.equal(store.getOperation("a", "second-create")?.state, "pending");
  assert.equal(store.getAgent("first")?.desired, "enabled");
  assert.equal(store.getAgent("second")?.desired, "provisioning");
  // Only an explicit host policy increase makes another enabled slot available.
  owner.abort(); await units.closeExecution(); units = undefined; store.close();
  store = new Store(join(root, "runtime.sqlite"));
  units = await nativeLifecycleExecution(store, root, { initialize: false });
  owner = new AbortController();
  f = gitFixture(root, store, { ownerSignal: owner.signal, execution: units.executionOwner });
  lifecycle = compose(3);
  await lifecycle.reconcileCreate(secondAccepted.id, false); await lifecycle.reconcileCreate(secondAccepted.id, false);
  const settled = store.getOperation("a", "second-create"); assert.ok(settled?.kind === "agent.create");
  assert.equal(settled.state, "succeeded"); assert.equal(settled.id, secondAccepted.id);
  assert.equal(settled.requestHash, secondAccepted.requestHash); assert.equal(settled.planJson, secondAccepted.planJson);
  assert.equal(store.acceptedOperationPage().items.length, 2);
  assert.equal(store.getAgent("first")?.incarnation, 0); assert.equal(store.getAgent("second")?.incarnation, 0);
  assert.equal(lifecycle.creation(gitAuth).workerCount, 3);
  assert.equal(gitCommand(join(root, "agents/second/workspace"), ["rev-parse", "HEAD"]), base);
  const brief = f.mail.readRecord("second", secondAccepted.plan.initialMessage.id); assert.equal(brief.state, "published");
  if (brief.state === "published") assert.equal(brief.record.body, secondInput.brief);
  delivery = store.getDelivery(secondAccepted.plan.initialMessage.id, "second"); assert.ok(delivery);
  assert.equal(delivery.materialized, 1); assert.equal(delivery.presented, 0); assert.equal(delivery.acknowledged, 0);
  assert.equal(gitCommand(root, ["--git-dir", join(root, "repos/project.git"), "rev-parse", "refs/heads/main"]), base);
  assert.deepEqual(ExecutionJournal.inspect(root), []);
});
