/** DR72 production admission, not provider/kernel/power-loss qualification.
 * Old/missing Society birth must refuse before Store recovery, provisioning,
 * SDK admission or runner composition; no supplied current plan promotes it. */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Store } from "@oma/storage";
import { ExecutionJournal } from "@oma/storage/execution-journal";
import { defaultHostConfig } from "@oma/config/defaults";
import { collaborationSurface } from "@oma/domain/collaboration-surface";
import { requestHash } from "@oma/domain/request-identity";
import { receiptOfOperation } from "@oma/protocol/receipt-projector";
import { createNativeResidents, type NativeResidents } from "#oma-test/app/runtime/native-residents";
import { ExecutionRuntime } from "#oma-test/app/runtime/execution-runtime";
import { newSessionBirth, publishSessionBirth, readSessionBirth } from "#oma-test/app/runtime/session-mode";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import { publishProjectBinding } from "#oma-test/app/runtime/provision";
import { makeValidAgent } from "./fixtures/spec.js";
import { serializePlanIntent } from "./fixtures/plan.js";
import { TEST_PROTOCOL_LIMITS } from "./fixtures/limits.js";

const pendingId = "op-00000000-0000-4000-8000-000000000009";
function files(root: string, prefix = ""): Map<string, Buffer> {
  const result = new Map<string, Buffer>();
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) for (const [name, bytes] of files(root, path)) result.set(name, bytes);
    else { assert.equal(entry.isFile(), true); result.set(path, readFileSync(join(root, path))); }
  }
  return result;
}
async function fixture(t: TestContext, birth: "old" | "missing" | "current") {
  const base = mkdtempSync(join(tmpdir(), "oma-society-admission-")), data = join(base, "data"), root = join(data, "oma", "demo");
  const project = join(base, "project"), run = join(base, "run");
  mkdirSync(root, { recursive: true }); mkdirSync(project);
  t.after(() => rmSync(base, { recursive: true, force: true }));
  if (birth !== "missing") publishSessionBirth(root, newSessionBirth(root, "society", project, birth === "current" ? "collaboration-v1" : undefined));
  ExecutionJournal.initialize(root);
  publishProjectBinding(root, { society: "demo", canonicalProjectPath: project });
  const repository = join(root, "repos", "project.git"); mkdirSync(join(root, "repos"));
  execFileSync("/usr/bin/git", ["init", "--bare", "--quiet", repository]);
  const tree = execFileSync("/usr/bin/git", ["--git-dir", repository, "mktree"], { input: "", encoding: "utf8" }).trim();
  const commit = execFileSync("/usr/bin/git", ["--git-dir", repository, "commit-tree", tree, "-m", "Retained original main"],
    { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" } }).trim();
  execFileSync("/usr/bin/git", ["--git-dir", repository, "update-ref", "refs/heads/main", commit]);
  const store = new Store(join(root, "runtime.sqlite"));
  const payload = { topic: "original" };
  store.transaction(tx => {
    tx.insertAgent(makeValidAgent("alice")); tx.insertAgent(makeValidAgent("bob")); tx.insertAgent(makeValidAgent("principal"));
    tx.acceptOperation({ id: pendingId, actor: "alice", requestKey: "original-pending", requestHash: requestHash("route.follow", payload),
      kind: "route.follow", payloadJson: JSON.stringify(payload), planJson: serializePlanIntent({ kind: "route.follow", topic: "original", agent: "alice" }) });
  });
  const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 64, 24, TEST_PROTOCOL_LIMITS);
  const receipt = await mail.send({ actor: "alice", role: "resident", channel: "actor", incarnation: 1,
    capabilities: new Set(["mail.send"]), peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } },
  "original-succeeded", { to: ["bob"], kind: "message", subject: "Retain", body: "\ufefforiginal\r\n" });
  assert.equal(receipt.state, "succeeded");
  const pending = store.getOperationById(pendingId)!; assert.equal(pending.state, "pending");
  store.close();
  const manager = SessionManager.create(project, join(root, "principal", "private", "sessions"));
  manager.appendMessage({ role: "assistant", content: [{ type: "toolCall", id: "original-call", name: "toolset", arguments: { select: ["web_search"] } }],
    api: "openai-completions", provider: "openai", model: "historical-fixture", stopReason: "toolUse", timestamp: Date.now(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  manager.appendCustomEntry("oma-toolset", { version: 1, select: ["web_search"] });
  // Birth compatibility must be decided even when this release cannot load the
  // stored profile. No old-profile decoder or qualified runtime is supplied.
  writeFileSync(join(root, "config.json"), '{"old-profile":"retain these exact bytes"}\n');
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: join(base, "home"), XDG_DATA_HOME: data, XDG_RUNTIME_DIR: run, NODE_DISABLE_COMPILE_CACHE: "1" };
  delete env.OMA_HOST_CHANNEL; delete env.OMA_SOCIETY_FENCE_FD;
  return { base, data, root, project, run, repository, commit, receipt, pending, env };
}

for (const birth of ["old", "missing"] as const) for (const selected of [false, true]) {
  test(`001. Actual Society CLI: ${birth} birth${selected ? "; explicit current selection cannot promote it" : ""} refuses without changing original facts`, { timeout: 20_000 }, async t => {
    const f = await fixture(t, birth), before = files(f.base);
    for (let retry = 0; retry < 2; retry++) {
      const result = spawnSync(process.execPath, [join(import.meta.dirname, "../../apps/oma/dist/entry/oma.js"), "--society", "demo",
        ...(selected ? ["--surface", "collaboration-v1"] : [])], { cwd: f.project, env: f.env, encoding: "utf8", timeout: 10_000 });
      assert.equal(result.error, undefined, result.stderr); assert.equal(result.signal, null, result.stderr);
      assert.equal(result.status, 4, result.stderr);
      assert.match(result.stderr, /Society birth.*(unsupported|missing).*no new execution/);
      assert.deepEqual(files(f.base), before, "same selection/retry cannot write birth, history, config, execution journal, DB, mail, refs or run files");
    }
    const reopened = new Store(join(f.root, "runtime.sqlite"));
    try { assert.deepEqual(reopened.getOperationById(pendingId), f.pending);
      assert.deepEqual(receiptOfOperation(reopened.getOperation("alice", "original-succeeded")!), f.receipt); }
    finally { reopened.close(); }
    assert.equal(execFileSync("/usr/bin/git", ["--git-dir", f.repository, "rev-parse", "refs/heads/main"], { encoding: "utf8" }).trim(), f.commit);
  });
}
for (const birth of ["old", "missing"] as const) {
  test(`002. Actual standalone broker: ${birth} birth refuses before lock/config/Store/execution recovery writes`, { timeout: 20_000 }, async t => {
    const f = await fixture(t, birth), before = files(f.base);
    for (let retry = 0; retry < 2; retry++) {
      const result = spawnSync(process.execPath, [join(import.meta.dirname, "../../apps/oma/dist/entry/broker.js"), "--society", "demo",
        "--state-root", f.root, "--run-root", join(f.run, "oma", "demo"), "--config", join(f.root, "config.json")],
      { cwd: f.project, env: f.env, encoding: "utf8", timeout: 10_000 });
      assert.equal(result.error, undefined, result.stderr); assert.equal(result.signal, null, result.stderr);
      assert.equal(result.status, 1, result.stderr); assert.match(result.stderr, /Society birth.*(unsupported|missing).*no new execution/);
      assert.deepEqual(files(f.base), before, "no broker lock, replacement DB, recovered intent, terminalization, mail or ref write");
    }
  });
}
for (const birth of ["old", "missing", "current"] as const) {
  test(`003. Native Worker composition: ${birth} birth with explicit current plan ${birth === "current" ? "keeps the current contract" : "cannot become an opt-in"}`, async t => {
    const f = await fixture(t, birth), store = new Store(join(f.root, "runtime.sqlite")), executions = new ExecutionRuntime(f.root);
    let units: NativeResidents | undefined;
    try {
      await executions.recover();
      const before = files(f.base), config = defaultHostConfig({ society: "demo", node: process.execPath, libdir: process.cwd(), deploymentDigest: "a".repeat(64) });
      const compose = () => { units = createNativeResidents(store, executions, { stateRoot: f.root, runRoot: join(f.run, "oma", "demo"), society: "demo", configPath: join(f.root, "config.json") },
        config, () => { throw new Error("No execution/channel is admitted in this fixture"); }, () => {}, () => null,
        { toolSurface: JSON.stringify(collaborationSurface("resident")) }); return units; };
      if (birth === "current") {
        const owner = compose(); assert.equal(owner.workerSurface, "collaboration-v1");
        assert.equal(owner.collaborationRecordsSelected("alice"), true); assert.equal(owner.collaborationRecordsSelected("principal"), true);
        assert.equal(owner.collaborationRecordsSelected("unknown"), false);
      } else assert.throws(compose, { code: "UNSUPPORTED_PROFILE", message: /Society birth.*(unsupported|missing).*no new execution/ });
      await units?.close();
      assert.deepEqual(files(f.base), before, "composition and refusal do not execute or mutate persisted facts");
      assert.equal(store.getOperationById(pendingId)!.state, "pending");
    } finally { await units?.close(); await executions.close(); store.close(); }
  });
}

for (const damage of ["malformed", "unreadable"] as const) for (const entry of ["oma", "broker"] as const) {
  test(`004. Actual ${entry}: ${damage} birth remains an error/unknown observation, never a fresh or absent Society`, { timeout: 20_000 }, async t => {
    const f = await fixture(t, "current"), path = join(f.root, "session-mode.json");
    if (damage === "malformed") writeFileSync(path, "{\n");
    const before = files(f.base);
    if (damage === "unreadable") chmodSync(path, 0);
    try {
      for (let retry = 0; retry < 2; retry++) {
        const result = spawnSync(process.execPath, [join(import.meta.dirname, `../../apps/oma/dist/entry/${entry}.js`), "--society", "demo",
          ...(entry === "broker" ? ["--state-root", f.root, "--run-root", join(f.run, "oma", "demo"), "--config", join(f.root, "config.json")] : [])],
        { cwd: f.project, env: f.env, encoding: "utf8", timeout: 10_000 });
        assert.equal(result.error, undefined, result.stderr); assert.equal(result.signal, null, result.stderr);
        assert.equal(result.status, entry === "broker" ? 1 : 3, result.stderr);
        assert.match(result.stderr, damage === "malformed" ? /session mode record is invalid/ : /EACCES|denied|cannot be observed/i);
        assert.doesNotMatch(result.stderr, /birth is (missing|unsupported)|fresh admission is not qualified/,
          "an unreadable/malformed descriptor cannot be reclassified as absent or incompatible bytes");
      }
    } finally { if (damage === "unreadable") chmodSync(path, 0o600); }
    assert.deepEqual(files(f.base), before, "no repair, new birth, invocation/operation or run-root file after repeated refusal");
  });
}

for (const [label, raw] of [["version-2", JSON.stringify({ version: 2 })], ["malformed", "{"],
  ["Principal role", JSON.stringify(collaborationSurface("principal"))]] as const) {
  test(`005. Current Society cannot fall back from a ${label} Worker plan`, async t => {
    const f = await fixture(t, "current"), store = new Store(join(f.root, "runtime.sqlite")), executions = new ExecutionRuntime(f.root);
    try {
      await executions.recover(); const before = files(f.base);
      const config = defaultHostConfig({ society: "demo", node: process.execPath, libdir: process.cwd(), deploymentDigest: "a".repeat(64) });
      assert.throws(() => createNativeResidents(store, executions, { stateRoot: f.root, runRoot: join(f.run, "oma", "demo"), society: "demo", configPath: join(f.root, "config.json") },
        config, () => { throw new Error("No runner/channel may be admitted"); }, () => {}, () => null, { toolSurface: raw }), { code: "UNSUPPORTED_PROFILE" });
      assert.deepEqual(files(f.base), before); assert.equal(store.getOperationById(pendingId)!.state, "pending");
    } finally { await executions.close(); store.close(); }
  });
}
for (const selected of [false, true]) test(`006. Fresh Society CLI: ${selected ? "explicit" : "omitted"} selection stays closed; no implicit new birth`, { timeout: 15_000 }, t => {
  const base = mkdtempSync(join(tmpdir(), "oma-fresh-closed-")); t.after(() => rmSync(base, { recursive: true, force: true }));
  const project = join(base, "project"); mkdirSync(project);
  const before = files(base);
  const result = spawnSync(process.execPath, [join(import.meta.dirname, "../../apps/oma/dist/entry/oma.js"), ...(selected ? ["--surface", "collaboration-v1"] : [])],
    { cwd: project, env: { ...process.env, HOME: join(base, "home"), XDG_DATA_HOME: join(base, "data"), XDG_RUNTIME_DIR: join(base, "run"), NODE_DISABLE_COMPILE_CACHE: "1" }, encoding: "utf8", timeout: 10_000 });
  assert.equal(result.error, undefined, result.stderr); assert.equal(result.status, 4, result.stderr);
  assert.match(result.stderr, /fresh admission is not qualified/); assert.deepEqual(files(base), before);
});
test("007. Birth diagnostics do not remove Personal or reinterpret its existing bytes", t => {
  const base = mkdtempSync(join(tmpdir(), "oma-personal-preserved-")); t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, ".personal", "00000000-0000-4000-8000-000000000001"), birth = newSessionBirth(root, "personal", base);
  publishSessionBirth(root, birth); const before = files(base);
  assert.deepEqual(readSessionBirth(root), birth); assert.deepEqual(files(base), before);
});
