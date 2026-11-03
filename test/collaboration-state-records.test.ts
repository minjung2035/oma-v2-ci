/** Actual Store/Mail/Git/context files and lifecycle creation policy. This does
 * not claim kernel mount, process death or live-provider qualification. */
import test from "node:test";
import assert from "node:assert/strict";
import fs, { mkdtempSync, readFileSync, chmodSync, writeFileSync, existsSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthContext } from "@oma/contracts";
import { Store } from "@oma/storage";
import { LifecyclePolicy } from "@oma/lifecycle/policy";
import { sha256Hex } from "@oma/domain/canonical-json";
import { contextRevisionPathAt } from "@oma/domain/paths";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import { createGitModule } from "#oma-test/app/broker/git-composition";
import { lifecycleLedger } from "#oma-test/app/broker/lifecycle-ledger";
import { CollaborationStateViews } from "#oma-test/app/views/collaboration-state";
import { CollaborationReceiptViews } from "#oma-test/app/views/collaboration-receipts";
import { CollaborationLogViews } from "#oma-test/app/views/collaboration-logs";
import { ResidentLogStore, type ResidentLogFileObservation } from "@oma/storage/resident-logs";
import { StoreError } from "@oma/domain/errors";
import { AdmissionGate, bindAdmissionGate, assertNewAcceptance } from "@oma/domain/admission";
import { ViewsModule } from "#oma-test/app/views";
import { createBroker, type BrokerExecution } from "#oma-test/app/broker/broker-composition";
import type { BrokerDependencies } from "@oma/broker/ports";
import type { LifecycleModule } from "@oma/lifecycle";
import type { ProcessLock } from "@oma/native/process-lock";
import { TEST_PROTOCOL_LIMITS, TEST_VIEW_LIMITS } from "./fixtures/limits.js";
import { ALL_CAPS, makeValidAgent } from "./fixtures/spec.js";
import { removeTree } from "./fixtures/cleanup.js";

function fixture(t: test.TestContext) {
  const root = mkdtempSync(join(tmpdir(), "oma-collaboration-state-"));
  const store = new Store(join(root, "runtime.sqlite"));
  t.after(() => { store.close(); removeTree(root); });
  store.transaction(tx => { for (const name of ["alice", "bob", "principal"]) tx.insertAgent(makeValidAgent(name)); tx.follow("runtime", "alice"); });
  const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 16, 24, TEST_PROTOCOL_LIMITS);
  const git = createGitModule({ stateRoot: root, projectGit: join(root, "repos/project.git"), contextGit: join(root, "repos/context.git"), worldDir: join(root, "world"), society: "demo" }, store, mail, null);
  const policy = new LifecyclePolicy(lifecycleLedger(store), Object.assign(() => null, {
    maxWorkers: () => 6, observe: () => ({ profile: "p", modelProfile: "md", capabilities: [...ALL_CAPS] }) }));
  const sources = { mail, git, lifecycle: { creation: (auth: AuthContext) => policy.observeCreation(auth) } };
  const auth = (actor = "alice"): AuthContext => ({ actor, incarnation: actor === "principal" ? 0 : 1,
    role: actor === "principal" ? "principal" : "resident", channel: "actor", capabilities: new Set(ALL_CAPS),
    peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } });
  const publish = async (key: string, bytes: Buffer, expected: string | null = null) => {
    const receipt = await git.publishContext(auth("principal"), key, { expected,
      entries: [{ path: "GOAL.md", bytes: bytes.length, sha256: sha256Hex(bytes) }],
      content: { bytes: bytes.length, sha256: sha256Hex(bytes), mediaType: "application/vnd.oma.context-v1" } }, (async function* () { yield bytes; })());
    assert.equal(receipt.state, "succeeded"); assert.ok(receipt.result?.kind === "context.publish"); return receipt.result.revision;
  };
  return { root, store, mail, git, sources, auth, publish, records: new CollaborationStateViews(store, sources, root, "demo") };
}

test("001. State: actual canonical GOAL bytes and separate execution/registry observations do not grant Principal peer access", async t => {
  const f = fixture(t), goal = Buffer.from("\ufeff# GOAL\nexact trailing spaces  \n");
  assert.deepEqual(f.git.readContextRecord(), { state: "absent", revision: null });
  const revision = await f.publish("goal", goal);
  const before = f.store.getOperation("principal", "goal")!.resultJson;
  const views = new ViewsModule(f.store, f.root, "demo", "p"); views.bindCollaborationRecords(f.sources);
  const result = views.refreshCollaborationRecords(f.auth(), { observedAtMs: 1700000000000,
    units: new Map([["bob", "no-unit"]]), failure: null });
  assert.deepEqual(readFileSync(join(result.root, "goal/GOAL.md")), goal);
  const status = JSON.parse(readFileSync(join(result.root, "goal/status.json"), "utf8"));
  assert.equal(status.contextRevision, revision); assert.equal(status.bodySha256, sha256Hex(goal));
  const peers = readFileSync(join(result.root, "peers/index.md"), "utf8");
  assert.match(peers, /Enabled Worker count: 2/); assert.match(peers, /idle and waiting enabled Workers still count/);
  assert.match(peers, /alice \| p \| enabled \| 1 \| unobserved/); assert.match(peers, /bob \| p \| enabled \| 1 \| no-unit/);
  assert.match(peers, /maxWorkers.*6/); assert.match(readFileSync(join(result.root, "subscriptions.md"), "utf8"), /runtime/);
  const principal = views.refreshCollaborationRecords(f.auth("principal"));
  assert.deepEqual(readFileSync(join(principal.root, "goal/GOAL.md")), goal);
  assert.equal(existsSync(join(principal.root, "peers")), false); assert.equal(existsSync(join(principal.root, "subscriptions.md")), false);
  assert.equal(f.store.getOperation("principal", "goal")!.resultJson, before);
  assert.equal(views.collaborationRecordFailure("alice"), null);
  assert.throws(() => views.bindCollaborationRecords(f.sources), { code: "INTERNAL_ERROR" });
});

test("002. State: corrupt canonical snapshot preserves last good records and records a trusted refresh failure", async t => {
  const f = fixture(t), goal = Buffer.from("# GOAL\noriginal\n"), revision = await f.publish("goal", goal);
  const first = f.records.refresh(f.auth()), index = readFileSync(join(first.root, "goal/status.json"));
  const original = join(contextRevisionPathAt(join(f.root, "world"), revision), "GOAL.md");
  chmodSync(original, 0o644); writeFileSync(original, "# GOAL\ncorrupted\n");
  assert.throws(() => f.records.refresh(f.auth()), { code: "STORE_CORRUPT" });
  assert.deepEqual(readFileSync(join(first.root, "goal/GOAL.md")), goal);
  assert.deepEqual(readFileSync(join(first.root, "goal/status.json")), index);
  assert.match(readFileSync(join(first.root, "health.md"), "utf8"), /Refresh: unavailable/);
  assert.match(f.records.failure("alice")!, /not proof of absence/);
});

test("003. State: role/incarnation mismatch is refused before filesystem publication and absent GOAL is not an empty placeholder", t => {
  const f = fixture(t);
  assert.throws(() => f.records.refresh({ ...f.auth(), role: "principal" }), { code: "AUTH_FAILED" });
  assert.throws(() => f.records.refresh({ ...f.auth(), incarnation: 2 }), { code: "STALE_RUN" });
  const result = f.records.refresh(f.auth());
  assert.equal(existsSync(join(result.root, "goal/GOAL.md")), false);
  assert.equal(JSON.parse(readFileSync(join(result.root, "goal/status.json"), "utf8")).contextRevision, null);
  assert.equal(result.refresh, "partial");
});

test("004. State: record publication refuses T before any receipt or state files are created", t => {
  const f = fixture(t), root = join(f.root, "agents/alice/records");
  const receipts = new CollaborationReceiptViews(f.store, f.root);
  assert.equal(existsSync(root), false);
  assert.throws(() => f.store.transaction(() => f.records.refresh(f.auth())), { code: "INTERNAL_ERROR", message: "collaboration records cannot publish in T" });
  assert.throws(() => f.store.transaction(() => receipts.publish(f.auth(), [], new Set(), () => false, "2026-11-01T00:00:00.000Z")),
    { code: "INTERNAL_ERROR", message: "invocation receipt records cannot publish in T" });
  assert.equal(existsSync(root), false);
  assert.equal(f.store.acceptedOperationPage().items.length, 0);
});

test("005. State: wrapped creation-policy corruption reaches the original gate without erasing other records or accepted Mail", async t => {
  const f = fixture(t), message = { to: ["bob"], subject: "Before corruption", body: "accepted original", kind: "message" as const };
  const accepted = await f.mail.send(f.auth(), "before-corruption", message);
  const gate = new AdmissionGate(); bindAdmissionGate(f.store, gate);
  const original = new AggregateError([new StoreError("STORE_CORRUPT", "recorded policy corruption"), new Error("secondary cleanup failure")]);
  const policy = new LifecyclePolicy(lifecycleLedger(f.store), Object.assign(() => null, {
    maxWorkers: () => 6, observe: () => ({ profile: "p", modelProfile: "md", capabilities: [...ALL_CAPS] }), refresh: () => { throw original; } }));
  const records = new CollaborationStateViews(f.store, { ...f.sources, lifecycle: { creation: auth => policy.observeCreation(auth) } }, f.root, "demo");
  const observed = records.refresh(f.auth());
  assert.equal(gate.state, "corrupt"); assert.throws(() => assertNewAcceptance(f.store), { code: "STORE_CORRUPT" });
  assert.ok(observed.coverage.includes("mail-history")); assert.ok(observed.coverage.includes("peers"));
  assert.ok(!observed.coverage.includes("creation-policy"));
  assert.match(readFileSync(join(observed.root, "health.md"), "utf8"), /creation-policy \[STORE_CORRUPT\]/);
  assert.match(records.failure("alice")!, /creation-policy/);
  assert.deepEqual(await f.mail.send(f.auth(), "before-corruption", message), accepted, "the fence cannot erase an accepted receipt");
  await assert.rejects(f.mail.send(f.auth(), "after-corruption", message), { code: "STORE_CORRUPT" });
  assert.equal(f.store.acceptedOperationPage().items.length, 1);
});

for (const point of ["unavailable-result", "enumeration", "frame-read", "ordinary-eio"] as const) {
  test(`006. Diagnostics: caught ${point} reaches the original gate without suppressing accepted Mail or independent log facts`, async t => {
    const f = fixture(t), message = { to: ["bob"], subject: "Before diagnostics", body: "accepted original", kind: "message" as const };
    const accepted = await f.mail.send(f.auth(), "before-diagnostics", message);
    const gate = new AdmissionGate(); bindAdmissionGate(f.store, gate);
    const cause = point === "ordinary-eio" ? Object.assign(new Error("source read failed"), { code: "EIO" }) : new StoreError("STORE_CORRUPT", "normalized source corruption");
    const failure = new AggregateError([cause, new Error("secondary source cleanup failure")]);
    const spool = new ResidentLogStore(f.root);
    for (const actor of ["alice", "bob"]) {
      const invocationId = (actor === "alice" ? "a" : "b").repeat(32), writer = spool.open(actor, invocationId, 1000);
      writer.append({ actor, invocationId, incarnation: 1, atMs: 1001, stream: "stdout", bytes: Buffer.from(`exact ${actor} log\r\n`) }); writer.close();
    }
    function* logs(actor: string): Generator<ResidentLogFileObservation> {
      if (actor === "bob" && point === "enumeration") throw failure;
      for (const observation of spool.files(actor)) {
        if (actor !== "bob") { yield observation; continue; }
        if (point === "unavailable-result" || point === "ordinary-eio") { yield { kind: "unavailable", name: null, error: failure }; continue; }
        if (observation.kind === "file") yield { kind: "file", file: { ...observation.file, *frames() { throw failure; } } };
        else yield observation;
      }
    }
    const records = new CollaborationStateViews(f.store, { ...f.sources, logs }, f.root, "demo"), observed = records.refresh(f.auth());
    const expectedGate = point === "ordinary-eio" ? "healthy" : "corrupt";
    assert.equal(gate.state, expectedGate);
    assert.ok(observed.coverage.includes("mail-history")); assert.ok(observed.coverage.includes("peers"));
    const health = readFileSync(join(observed.root, "logs/health.md"), "utf8");
    assert.match(health, /unavailable: 1/); assert.match(health, /Refresh: partial/);
    assert.match(readFileSync(join(observed.root, "logs/bob/index.md"), "utf8"), /unavailable=1|failures: 1/);
    const segmentRoot = join(observed.root, "logs/alice/segments"), shards = fs.readdirSync(segmentRoot);
    const log = shards.flatMap(shard => fs.readdirSync(join(segmentRoot, shard)).filter(name => name.endsWith(".log")).map(name => join(segmentRoot, shard, name)));
    assert.equal(log.length, 1); assert.equal(readFileSync(log[0]!, "utf8"), "exact alice log\r\n");
    assert.deepEqual(await f.mail.send(f.auth(), "before-diagnostics", message), accepted);
    if (point === "ordinary-eio") {
      assert.doesNotThrow(() => assertNewAcceptance(f.store)); await f.mail.send(f.auth(), "after-diagnostics", message);
      assert.equal(f.store.acceptedOperationPage().items.length, 2, "ordinary source EIO is not durable Store corruption");
    } else {
      assert.throws(() => assertNewAcceptance(f.store), { code: "STORE_CORRUPT" });
      await assert.rejects(f.mail.send(f.auth(), "after-diagnostics", message), { code: "STORE_CORRUPT" });
      assert.equal(f.store.acceptedOperationPage().items.length, 1);
    }
  });
}

test("007. Diagnostics: public projection refuses T before identity reads or source enumeration", t => {
  const f = fixture(t), auth = f.auth(); let identityReads = 0, enumerations = 0;
  const logs = new CollaborationLogViews(f.store, f.root, () => { enumerations++; return []; });
  t.mock.method(f.store, "getAgent", () => { identityReads++; throw new Error("identity read before T refusal"); });
  assert.throws(() => f.store.transaction(() => logs.publish(auth, "2026-11-01T00:00:00.000Z")),
    { code: "INTERNAL_ERROR", message: "diagnostic log publication cannot run in T" });
  assert.equal(identityReads, 0); assert.equal(enumerations, 0);
  assert.equal(existsSync(join(f.root, "agents/alice/records")), false);
});

test("008. Diagnostics: Principal refusal precedes Worker enumeration and creates no diagnostic records", t => {
  const f = fixture(t); let enumerations = 0;
  const logs = new CollaborationLogViews(f.store, f.root, () => { enumerations++; throw new Error("Principal must not enumerate diagnostics"); });
  assert.throws(() => logs.publish(f.auth("principal"), "2026-11-01T00:00:00.000Z"), { code: "CAPABILITY_DENIED" });
  assert.equal(enumerations, 0); assert.equal(f.store.acceptedOperationPage().items.length, 0);
  assert.equal(existsSync(join(f.root, "agents/principal/records")), false);
});

for (const selected of [false, true]) {
  test(`009. Records boundary: actual broker composition ${selected ? "selected Worker startup/reconnect" : "legacy compatibility"} preserves original prepared batches`, async t => {
    const f = fixture(t), views = new ViewsModule(f.store, f.root, "demo", "p", TEST_VIEW_LIMITS); views.bindCollaborationRecords(f.sources);
    const units = {
      pin: () => { throw new Error("this observation test creates no execution scope"); },
      collaborationRecordsSelected: (actor: string) => selected && actor === "bob",
      observe: () => { throw new Error("execution is not observed by this boundary fixture"); }, scopeRoot: () => null, runnerAlive: () => false,
      readLogs: async () => ({ text: "", truncated: false, observedAtMs: Date.now() }), bindRunRevoker: () => {},
      observeStatus: async (actors: readonly string[]) => new Map(actors.map(actor => [actor, "no-unit" as const])),
    } satisfies BrokerExecution;
    // No listener/process is launched: exercise the real composition's prepared
    // delivery boundary, not OS confinement or a live provider session.
    const broker = createBroker({ store: f.store, mail: f.mail, views, units, lifecycle: f.sources.lifecycle as LifecycleModule,
      git: f.git, reviews: null, reconcile: null, paths: { stateRoot: f.root, runRoot: join(f.root, "run"), society: "demo", hasGoal: () => false },
      limits: TEST_PROTOCOL_LIMITS, lock: { assertHeld: () => {} } as unknown as ProcessLock });
    const dependencies = Reflect.get(broker, "dependencies") as BrokerDependencies;
    await f.mail.send(f.auth(), "boundary-mail", { to: ["bob"], subject: "boundary", body: "exact boundary body", kind: "message" });
    const batch = await dependencies.internal.mail.prepare(f.auth("bob")); assert.ok(batch);
    const delivery = f.store.getDelivery(batch.messageIds[0]!, "bob");
    assert.equal(existsSync(join(f.root, "agents/bob/records/README.md")), selected);
    const retried = await dependencies.internal.mail.prepare({ ...f.auth("bob"), peer: { ...f.auth("bob").peer } });
    assert.equal(retried?.id, batch.id); assert.deepEqual(f.store.getDelivery(batch.messageIds[0]!, "bob"), delivery);
    assert.equal(delivery!.acknowledged, 0);
    if (selected) assert.equal(readFileSync(join(f.root, "agents/bob/records/mail/messages", `${batch.messageIds[0]}.md`), "utf8"), "exact boundary body");
  });
}

for (const point of ["immutable-goal", "current-goal", "goal-status", "health"] as const) {
  test(`010. State: interrupted ${point} publication retries actual canonical bytes without a new acceptance`, async t => {
    const f = fixture(t), goal = Buffer.from("# GOAL\ninterrupted exact bytes\n"); await f.publish("goal", goal);
    const receipt = f.store.getOperation("principal", "goal")!.resultJson;
    const original = fs.writeFileSync; let bodyWrites = 0, injected = false;
    fs.writeFileSync = new Proxy(original, { apply(target, receiver, args) {
      const value = args[1];
      const match = point === "health" ? typeof value === "string" && value.startsWith("# Collaboration records health\n")
        : point === "goal-status" ? typeof value === "string" && value.includes('"contextRevision"') && value.includes('"bodySha256"') && value.includes('"exactPath": "/oma/goal/revisions/')
        : Buffer.isBuffer(value) && value.equals(goal) && ++bodyWrites === (point === "current-goal" ? 2 : 1);
      if (!injected && match) { injected = true; throw Object.assign(new Error(`injected ${point}`), { code: "EIO" }); }
      return Reflect.apply(target, receiver, args);
    } });
    syncBuiltinESMExports();
    try { assert.throws(() => f.records.refresh(f.auth()), { code: "EIO" }); }
    finally { fs.writeFileSync = original; syncBuiltinESMExports(); }
    assert.ok(injected, "the named real physical write must be reached"); assert.match(f.records.failure("alice")!, /could not refresh/);
    const fresh = new CollaborationStateViews(f.store, f.sources, f.root, "demo");
    const recovered = fresh.refresh(f.auth());
    assert.deepEqual(readFileSync(join(recovered.root, "goal/GOAL.md")), goal);
    assert.equal(f.store.getOperation("principal", "goal")!.resultJson, receipt);
    assert.equal(fresh.failure("alice"), null);
  });
}

test("011. Peers: bounded immutable pages retain every registry row and a failed refresh preserves discovery", async t => {
  const f = fixture(t);
  f.store.transaction(tx => { for (let i = 0; i < 180; i++) tx.insertAgent(makeValidAgent(`peer-${i.toString().padStart(3, "0")}`)); });
  const stableSources = { ...f.sources, lifecycle: { creation: () => ({ ...f.sources.lifecycle.creation(f.auth()), observedAtMs: 1700000000000 }) } };
  const records = new CollaborationStateViews(f.store, stableSources, f.root, "demo", 4096);
  const published = records.refresh(f.auth(), undefined, undefined, 1700000000000);
  const firstPath = join(published.root, "peers/index.md"), first = readFileSync(firstPath);
  const visited = new Set<string>(), names: string[] = [];
  let page = first.toString("utf8");
  for (;;) {
    assert.ok(Buffer.byteLength(page) <= 4096, "a page must fit the effective UTF-8 presentation budget");
    names.push(...[...page.matchAll(/^(alice|bob|peer-\d+) \|/gm)].map(match => match[1]!));
    const next = /Rows: \d+; More: (.+)/.exec(page)?.[1]; assert.ok(next);
    if (next === "none") break;
    assert.ok(next.startsWith("/oma/peers/pages/")); assert.ok(!visited.has(next)); visited.add(next);
    page = readFileSync(join(published.root, next.slice("/oma/".length)), "utf8");
  }
  assert.ok(visited.size > 1);
  assert.deepEqual(names.sort(), ["alice", "bob", ...Array.from({ length: 180 }, (_, i) => `peer-${i.toString().padStart(3, "0")}`)].sort());
  assert.equal(new Set(names).size, 182);
  // A failed independently timed execution observation cannot replace the old
  // bounded discovery with a truncated row or an empty registry.
  records.refresh(f.auth(), { observedAtMs: 1700000000001, units: new Map([["bob", { activeState: "unknown", subState: "unknown", result: "x".repeat(5000), execMainStatus: 0, invocationId: "", scope: "" }]]), failure: null });
  assert.deepEqual(readFileSync(firstPath), first);
  assert.match(readFileSync(join(published.root, "health.md"), "utf8"), /peers \[LIMIT_EXCEEDED\]/);
  const reopened = new CollaborationStateViews(f.store, stableSources, f.root, "demo", 4096);
  reopened.refresh(f.auth(), undefined, undefined, 1700000000000);
  assert.deepEqual(readFileSync(firstPath), first, "rebuilding the same observation reuses its immutable pages");
  const principal = reopened.refresh(f.auth("principal"));
  assert.equal(existsSync(join(principal.root, "peers")), false);
  assert.equal(f.store.acceptedOperationPage().items.length, 0);
});

test("012. Subscriptions: bounded page traversal keeps every current route and never widens Principal records", t => {
  const f = fixture(t), topics = Array.from({ length: 160 }, (_, i) => `topic-${i}-${"a".repeat(40)}`);
  f.store.transaction(tx => { for (const topic of topics) tx.follow(topic, "alice"); });
  const records = new CollaborationStateViews(f.store, f.sources, f.root, "demo", 4096), observed = records.refresh(f.auth());
  let page = readFileSync(join(observed.root, "subscriptions.md"), "utf8");
  const actual: string[] = [], visited = new Set<string>();
  for (;;) {
    assert.ok(Buffer.byteLength(page) <= 4096);
    actual.push(...[...page.matchAll(/^- (.+)$/gm)].map(match => match[1]!));
    const next = /Rows: \d+; More: (.+)/.exec(page)?.[1]; assert.ok(next);
    if (next === "none") break;
    assert.ok(next.startsWith("/oma/subscriptions/pages/")); assert.ok(!visited.has(next)); visited.add(next);
    page = readFileSync(join(observed.root, next.slice("/oma/".length)), "utf8");
  }
  assert.ok(visited.size > 0); assert.deepEqual(actual.sort(), ["runtime", ...topics].sort());
  const principal = records.refresh(f.auth("principal"));
  assert.equal(existsSync(join(principal.root, "subscriptions.md")), false);
  assert.equal(existsSync(join(principal.root, "subscriptions")), false);
});

for (const family of ["peers", "subscriptions"] as const) for (const boundary of ["page", "discovery"] as const)
  test(`013. State index: interrupted ${family} ${boundary} retains the last discovery and retries without changing accepted facts`, async t => {
    const f = fixture(t);
    const accepted = await f.mail.send(f.auth(), "accepted", { to: ["bob"], subject: "Original", body: "exact bytes", kind: "message" });
    const sources = { ...f.sources, lifecycle: { creation: () => ({ ...f.sources.lifecycle.creation(f.auth()), observedAtMs: 1700000000000 }) } };
    const records = new CollaborationStateViews(f.store, sources, f.root, "demo");
    const before = records.refresh(f.auth(), undefined, undefined, 1700000000000);
    const index = join(before.root, family === "peers" ? "peers/index.md" : "subscriptions.md"), old = readFileSync(index);
    f.store.transaction(tx => { if (family === "peers") tx.insertAgent(makeValidAgent("new-peer")); else tx.follow("new-route", "alice"); });
    const original = fs.writeFileSync; let injected = false;
    fs.writeFileSync = new Proxy(original, { apply(target, receiver, args) {
      const value = args[1], title = family === "peers" ? "# Peers\n" : "# Your topic subscriptions\n";
      if (!injected && (boundary === "page" ? Buffer.isBuffer(value) && value.toString().startsWith(title) : typeof value === "string" && value.startsWith(title))) {
        injected = true; Reflect.apply(target, receiver, args);
        throw Object.assign(new Error("interrupted record publication"), { code: "EIO" });
      }
      return Reflect.apply(target, receiver, args);
    } });
    syncBuiltinESMExports();
    try { records.refresh(f.auth(), undefined, undefined, 1700000000001); }
    finally { fs.writeFileSync = original; syncBuiltinESMExports(); }
    assert.ok(injected); assert.deepEqual(readFileSync(index), old);
    assert.match(readFileSync(join(before.root, "health.md"), "utf8"), new RegExp(`${family} \\[BROKER_UNAVAILABLE\\]|${family} \\[INTERNAL_ERROR\\]`));
    const fresh = new CollaborationStateViews(f.store, sources, f.root, "demo");
    for (let i = 0; i < 2; i++) fresh.refresh(f.auth(), undefined, undefined, 1700000000001);
    assert.match(readFileSync(index, "utf8"), family === "peers" ? /new-peer/ : /new-route/);
    assert.deepEqual(await f.mail.send(f.auth(), "accepted", { to: ["bob"], subject: "Original", body: "exact bytes", kind: "message" }), accepted);
    assert.equal(f.store.acceptedOperationPage().items.length, 1);
  });
