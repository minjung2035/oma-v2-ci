/** V22B: at the admission cap, settlement of accepted work proceeds inside one
 * bounded headroom (the existing frame limit), one over-cap settlement at a
 * time, and is refused past it with its evidence retained; new work is refused
 * throughout. A real full filesystem is a different fact: new work reports
 * STORAGE_FULL and an accepted mail is never reported complete without its
 * views. Real Broker, dispatchers, MailModule, LifecycleModule and
 * ReconcileModule; unit control is scripted; the full filesystem is a real
 * size-limited tmpfs in a private user+mount namespace.
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthContext, MailInput, ProtocolLimits, UnitObservation } from "../implementation/contracts.js";
import { Store } from "../src/store.js";
import { MailModule } from "../src/mail.js";
import { Broker } from "../src/broker.js";
import { UnitsModule } from "../src/units.js";
import { ViewsModule } from "../src/views.js";
import { LifecycleModule } from "../src/lifecycle.js";
import { ReconcileModule } from "../src/reconcile.js";
import { StoreError, errorCodeOf } from "../src/domain/errors.js";
import { observedStorageBytes } from "../src/storage/quota.js";
import { parseUnitObservation } from "../src/units/observe.js";
import { ALL_CAPS, TEST_RESOURCES, makeValidAgent, makeValidResolvedSpec } from "./fixtures/spec.js";
import { removeTree } from "./fixtures/cleanup.js";
import { sendWithStop } from "./fixtures/mail-faults.js";
import { padTree, removePad } from "./fixtures/storage-pad.js";
import { goalPublishedAt } from "./fixtures/goal.js";

const HEADROOM = 256 * 1024;
const LIMITS: ProtocolLimits = { frameBytes: HEADROOM, mailBodyBytes: 64 * 1024, subjectBytes: 8 * 1024, addresses: 64,
  replyReferences: 64, contextFiles: 64, contextBytes: 1024 * 1024, bundleBytes: 64 * 1024 * 1024, logBytes: 64 * 1024,
  batchMaxMessages: 32, idleStreamSeconds: 30, receiptWaitSeconds: 30 };
/** A fixed configured quota; the tree is placed relative to it with a sparse pad. */
const QUOTA = 1024 * 1024 * 1024;
const auth: AuthContext = { actor: "alice", incarnation: 1, role: "resident", channel: "actor",
  capabilities: new Set(ALL_CAPS), peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), cgroup: null } };
const idle = parseUnitObservation({ kind: "succeeded", status: 0, signal: null, stderr: "",
  stdout: `ActiveState=inactive\nSubState=dead\nResult=success\nExecMainStatus=0\nControlGroup=/oma-test\nInvocationID=${"1".repeat(32)}\n` });

class ScriptedUnits extends UnitsModule {
  starts: string[] = [];
  constructor(root: string) { super("demo", { node: process.execPath, libdir: root, state: root, society: "demo", agent: "" }, join(root, "units"), { p: TEST_RESOURCES }); }
  override observe(): UnitObservation { return idle; }
  override async observeAsync(): Promise<UnitObservation> { return idle; }
  override confirmDead(): boolean { return true; }
  override start(agent: string): void { this.starts.push(agent); }
  override stop(): UnitObservation { return idle; }
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
  const mail = new MailModule({ stateRoot: root, society: "demo" }, store, 64);
  const units = new ScriptedUnits(root);
  const views = new ViewsModule(store, root, "demo", "p");
  const lifecycle = new LifecycleModule(store, units, { stateRoot: root, projectGit: join(root, "project.git"), society: "demo", hasGoal: () => true, activationAllowed: () => true },
    (_parent, input) => makeValidResolvedSpec(input.name, "p", ALL_CAPS, input.from, input.brief), mail);
  const paths = { stateRoot: root, runRoot: join(root, "run"), society: "demo", hasGoal: goalPublishedAt(root), storageBytes: QUOTA };
  // Recovery shares the broker's own storage owner, as the entry composition wires it.
  let broker: Broker | null = null;
  const gate = ((category: never) => (Reflect.get(broker!, "admitResource") as (value: unknown) => unknown)(category)) as never;
  const reconcile = new ReconcileModule(store, mail, null, units, lifecycle, { projectGit: join(root, "project.git"),
    hasGoal: () => true, activationAllowed: () => true, resourceGate: gate });
  broker = new Broker(store, mail, units, views, lifecycle, null, reconcile, paths, LIMITS);
  const owner = broker;
  t.mock.method(owner as unknown as Record<string, () => void>, "requireHostUnit", () => undefined);
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

test("V22B: at the admission cap recovery settles accepted mail inside the headroom while new work and activation are refused", async t => {
  const f = society(t);
  assert.equal((await f.mail.send(auth, "delivered", work)).state, "succeeded");
  const lost = await lostMail(f);
  padTree(f.root, QUOTA + 1);
  const fresh = await f.send("fresh");
  assert.deepEqual([fresh.ok, fresh.error?.code], [false, "QUOTA_EXCEEDED"]);
  assert.equal(f.store.getOperation("alice", "fresh"), null);
  const report = await f.recover();
  assert.deepEqual(report, { v: 1, id: "recover", ok: true, result: { examined: 1, repaired: 1, remaining: 0 } });
  assert.equal(f.store.getOperationById(lost.id)?.state, "succeeded", "settlement is not new consumption");
  assert.deepEqual(f.units.starts, [], "activation is new work");
});

test("V22B: past the headroom settlement is refused with its accepted evidence retained", async t => {
  const f = society(t);
  const lost = await lostMail(f);
  const object = readFileSync(f.mail.objectPath(lost.plan.message.id));
  padTree(f.root, QUOTA + HEADROOM + 1);
  const report = await f.recover();
  assert.deepEqual(report, { v: 1, id: "recover", ok: true, result: { examined: 1, repaired: 0, remaining: 1 } });
  assert.equal(f.store.getOperationById(lost.id)?.state, "pending");
  assert.deepEqual(readFileSync(f.mail.objectPath(lost.plan.message.id)), object);
  removePad(f.root);
  assert.deepEqual((await f.recover()).result, { examined: 1, repaired: 1, remaining: 0 }, "the retained evidence settles once room exists");
});

test("V22B: one over-cap settlement at a time; within the cap settlement is not serialized", async () => {
  const quota = await import("../src/storage/quota.js") as unknown as Record<string, unknown>;
  const Owner = quota.StorageAdmission as (new (root: string, storageBytes: number | undefined, headroom: number) => {
    admit(category: string): () => void;
  }) | undefined;
  assert.equal(typeof Owner, "function", "one owner holds the process's storage policy");
  const root = mkdtempSync(join(tmpdir(), "oma-headroom-unit-"));
  try {
    // A tree far above the headroom keeps every quota below positive.
    padTree(root, 16 * 1024 * 1024);
    const observed = observedStorageBytes(root);
    const refused = (error: unknown) => error instanceof StoreError && error.code === "QUOTA_EXCEEDED";
    const atCap = new Owner!(root, observed - 1, HEADROOM);
    assert.throws(() => atCap.admit("admit"), refused);
    const first = atCap.admit("settle");
    assert.throws(() => atCap.admit("settle"), refused, "a second over-cap settlement waits for the first");
    first(); first();
    atCap.admit("settle")();
    const exhausted = new Owner!(root, observed - HEADROOM - 1, HEADROOM);
    assert.throws(() => exhausted.admit("settle"), refused, "the headroom is bounded");
    const within = new Owner!(root, observed, HEADROOM);
    const a = within.admit("settle"); const b = within.admit("settle");
    a(); b();
  } finally { removeTree(root); }
});

test("V22B: a maximal ordinary settlement's file growth fits the headroom; SQLite/WAL growth is measured, not bounded", async t => {
  const residents = ["alice", ...Array.from({ length: 31 }, (_, index) => `r${index}`)];
  const f = society(t, residents);
  const everyone: MailInput = { to: ["residents"], subject: "everyone", kind: "message", body: "b".repeat(LIMITS.mailBodyBytes / 2) };
  // Steady state: every inbox already exists, as after each resident's creation.
  assert.equal((await f.mail.send(auth, "earlier", everyone)).state, "succeeded");
  const lost = await lostMail(f, "all-lost", everyone);
  assert.equal(lost.plan.message.recipients.length, residents.length);
  const measure = () => {
    const sqlite = ["runtime.sqlite", "runtime.sqlite-wal", "runtime.sqlite-shm"]
      .map(name => observedStorageBytes(join(f.root, name))).reduce((sum, value) => sum + value, 0);
    return { files: observedStorageBytes(f.root) - sqlite, sqlite };
  };
  const before = measure();
  assert.deepEqual((await f.recover()).result, { examined: 1, repaired: 1, remaining: 0 });
  const after = measure();
  t.diagnostic(`settlement growth: files ${after.files - before.files} bytes, sqlite ${after.sqlite - before.sqlite} bytes, headroom ${HEADROOM}`);
  assert.ok(after.files - before.files <= HEADROOM, `file growth ${after.files - before.files} exceeds the headroom`);
});

test("V22B: on a real full filesystem new work is STORAGE_FULL and accepted mail is never complete without its views", t => {
  const mount = mkdtempSync(join(tmpdir(), "oma-full-fs-"));
  try {
    const harness = new URL("./fixtures/full-fs-harness.js", import.meta.url).pathname;
    const child = spawnSync("unshare", ["-rm", "sh", "-c", 'mount -t tmpfs -o size=4m tmpfs "$0" && mkdir "$0/state" && exec "$1" "$2" "$0/state"',
      mount, process.execPath, harness], { encoding: "utf8", timeout: 60_000 });
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
