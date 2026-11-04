/** Current child-policy admission and original accepted-fact preservation.
 * Lifecycle/Store/Mail/Git are actual owners; execution ports are controlled.
 * No authenticated Worker, native death, original-release drain or provider proof. */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import type { AgentCreateInput, HostConfig } from "@oma/contracts";
import { defaultHostConfig } from "@oma/config/defaults";
import { createChildSpecResolver, type RefreshingSpecResolver } from "@oma/config/policy";
import { StoreError } from "@oma/domain/errors";
import { createRootId } from "@oma/domain/derived";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import { lifecycleReplayFixture } from "./fixtures/lifecycle-replay.js";
import { activeCapacityFixture } from "./fixtures/active-worker-capacity.js";
import { seedGit, gitCommand } from "./fixtures/git-crash.js";
import { createGitModule } from "#oma-test/app/broker/git-composition";

function config(context: boolean): HostConfig {
  const cfg = defaultHostConfig({ society: "demo", node: process.execPath, libdir: process.cwd(), deploymentDigest: "a".repeat(64) });
  cfg.agentProfiles.p = { modelProfile: "default", capabilities: ["agent.create", "context.publish", "mail.send"],
    delegable: ["context.publish", "mail.send"], childProfile: "child" };
  cfg.agentProfiles.child = { modelProfile: "default", capabilities: context
    ? ["code.integrate", "context.publish", "mail.send"] : ["code.integrate", "mail.send"], delegable: [], childProfile: null };
  return cfg;
}
const parent = { name: "manager", profile: "p", capabilities: ["agent.create", "context.publish", "mail.send"] as const };
const input = { name: "child", from: "a".repeat(40), brief: "\uFEFFOriginal child assignment\r\n" };
const unsupported = (error: unknown): boolean => error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE" &&
  /special canonical-context publication/.test(error.message);

/** Explicit extra argument is hostile fixture data, not a retained product API. */
function resolver(read: () => HostConfig, inTransaction: () => boolean, retired: boolean): RefreshingSpecResolver {
  return retired ? Reflect.apply(createChildSpecResolver, undefined, [read, inTransaction, "legacy"])
    : createChildSpecResolver(read, inTransaction);
}

for (const retired of [false, true]) for (const action of ["resolve", "observe"] as const) {
  test(`001. Child policy: ${retired ? "retired selector" : "omission"} cannot bypass current ${action} profile admission`, () => {
    const cfg = config(true), original = JSON.stringify({ cfg, parent, input });
    let reads = 0, inTransaction = false;
    const selected = resolver(() => { reads++; return cfg; }, () => inTransaction, retired);
    assert.equal(reads, 1);
    inTransaction = true;
    assert.throws(() => action === "resolve" ? selected(parent, input) : selected.observe(parent), unsupported);
    assert.equal(reads, 1, "pure validation cannot introduce a host read inside a transaction");
    assert.equal(JSON.stringify({ cfg, parent, input }), original, "refusal cannot rewrite capabilities or original input bytes");
  });
}

test("002. Child policy: the supported result retains exact input, intersection and host-only integration grant", () => {
  const cfg = config(false), before = JSON.stringify(cfg), selected = createChildSpecResolver(() => cfg, () => false);
  assert.deepEqual(selected(parent, input), { ...input, profile: "child", modelProfile: "default", capabilities: ["code.integrate", "mail.send"] });
  assert.deepEqual(selected.observe(parent), { profile: "child", modelProfile: "default", capabilities: ["code.integrate", "mail.send"] });
  assert.equal(JSON.stringify(cfg), before);
  cfg.agentProfiles.p!.childProfile = null;
  selected.refresh();
  assert.equal(selected(parent, input), null);
  assert.equal(selected.observe(parent), null, "no configured child remains an observed absence, not an unsupported execution");
});

/** Compare all non-database paths/bytes, including symlink targets. Live SQLite
 * layout/SHM are not immutable bytes; their facts are checked through Store. */
function files(root: string): Array<[string, Buffer]> {
  const visit = (relative: string): Array<[string, Buffer]> => readdirSync(join(root, relative), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
      const path = join(relative, entry.name);
      if (["runtime.sqlite", "runtime.sqlite-wal", "runtime.sqlite-shm"].includes(path)) return [];
      if (entry.isDirectory()) return visit(path);
      if (entry.isSymbolicLink()) return [[`link:${path}`, Buffer.from(readlinkSync(join(root, path)))]];
      assert.ok(entry.isFile(), `unknown fixture entry ${path}`);
      return [[`file:${path}`, readFileSync(join(root, path))]];
    });
  return visit("");
}

for (const retired of [false, true]) test(`003. Child policy: actual fresh create refuses unsupported dependency before acceptance (${retired ? "retired selector" : "omission"})`, async () => {
  const f = lifecycleReplayFixture();
  try {
    seedGit(f.root);
    const freshInput = { ...input, from: gitCommand(f.root, ["--git-dir", join(f.root, "repos/project.git"), "rev-parse", "main"]) };
    const cfg = config(true), selected = resolver(() => cfg, () => f.store.inTransaction, retired);
    const lifecycle = createLifecycleModule(f.store, f.units, { stateRoot: f.root, projectGit: join(f.root, "repos/project.git"),
      society: "replay", hasGoal: () => false, activationAllowed: () => false }, selected,
    createMailModule({ stateRoot: f.root, society: "replay" }, f.store, cfg.limits.addresses));
    const agents = f.store.listAgents(), original = files(f.root);
    let accepted = 0;
    await assert.rejects(lifecycle.create(f.auth, freshInput, "unsupported-child", undefined, () => { accepted++; }), unsupported);
    assert.equal(accepted, 0, "profile refusal precedes the acceptance callback");
    assert.equal(f.store.getOperation(f.auth.actor, "unsupported-child"), null);
    assert.equal(f.store.getAgent(input.name), null);
    assert.deepEqual(f.store.listAgents(), agents);
    assert.deepEqual(f.units.effects, []);
    assert.deepEqual(files(f.root), original, "no mail, workspace or other file publication occurred");
  } finally { f.close(); }
});

test("004. Child policy: current-policy failure cannot revalidate or rewrite an accepted selected creation on replay/reopen", async () => {
  const f = await activeCapacityFixture(2);
  try {
    const key = "original-selected-child", actor = "worker-1";
    const owner = new AbortController();
    const compose = (selected: RefreshingSpecResolver) => {
      const paths = { stateRoot: f.root, projectGit: join(f.root, "repos/project.git"),
        contextGit: join(f.root, "repos/context.git"), worldDir: join(f.root, "world"), society: "demo", ownerSignal: owner.signal };
      const mail = createMailModule(paths, f.store, f.config.limits.addresses, f.config.limits.batchMaxMessages, f.config.limits);
      // This source is already canonical: no quarantine/import or provider runs.
      const git = createGitModule(paths, f.store, mail);
      return createLifecycleModule(f.store, f.units, { ...paths, hasGoal: () => false, activationAllowed: () => false }, selected, mail, git);
    };
    const originalInput: AgentCreateInput = { name: "child", from: f.from, brief: "\uFEFFFrozen assignment\r\n",
      collaboration: { version: "collaboration-v1", freeze: { version: "create-root-v1", operation: createRootId(actor, key), dateMs: 1700000000000 } } };
    const initial = compose(createChildSpecResolver(() => f.config, () => f.store.inTransaction));
    const receipt = await initial.create(f.auth(actor), originalInput, key);
    assert.equal(receipt.state, "succeeded");
    const accepted = f.store.getOperation(actor, key);
    assert.ok(accepted?.kind === "agent.create");
    assert.equal(accepted.id, createRootId(actor, key));
    const frozen = { planJson: accepted.planJson, payloadJson: accepted.payloadJson, requestHash: accepted.requestHash };
    const agent = f.store.getAgent("child");
    assert.ok(agent);
    const starts = [...f.units.starts];
    // New policy is not a migration of the accepted resolved spec.
    f.config.agentProfiles.resident!.capabilities.push("context.publish");
    f.config.agentProfiles.resident!.delegable.push("context.publish");
    for (let reopen = 0; reopen < 2; reopen++) {
      if (reopen) f.reopen();
      let reads = 0, unavailable = false;
      const selected = createChildSpecResolver(() => {
        reads++;
        if (unavailable) throw new StoreError("UNSUPPORTED_PROFILE", "current child policy observation is unavailable");
        return f.config;
      }, () => f.store.inTransaction);
      const lifecycle = compose(selected);
      const original = files(f.root), auth = f.auth(actor);
      unavailable = true;
      assert.deepEqual(await lifecycle.create(auth, originalInput, key), receipt);
      assert.equal(reads, 1, "receipt observation precedes current policy refresh");
      const current = f.store.getOperation(actor, key);
      assert.ok(current?.kind === "agent.create");
      assert.deepEqual({ planJson: current.planJson, payloadJson: current.payloadJson, requestHash: current.requestHash }, frozen);
      assert.deepEqual(f.store.getAgent("child"), agent);
      assert.deepEqual(f.units.starts, starts);
      assert.deepEqual(files(f.root), original);
      const nextKey = `distinct-${reopen}`;
      await assert.rejects(lifecycle.create(auth, { name: "another", from: f.from, brief: "new work" }, nextKey), { code: "UNSUPPORTED_PROFILE" });
      assert.equal(reads, 2, "a genuinely new intent must observe current policy rather than reuse old receipt authority");
      assert.equal(f.store.getOperation(actor, nextKey), null);
      assert.equal(f.store.getAgent("another"), null);
      assert.deepEqual(files(f.root), original);
    }
  } finally { f.close(); }
});
