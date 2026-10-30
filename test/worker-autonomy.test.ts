import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
/** DR27/CREATE-002/P0: host seeds and Worker delegation are separate authorities.
 * Real ledger, mail and private Git clones; unit installation is scripted. */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthContext } from "@oma/contracts";
import { defaultHostConfig } from "@oma/config/defaults";
import { createChildSpecResolver } from "@oma/config/policy";
import { resolveChildSpec } from "@oma/domain/child-policy";
import { resolvedSpecOf } from "@oma/domain/agent-spec";
import { LifecycleModule } from "@oma/lifecycle";
import { MailModule } from "@oma/mail";
import { Store } from "@oma/storage";
import { PolicyExecution } from "./fixtures/execution.js";
import { provisionSociety } from "#oma-test/app/runtime/provision";
import { projectGitPathAt, workspacePathAt } from "@oma/domain/paths";
import { commitField, INITIAL_WORKERS, readSettings } from "#oma-test/app/application/settings";
import { makeValidAgent } from "./fixtures/spec.js";

class ScriptedUnits extends PolicyExecution {
  readonly started: string[] = [];
  override assertResidentNamesFree(): void {}
  override ensureResident(): void {}
  override start(name: string): void { this.started.push(name); }
}
function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "oma-autonomy-"));
  provisionSociety(root);
  let store = new Store(join(root, "runtime.sqlite"));
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const config = defaultHostConfig({ society: "demo", node: process.execPath, libdir: process.cwd(),  deploymentDigest: "a".repeat(64) });
  const path = join(root, "config.json"); writeFileSync(path, JSON.stringify(config));
  const units = new ScriptedUnits();
  const projectGit = projectGitPathAt(root);
  const from = execFileSync("/usr/bin/git", ["--git-dir", projectGit, "rev-parse", "main"], { encoding: "utf8" }).trim();
  const lifecycle = () => {
    const mail = createMailModule({ stateRoot: root, society: "demo" }, store, config.limits.addresses,
      config.limits.batchMaxMessages, config.limits);
    return createLifecycleModule(store, units, { stateRoot: root, projectGit, society: "demo", hasGoal: () => false, activationAllowed: () => true },
      createChildSpecResolver(() => config, () => store.inTransaction), mail);
  };
  const auth = (name: string): AuthContext => {
    const agent = store.getAgent(name)!;
    return { actor: name, incarnation: agent.incarnation, role: agent.role, channel: "actor",
      capabilities: new Set(resolvedSpecOf(agent).capabilities),
      peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } };
  };
  return { root, config, path, units, from, lifecycle, auth, get store() { return store; },
    reopen() { store.close(); store = new Store(join(root, "runtime.sqlite")); } };
}

test("DR27/AV18: the host seeds a capable Worker without Principal creation/delegation authority", async t => {
  const f = fixture(t), lifecycle = f.lifecycle();
  const principal = f.config.agentProfiles.principal!, resident = f.config.agentProfiles.resident!;
  assert.deepEqual(principal.capabilities, ["mail.send", "agent.manage.descendants", "context.publish"]);
  assert.deepEqual(principal.delegable, []); assert.equal(principal.childProfile, null);
  assert.equal(resolveChildSpec(f.config, { name: "principal", profile: "principal", capabilities: principal.capabilities },
    { name: "child", from: f.from, brief: "work" }), null);
  for (const profile of Object.values(f.config.agentProfiles))
    for (const cap of profile.delegable) assert.ok(profile.capabilities.includes(cap));
  await lifecycle.bootstrap(f.config);
  const accepted = f.store.getOperation("principal", "bootstrap-worker-1")!;
  assert.equal(accepted.kind, "agent.create"); assert.equal(accepted.state, "pending");
  assert.deepEqual(resolvedSpecOf(f.store.getAgent("worker-1")!).capabilities, [...resident.capabilities].sort());
  await lifecycle.reconcileCreate(accepted.id);
  assert.equal(f.store.getOperationById(accepted.id)!.state, "succeeded");
  assert.equal(f.store.getAgent("worker-1")!.createdBy, "principal");
  assert.deepEqual(f.units.started, [], "a seed activated before GOAL");
  assert.equal(f.store.pendingDeliveries("worker-1").length, 1);
  await assert.rejects(lifecycle.create(f.auth("principal"), { name: "forbidden", from: f.from, brief: "work" }, "principal-create"), { code: "CAPABILITY_DENIED" });
  assert.equal(f.store.getOperation("principal", "principal-create"), null);
});

test("DR27/CREATE-003: Workers delegate through multiple generations; retries and restart do not recreate them", async t => {
  const f = fixture(t); let lifecycle = f.lifecycle();
  await lifecycle.bootstrap(f.config);
  for (const seed of f.config.initialResidents)
    await lifecycle.reconcileCreate(f.store.getOperation("principal", `bootstrap-${seed.name}`)!.id);
  const input = { name: "peer", from: f.from, brief: "Inspect the code and collaborate." };
  const child = await lifecycle.create(f.auth("worker-1"), input, "peer");
  assert.equal(child.state, "succeeded");
  const peer = f.store.getAgent("peer")!;
  assert.equal(peer.createdBy, "worker-1");
  assert.deepEqual(resolvedSpecOf(peer).capabilities, resolvedSpecOf(f.store.getAgent("worker-1")!).capabilities);
  assert.ok(resolvedSpecOf(peer).capabilities.includes("git.submit"));
  assert.ok(resolvedSpecOf(peer).capabilities.includes("agent.create"));
  assert.ok(!resolvedSpecOf(peer).capabilities.includes("context.publish"));
  const grandchild = await lifecycle.create(f.auth("peer"), { name: "reviewer", from: f.from, brief: "Review independently." }, "reviewer");
  assert.equal(grandchild.state, "succeeded");
  assert.equal(f.store.getAgent("reviewer")!.createdBy, "peer");
  const work = join(workspacePathAt(f.root, "peer"), "work-in-progress"); writeFileSync(work, "preserve me");
  const before = f.store.listAgents();
  f.reopen(); lifecycle = f.lifecycle();
  f.config.initialResidents = [{ name: "not-a-reseed", profile: "resident", brief: "not a new task" }];
  await lifecycle.bootstrap(f.config);
  assert.deepEqual(f.store.listAgents(), before);
  assert.deepEqual(await lifecycle.create(f.auth("worker-1"), input, "peer"), child);
  assert.equal(readFileSync(work, "utf8"), "preserve me");
  assert.equal(f.store.pendingDeliveries("peer").length, 1);
});

test("DR27/P0: new default capabilities never widen a previously frozen Worker", async t => {
  const f = fixture(t), old = makeValidAgent("legacy", { profile: "resident", from: f.from,
    capabilities: ["mail.send", "route.follow", "git.submit", "agent.manage.self"] });
  f.store.transaction(tx => { tx.insertAgent(old); });
  const before = f.store.getAgent("legacy")!;
  await f.lifecycle().bootstrap(f.config);
  await assert.rejects(f.lifecycle().create(f.auth("legacy"), { name: "child", from: f.from, brief: "work" }, "child"), { code: "CAPABILITY_DENIED" });
  f.reopen();
  assert.deepEqual(f.store.getAgent("legacy"), before);
  assert.equal(f.store.getOperation("legacy", "child"), null);
});

test("DR27/CREATE-002: host delegation and current lease can narrow child capabilities", async t => {
  const f = fixture(t), lifecycle = f.lifecycle();
  await lifecycle.bootstrap(f.config);
  await lifecycle.reconcileCreate(f.store.getOperation("principal", "bootstrap-worker-1")!.id);
  f.config.agentProfiles.resident!.delegable = ["mail.send", "git.submit", "agent.create"];
  const auth = f.auth("worker-1");
  const narrow = { ...auth, capabilities: new Set([...auth.capabilities].filter(cap => cap !== "git.submit")) };
  assert.equal((await lifecycle.create(narrow, { name: "child", from: f.from, brief: "work" }, "narrow")).state, "succeeded");
  assert.deepEqual(resolvedSpecOf(f.store.getAgent("child")!).capabilities, ["agent.create", "mail.send"]);
});

test("DR46: successive Worker creations each retain their accepted identity", async t => {
  const f = fixture(t), lifecycle = f.lifecycle();
  await lifecycle.bootstrap(f.config);
  await lifecycle.reconcileCreate(f.store.getOperation("principal", "bootstrap-worker-1")!.id);
  assert.equal((await lifecycle.create(f.auth("worker-1"), { name: "first", from: f.from, brief: "work" }, "first")).state, "succeeded");
  assert.equal((await lifecycle.create(f.auth("worker-1"), { name: "excess", from: f.from, brief: "work" }, "excess")).state, "succeeded");
  assert.ok(f.store.getAgent("excess"));
  assert.equal(f.store.getOperation("worker-1", "excess")?.state, "succeeded");
});

test("DR27/CFG-002: initial Worker count persists with a non-delegating Principal and rejects zero", t => {
  const f = fixture(t), profiles = readSettings(f.path).config.agentProfiles;
  assert.throws(() => commitField(readSettings(f.path), INITIAL_WORKERS, 0, "pending"), /at least one/);
  for (const count of [1, 2, 3]) {
    assert.equal(commitField(readSettings(f.path), INITIAL_WORKERS, count, "pending").kind, "saved");
    const saved = readSettings(f.path).config;
    assert.equal(saved.initialResidents.length, count);
    assert.ok(saved.initialResidents.every(seed => seed.profile === "resident" && seed.brief.length > 0));
    assert.deepEqual(saved.agentProfiles, profiles);
  }
});

test("Worker capacity: provisioning does not occupy slots and accepted seeds recover after release", async t => {
  const f = fixture(t);
  f.config.maxWorkers = 4;
  const lifecycle = f.lifecycle();
  await lifecycle.bootstrap(f.config);
  assert.equal(lifecycle.creation(f.auth("principal")).workerCount, 0);
  await lifecycle.reconcileCreate(f.store.getOperation("principal", "bootstrap-worker-1")!.id);
  const auth = f.auth("worker-1");
  const inputs = ["last-a", "last-b", "last-c"].map(name => ({ name, from: f.from, brief: "Independent work" }));
  for (const input of inputs) assert.equal((await lifecycle.create(auth, input, input.name)).state, "succeeded");
  const waiting = f.store.getOperation("principal", "bootstrap-worker-2")!;
  await lifecycle.reconcileCreate(waiting.id);
  assert.equal(f.store.getAgent("worker-2")?.desired, "provisioning");
  assert.equal(lifecycle.creation(auth).workerCount, 4);
  await assert.rejects(lifecycle.create(auth, { name: "full", from: f.from, brief: "full" }, "full"), { code: "LIMIT_EXCEEDED" });
  assert.equal(f.store.getOperation("worker-1", "full"), null);
  f.store.transaction(tx => tx.updateAgent({ name: "last-a", desired: "stopped" }));
  await lifecycle.reconcileCreate(waiting.id);
  assert.equal(f.store.getAgent("worker-2")?.desired, "enabled");
  assert.equal((await lifecycle.create(auth, inputs[0]!, "last-a")).state, "succeeded");
  assert.equal((await lifecycle.create(auth, inputs[0]!, "linked-retry")).state, "succeeded");
  assert.equal(f.store.listAgents().filter(agent => agent.role === "resident").length, 6);
  assert.equal(lifecycle.creation(auth).workerCount, 4);
  assert.equal(lifecycle.creation(auth).maxWorkers, 4);
});

test("Worker capacity changes require restart and never remove existing Workers", async t => {
  const f = fixture(t), lifecycle = f.lifecycle();
  await lifecycle.bootstrap(f.config);
  for (const seed of f.config.initialResidents)
    await lifecycle.reconcileCreate(f.store.getOperation("principal", `bootstrap-${seed.name}`)!.id);
  const before = f.store.listAgents();
  f.config.maxWorkers = 2;
  f.config.initialResidents = [];
  const input = { name: "excess", from: f.from, brief: "No free slot" };
  await assert.rejects(lifecycle.create(f.auth("worker-1"), input, "before-restart"), { code: "POLICY_CHANGED" });
  await assert.rejects(f.lifecycle().create(f.auth("worker-1"), input, "after-restart"), { code: "UNSUPPORTED_PROFILE" });
  assert.deepEqual(f.store.listAgents(), before);
});


test("IMP-R09: host recovery seeds exactly one legacy zero-Resident Society", async t => {
  const f = fixture(t);
  f.store.transaction(tx => tx.insertAgent(makeValidAgent("principal", { profile: "principal", from: f.from,
    capabilities: [...f.config.agentProfiles.principal!.capabilities] })));
  const recovery = { ...f.config, firstWorkerRecovery: { version: 1 as const, key: "legacy-one", name: "recovered", profile: "resident", brief: "Recover this Society" } };
  const lifecycle = f.lifecycle();
  await Promise.all([lifecycle.bootstrap(recovery), lifecycle.bootstrap(recovery)]);
  assert.equal(f.store.listAgents().filter(agent => agent.role === "resident").length, 1);
  const operation = f.store.getOperation("principal", "recover-first-legacy-one")!;
  assert.equal(operation.state, "pending");
  f.reopen(); const resumed = f.lifecycle();
  await resumed.bootstrap(recovery); await resumed.reconcileCreate(operation.id);
  assert.equal(f.store.getOperationById(operation.id)!.state, "succeeded");
  assert.equal(f.store.pendingDeliveries("recovered").length, 1);
  await assert.rejects(resumed.create(f.auth("principal"), { name: "forbidden", from: f.from, brief: "work" }, "no"), { code: "CAPABILITY_DENIED" });
  f.store.transaction(tx => tx.updateAgent({ name: "recovered", desired: "stopped" }));
  await assert.rejects(resumed.bootstrap({ ...recovery, firstWorkerRecovery: { ...recovery.firstWorkerRecovery, key: "another", name: "second" } }), { code: "AGENT_CONFLICT" });
});
