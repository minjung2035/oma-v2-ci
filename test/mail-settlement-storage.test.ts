import { testBroker } from "./helpers/broker-fixture.js";
import { createReconcileModule } from "#oma-test/app/broker/reconcile-composition";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
/** Accepted mail survives large existing state and real physical exhaustion.
 * Recovery retains frozen bytes and terminal state; there is no logical quota. */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthContext, MailInput, ProtocolLimits, ExecutionObservation } from "@oma/contracts";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { Broker } from "@oma/broker";
import { PolicyExecution } from "./fixtures/execution.js";
import { ViewsModule } from "#oma-test/app/views";
import { LifecycleModule } from "@oma/lifecycle";
import { ReconcileModule } from "@oma/reconcile";
import { StoreError, errorCodeOf } from "@oma/domain/errors";
import { ALL_CAPS, makeValidAgent, makeValidResolvedSpec } from "./fixtures/spec.js";
import { removeTree } from "./fixtures/cleanup.js";
import { sendWithStop } from "./fixtures/mail-faults.js";
import { padTree, removePad } from "./fixtures/storage-pad.js";
import { goalPublishedAt } from "./fixtures/goal.js";

const TREE_MARGIN_BYTES = 256 * 1024;
const LIMITS: ProtocolLimits = { frameBytes: TREE_MARGIN_BYTES, mailBodyBytes: 64 * 1024, subjectBytes: 8 * 1024, addresses: 64,
  replyReferences: 64, contextFiles: 64, contextBytes: 1024 * 1024, bundleBytes: 64 * 1024 * 1024, logBytes: 64 * 1024,
  batchMaxMessages: 32, idleStreamSeconds: 30, receiptWaitSeconds: 30 };
/** Existing state is made large with a sparse pad; there is no logical quota. */
const TREE_BYTES = 1024 * 1024 * 1024;
const auth: AuthContext = { actor: "alice", incarnation: 1, role: "resident", channel: "actor",
  capabilities: new Set(ALL_CAPS), peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } };
const idle: ExecutionObservation = { activeState: "inactive", subState: "dead", result: "success", execMainStatus: 0, scope: "", invocationId: "1".repeat(32) };

class ScriptedUnits extends PolicyExecution {
  starts: string[] = [];
  override observe(): ExecutionObservation { return idle; }
  override async observeAsync(): Promise<ExecutionObservation> { return idle; }
  override confirmDead(): boolean { return true; }
  override start(agent: string): void { this.starts.push(agent); }
  override stop(): ExecutionObservation { return idle; }
}
const work: MailInput = { to: ["carol"], subject: "work", kind: "message", body: "work" };

function society(t: TestContext, residents: readonly string[] = ["alice", "carol"]) {
  const root = mkdtempSync(join(tmpdir(), "oma-headroom-"));
  const store = new Store(join(root, "runtime.sqlite"), 5, { society: "demo" });
  t.after(() => { try { store.close(); } finally { removeTree(root); } });
  store.transaction(tx => {
    tx.insertAgent(makeValidAgent("principal"));
    for (const name of residents) tx.insertAgent(makeValidAgent(name, { createdBy: "principal" }));
  });
  const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 64);
  const units = new ScriptedUnits();
  const views = new ViewsModule(store, root, "demo", "p");
  const lifecycle = createLifecycleModule(store, units, { stateRoot: root, projectGit: join(root, "project.git"), society: "demo", hasGoal: () => true, activationAllowed: () => true },
    (_parent, input) => makeValidResolvedSpec(input.name, "p", ALL_CAPS, input.from, input.brief), mail);
  const paths = { stateRoot: root, runRoot: join(root, "run"), society: "demo", hasGoal: goalPublishedAt(root) };
  let broker: Broker | null = null;
  const reconcile = createReconcileModule(store, mail, null, null, units, lifecycle, { projectGit: join(root, "project.git"),
    hasGoal: () => true, activationAllowed: () => true });
  broker = testBroker({ store: store, mail: mail, units: units, views: views, lifecycle: lifecycle, git: null, reviews: null, reconcile: reconcile, paths: paths, limits: LIMITS });
  const owner = broker;
  // REC-002: recovery is the broker's in-process sweep; there is no host RPC.
  const recover = async () => {
    try { return { v: 1 as const, id: "recover", ok: true as const, result: await reconcile.sweep() }; }
    catch (error) { return { v: 1 as const, id: "recover", ok: false as const, error: { code: errorCodeOf(error) } }; }
  };
  const send = (key: string, input: MailInput = work) =>
    owner.dispatch(auth, { v: 1, id: key, method: "mail.send", request: key, params: input } as never, null) as Promise<{ ok: boolean; error?: { code: string } }>;
  return { root, store, mail, units, reconcile, recover, send };
}
/** Accepted mail whose derived views were lost: settling it is the recovery's job. */
async function lostMail(f: ReturnType<typeof society>, key = "lost", input: MailInput = work) {
  await assert.rejects(sendWithStop(f.mail, f.store, auth, key, input, "accepted"));
  const operation = f.store.getOperation("alice", key);
  assert.ok(operation?.kind === "mail.send" && operation.state === "pending");
  return operation;
}

test("V22B: large existing state does not block recovery, new mail or activation", async t => {
  const f = society(t);
  assert.equal((await f.mail.send(auth, "delivered", work)).state, "succeeded");
  const lost = await lostMail(f);
  padTree(f.root, TREE_BYTES + 1);
  const fresh = await f.send("fresh");
  assert.deepEqual([fresh.ok, fresh.error?.code], [true, undefined]);
  assert.equal(f.store.getOperation("alice", "fresh")?.state, "succeeded");
  const report = await f.recover();
  assert.deepEqual(report, { v: 1, id: "recover", ok: true, result: { examined: 1, repaired: 1, remaining: 0 } });
  assert.equal(f.store.getOperationById(lost.id)?.state, "succeeded", "settlement is not new consumption");
  assert.deepEqual(f.units.starts, ["carol"], "large existing state does not block activation");
});

test("V22B: recovery retains frozen bytes in a larger tree and never replays settled facts", async t => {
  const f = society(t);
  const lost = await lostMail(f);
  const object = readFileSync(f.mail.objectPath(lost.plan.message.id));
  padTree(f.root, TREE_BYTES + TREE_MARGIN_BYTES + 1);
  const report = await f.recover();
  assert.deepEqual(report, { v: 1, id: "recover", ok: true, result: { examined: 1, repaired: 1, remaining: 0 } });
  assert.equal(f.store.getOperationById(lost.id)?.state, "succeeded");
  assert.deepEqual(readFileSync(f.mail.objectPath(lost.plan.message.id)), object);
  removePad(f.root);
  assert.deepEqual((await f.recover()).result, { examined: 0, repaired: 0, remaining: 0 }, "settled evidence is not replayed");
});

test("V22B: ordinary settlement materializes the frozen mail for every recipient", async t => {
  const residents = ["alice", ...Array.from({ length: 31 }, (_, index) => `r${index}`)];
  const f = society(t, residents);
  const everyone: MailInput = { to: ["residents"], subject: "everyone", kind: "message", body: "b".repeat(LIMITS.mailBodyBytes / 2) };
  // Steady state: every inbox already exists, as after each resident's creation.
  assert.equal((await f.mail.send(auth, "earlier", everyone)).state, "succeeded");
  const lost = await lostMail(f, "all-lost", everyone);
  assert.equal(lost.plan.message.recipients.length, residents.length);
  assert.deepEqual((await f.recover()).result, { examined: 1, repaired: 1, remaining: 0 });
  for (const recipient of residents)
    assert.equal(f.store.getDelivery(lost.plan.message.id, recipient)?.materialized, 1);

});

test("V22B: on a real full filesystem new work is STORAGE_FULL and accepted mail is never complete without its views", t => {
  const mount = mkdtempSync(join(tmpdir(), "oma-full-fs-"));
  try {
    const harness = new URL("./fixtures/full-fs-harness.js", import.meta.url).pathname;
    const state = join(mount, "state");
    // The same pinned user-namespace primitive used by the native execution
    // lane mounts a real 4 MiB tmpfs. No shell, synthetic quota or global
    // userns permission change substitutes for the ENOSPC observation below.
    const child = spawnSync("/usr/bin/bwrap", ["--unshare-user", "--unshare-pid", "--new-session", "--die-with-parent",
      "--bind", "/", "/", "--dev-bind", "/dev", "/dev", "--proc", "/proc",
      "--size", "4194304", "--tmpfs", mount, "--dir", state,
      "--", process.execPath, harness, state], { encoding: "utf8", timeout: 60_000 });
    assert.equal(child.status, 0, `the full-filesystem child must run: ${child.stderr}`);
    const line = child.stdout.split("\n").find(value => value.startsWith("REPORT:"));
    assert.ok(line, child.stdout + child.stderr);
    const report = JSON.parse(line.slice(7)) as {
      first: string; fillCode: string; newWork: { ok: boolean; code?: string }; newRow: string | null; staged: string[];
      pending: { state: string; objectIntact: boolean; archive: boolean; materialized: boolean };
    };
    assert.equal(report.first, "succeeded");
    assert.equal(report.fillCode, "ENOSPC", "the filesystem really is full");
    assert.deepEqual(report.newWork, { ok: false, code: "STORAGE_FULL" }, "physical exhaustion is not a logical quota refusal");
    assert.equal(report.newRow, null);
    assert.deepEqual(report.staged, []);
    assert.equal(report.pending.objectIntact, true, "accepted evidence survives the full filesystem");
    if (report.pending.state === "succeeded") assert.ok(report.pending.archive && report.pending.materialized, JSON.stringify(report));
    else assert.equal(report.pending.state, "pending");
    t.diagnostic(`full filesystem report: ${JSON.stringify(report)}`);
  } finally { rmdirSync(mount); }
});
