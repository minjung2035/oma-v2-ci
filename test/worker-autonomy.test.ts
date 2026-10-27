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
  await lifecycle.reconcileCreate(f.store.getOperation("principal", "bootstrap-worker-1")!.id);
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

test("DR27/CFG-002: initial Worker count persists with a non-delegating Principal and accepts zero", t => {
  const f = fixture(t), profiles = readSettings(f.path).config.agentProfiles;
  for (const count of [3, 0, 2]) {
    assert.equal(commitField(readSettings(f.path), INITIAL_WORKERS, count, "pending").kind, "saved");
    const saved = readSettings(f.path).config;
    assert.equal(saved.initialResidents.length, count);
    assert.ok(saved.initialResidents.every(seed => seed.profile === "resident" && seed.brief.length > 0));
    assert.deepEqual(saved.agentProfiles, profiles);
  }
});
