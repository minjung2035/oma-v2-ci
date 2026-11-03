/** Real SDK JSONL + Client/Transport + production broker composition/dispatcher +
 * Store/Mail/filesystem. The channel supplies an authenticated test peer, not an
 * OS socket/kernel-scope or provider qualification. */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Store } from "@oma/storage";
import type { AuthContext, Json, Request } from "@oma/contracts";
import type { InvocationOrigin } from "@oma/contracts/public-wire";
import { Client } from "@oma/client";
import { installRuntime, type ChannelPort } from "@oma/client/runtime";
import { PublicDispatcher } from "@oma/broker/public-dispatcher";
import type { LifecycleModule } from "@oma/lifecycle";
import type { ProcessLock } from "@oma/native/process-lock";
import { sessionDirPathAt } from "@oma/domain/paths";
import { decodeRpcReply } from "@oma/protocol/response-codec";
import { createBroker, type BrokerExecution } from "#oma-test/app/broker/broker-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import { CLIENT_RUNTIME } from "#oma-test/app/runtime/client-runtime";
import { invocationTextMail } from "#oma-test/app/runtime/host-invocations";
import { HostInvocations } from "#oma-test/app/runtime/host-invocations";
import { createInvocationSources } from "#oma-test/app/broker/invocation-sources";
import { fixture as reviewFixture } from "./fixtures/review-fixture.js";
import { nativeQuarantine } from "./fixtures/git-crash.js";
import { sha256Hex } from "@oma/domain/canonical-json";
import { exportRefForRequestKey } from "@oma/domain/derived";
import { submissionPublicationKey } from "@oma/protocol/invocation-submission";
import { newSessionBirth, publishSessionBirth } from "#oma-test/app/runtime/session-mode";
import { RequestCache } from "#oma-test/app/request-cache";
import { ViewsModule } from "#oma-test/app/views";
import { makeValidAgent, ALL_CAPS } from "./fixtures/spec.js";
import { TEST_PROTOCOL_LIMITS } from "./fixtures/limits.js";
import { removeTree } from "./fixtures/cleanup.js";

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const args: Json = { to: ["bob", "bob"], content: { kind: "text", value: "\ufeffexact body\r\n\n" }, subject: "" };
function addCall(manager: SessionManager, id: string, input: Json = args, name = "oma_send"): InvocationOrigin {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new Error("normal tool-call fixture must be a JSON object");
  manager.appendMessage({ role: "assistant", content: [{ type: "toolCall", id, name, arguments: input }],
    api: "openai-completions", provider: "openai", model: "journal-fixture", usage, stopReason: "toolUse", timestamp: Date.now() });
  return { file: basename(manager.getSessionFile()!), session: manager.getSessionId(), branch: manager.getLeafId()!, toolCall: id };
}
function fixture(t: TestContext, selected = true) {
  const parent = fs.mkdtempSync(join(tmpdir(), "oma-host-invocation-")), root = join(parent, "demo"); fs.mkdirSync(root);
  publishSessionBirth(root, newSessionBirth(root, "society", parent));
  let store = new Store(join(root, "runtime.sqlite"), 0, { society: "demo" });
  store.transaction(tx => { for (const name of ["alice", "bob", "principal"]) tx.insertAgent(makeValidAgent(name)); });
  let mail = createMailModule({ stateRoot: root, society: "demo" }, store, 16, 24, TEST_PROTOCOL_LIMITS);
  const auth: AuthContext = { actor: "alice", role: "resident", incarnation: 1, channel: "actor", capabilities: new Set(ALL_CAPS),
    peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } };
  const sessionRoot = sessionDirPathAt(root, "alice"), home = join(root, "agents/alice/home");
  fs.mkdirSync(sessionRoot, { recursive: true }); fs.mkdirSync(home, { recursive: true });
  const manager = SessionManager.create(join(root, "agents/alice/workspace"), sessionRoot);
  let views = new ViewsModule(store, root, "demo", "p");
  const units: BrokerExecution = { pin: () => { throw new Error("no kernel scope in this channel fixture"); },
    collaborationRecordsSelected: actor => selected && actor === "alice",
    observe: () => { throw new Error("no process observation in this channel fixture"); }, scopeRoot: () => null,
    runnerAlive: () => false, readLogs: async () => ({ text: "", truncated: false, observedAtMs: Date.now() }), bindRunRevoker: () => {},
    observeStatus: async actors => new Map(actors.map(actor => [actor, "no-unit" as const])) };
  const makeBroker = () => createBroker({ store, mail, units, views,
    lifecycle: { creation: () => ({ capability: false, childProfile: null, childHasMailSend: null, observedAtMs: Date.now(), maxWorkers: 6, workerCount: 2 }) } as unknown as LifecycleModule,
    git: null, reviews: null, reconcile: null, paths: { stateRoot: root, runRoot: join(root, "run"), society: "demo", hasGoal: () => false },
    limits: TEST_PROTOCOL_LIMITS, lock: { assertHeld: () => {} } as unknown as ProcessLock });
  let dispatcher = Reflect.get(makeBroker(), "publicDispatcher") as PublicDispatcher;
  const control = { dropBefore: false, dropAfter: false, lookupUnavailable: false, effects: 0, builds: 0, sequence: 0, dropped: false };
  installRuntime({ ...CLIENT_RUNTIME, channel: (): ChannelPort => ({ connect: async () => {}, close: () => {},
    call: async (method, params, options) => {
      if (method === "principal.attach") throw new Error("no Principal grant in this fixture");
      if (method === "operation.get" && control.lookupUnavailable) throw new Error("injected original lookup loss");
      if (method === "mail.send") {
        control.effects++;
        if (control.dropBefore) { control.dropped = true; throw new Error("injected loss before original acceptance"); }
      }
      const id = `request-${++control.sequence}`;
      // SAFETY: raw wire DTO only; the production dispatcher performs validation.
      const request = JSON.parse(JSON.stringify({ v: 1, id, method, params, ...(options?.request === undefined ? {} : { request: options.request }) })) as Request;
      const response = await dispatcher.dispatch(auth, request, null);
      if (method === "mail.send" && control.dropAfter) { control.dropped = true; control.lookupUnavailable = true; throw new Error("injected loss after original acceptance"); }
      return decodeRpcReply(method, response, id, params);
    } }) });
  const client = () => new Client({ cwd: parent, env: { HOME: home, OMA_ACTOR: auth.actor, OMA_SOCKET: "/test-peer/control.sock" } });
  const invoke = (origin: InvocationOrigin, input: Json = args) => client().invocationReceipt("oma_send", origin, input,
    () => { control.builds++; return { method: "mail.send", params: { ...invocationTextMail(input) } }; }, () => ({}));
  const cache = () => new RequestCache(join(root, "host-invocations/alice"));
  t.after(() => { installRuntime(CLIENT_RUNTIME); store.close(); removeTree(parent); });
  return { root, get store() { return store; }, get mail() { return mail; }, auth, manager, home, sessionRoot, control, client, invoke, cache,
    restart: () => {
      store.close();
      store = new Store(join(root, "runtime.sqlite"), 0, { society: "demo" });
      mail = createMailModule({ stateRoot: root, society: "demo" }, store, 16, 24, TEST_PROTOCOL_LIMITS);
      views = new ViewsModule(store, root, "demo", "p");
      dispatcher = Reflect.get(makeBroker(), "publicDispatcher") as PublicDispatcher;
    },
    raw: (other: AuthContext, request: Request) => dispatcher.dispatch(other, request, null) };
}

for (const absentLocal of [false, true]) test(`001. Host invocation: changed protected freeze date fences original replay${absentLocal ? " and absent-cache handoff" : ""}`, async t => {
  const f = fixture(t), origin = addCall(f.manager, `call-date-${absentLocal}`);
  f.control.dropBefore = true;
  await assert.rejects(f.invoke(origin), /Acceptance status unknown/);
  const cache = f.cache(), bindings = [...cache.invocationRecords()]; assert.equal(bindings.length, 1);
  const binding = bindings[0]!, frozen = cache.read(binding.key); assert.equal(frozen.kind, "present");
  if (frozen.kind !== "present") return;
  assert.equal(frozen.value.createdAtMs, binding.createdAtMs);
  const path = cache.bodyPath(binding.key).replace(/\.body$/u, ".json");
  const changed = JSON.stringify({ ...frozen.value, createdAtMs: binding.createdAtMs + 1 }); fs.writeFileSync(path, changed);
  const local = new RequestCache(f.home), localPath = local.bodyPath(binding.key).replace(/\.body$/u, ".json");
  if (absentLocal) fs.unlinkSync(localPath);
  const localBefore = absentLocal ? null : fs.readFileSync(localPath);
  assert.throws(() => cache.sealInvocation(binding.key), { code: "CACHE_CORRUPT", message: "original invocation freeze identity changed" });
  f.restart(); f.control.dropBefore = false;
  await assert.rejects(f.invoke(origin), /BROKER_UNAVAILABLE/);
  assert.equal(f.control.effects, 1); assert.equal(f.control.builds, 1);
  assert.equal(f.store.acceptedOperationPage().items.length, 0);
  assert.equal(fs.readFileSync(path, "utf8"), changed, "protected corruption is retained, never repaired");
  assert.deepEqual(cache.readInvocation(binding.key), { kind: "present", value: binding });
  if (localBefore === null) assert.equal(fs.existsSync(localPath), false, "a changed original date cannot be copied to an absent caller cache");
  else assert.deepEqual(fs.readFileSync(localPath), localBefore);
});

test("002. Host invocation: a changed protected freeze date does not erase canonical accepted receipt observation", async t => {
  const f = fixture(t), origin = addCall(f.manager, "call-accepted-date"); f.control.dropAfter = true;
  await assert.rejects(f.invoke(origin), /Acceptance status unknown/);
  const cache = f.cache(), binding = [...cache.invocationRecords()][0]!;
  const frozen = cache.read(binding.key); assert.equal(frozen.kind, "present"); if (frozen.kind !== "present") return;
  const canonical = f.store.getOperation("alice", binding.key)!;
  const path = cache.bodyPath(binding.key).replace(/\.body$/u, ".json"), changed = JSON.stringify({ ...frozen.value, createdAtMs: binding.createdAtMs + 1 });
  fs.writeFileSync(path, changed); f.restart(); f.control.lookupUnavailable = false;
  const receipt = await f.invoke(origin);
  assert.equal(receipt.operation, canonical.id); assert.equal(f.control.effects, 1); assert.equal(f.control.builds, 1);
  assert.equal(f.store.acceptedOperationPage().items.length, 1);
  assert.equal(fs.readFileSync(path, "utf8"), changed);
});

test("003. Host invocation: canonical publication permits original Review metadata handoff without its obsolete bundle, not parent acceptance", async t => {
  const parent = fs.mkdtempSync(join(tmpdir(), "oma-compound-recovery-")), stateRoot = join(parent, "demo");
  const f = reviewFixture({ stateRoot, quarantine: nativeQuarantine({ stateRoot, projectGit: join(stateRoot, "repos/project.git"),
    contextGit: join(stateRoot, "context.git"), worldDir: join(stateRoot, "world"), society: "demo" }) });
  t.after(() => f.close()); t.after(() => removeTree(parent));
  publishSessionBirth(f.root, newSessionBirth(f.root, "society", parent, "collaboration-v1"));
  const acceptedIdentities = () => f.store.acceptedOperationPage().items.map(({ operation }) => ({ id: operation.id,
    actor: operation.actor, key: operation.requestKey, kind: operation.kind }));
  const baseline = acceptedIdentities();
  const home = join(f.root, "agents/alice/home"), sessions = sessionDirPathAt(f.root, "alice");
  fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(sessions, { recursive: true });
  const manager = SessionManager.create(join(f.root, "agents/alice/workspace"), sessions);
  const candidate = f.candidateWith({ "change.txt": "original committed change\n" }), reason = "Original evidence", title = "Original proposal";
  const input: Json = { change: { candidate, base: f.base }, reason, title, tier: "LOW" };
  const origin = addCall(manager, "call-compound-recovery", input, "oma_merge"), auth = f.auth("alice");
  const makeHost = () => new HostInvocations(f.store, f.root, "demo", actor => actor === "alice", 2 * TEST_PROTOCOL_LIMITS.frameBytes,
    TEST_PROTOCOL_LIMITS.subjectBytes, oid => f.module.isPublished(oid), createInvocationSources(f.root, "demo", TEST_PROTOCOL_LIMITS, f.mail, f.reviews, f.module));
  let host = makeHost();
  const bound = await host.bind(auth, { contract: "collaboration-v1", tool: "oma_merge", arguments: input, origin });
  const child = submissionPublicationKey(bound.key), exportRef = exportRefForRequestKey(child), bundlePath = join(f.root, "original.bundle");
  f.git(["update-ref", exportRef, candidate]); f.git(["bundle", "create", bundlePath, exportRef]);
  const bundle = fs.readFileSync(bundlePath), descriptor = { mediaType: "application/x-git-bundle" as const, bytes: bundle.byteLength, sha256: sha256Hex(bundle) };
  const review = { kind: "merge.open" as const, candidate, base: f.base, reason, title, tier: "LOW" as const };
  const publication = { candidate, exportRef, prerequisites: [], to: ["alice"], paths: [], subject: title, body: reason, bundle: descriptor };
  const frozen = { kind: "collaboration.submission", review, publication: { key: child, params: publication } };
  const bytes = async function* () { yield bundle; };
  const prepared = await host.prepare(auth, { contract: "collaboration-v1", key: bound.key, params: frozen, content: descriptor }, bytes());
  assert.equal(prepared.phase, "sending");
  assert.equal(host.guardMutation(auth, child, "git.submit", publication), true);
  const receipt = await f.module.submit(auth, child, publication, bytes());
  assert.equal(receipt.state, "succeeded"); host.recordMutation(auth, child, "git.submit", receipt);
  const protectedCache = new RequestCache(join(f.root, "host-invocations/alice")), original = protectedCache.read(bound.key);
  assert.equal(original.kind, "present"); if (original.kind !== "present") return;
  fs.unlinkSync(protectedCache.bodyPath(bound.key));
  assert.equal(new RequestCache(home).read(bound.key).kind, "absent");
  f.reopen(); host = makeHost();
  const recovered = await host.bind(auth, { contract: "collaboration-v1", tool: "oma_merge", arguments: input, origin });
  assert.equal(recovered.key, bound.key); assert.equal(recovered.phase, "sending");
  assert.deepEqual(recovered.publication?.receipt, receipt);
  const local = new RequestCache(home), copied = local.read(bound.key);
  assert.deepEqual(copied, original);
  assert.equal(local.readBody(bound.key, { bytes: descriptor.bytes, sha256: descriptor.sha256 }).kind, "absent");
  assert.equal(protectedCache.readBody(bound.key, { bytes: descriptor.bytes, sha256: descriptor.sha256 }).kind, "absent");
  assert.equal(f.store.getOperation(auth.actor, bound.key), null, "publication and cache handoff do not accept the Review");
  assert.equal(f.git(["rev-parse", "refs/heads/main"]), f.base, "child publication is not main integration");
  await host.prepare(auth, { contract: "collaboration-v1", key: bound.key, params: frozen });
  assert.equal(host.guardMutation(auth, bound.key, "attest.record", review), true);
  await assert.rejects(f.reviews.record({ ...auth, capabilities: new Set() }, bound.key, review, host.reviewExpectation(auth, bound.key)), { code: "CAPABILITY_DENIED" });
  assert.equal(f.store.getOperation(auth.actor, bound.key), null, "a child receipt does not grant fresh Review authority");
  const accepted = await f.reviews.record(auth, bound.key, review, host.reviewExpectation(auth, bound.key));
  assert.equal(accepted.state, "succeeded"); host.recordMutation(auth, bound.key, "attest.record", accepted);
  assert.equal((await host.bind(auth, { contract: "collaboration-v1", tool: "oma_merge", arguments: input, origin })).phase, "observed");
  const observed = protectedCache.readInvocation(bound.key); assert.equal(observed.kind, "present");
  if (observed.kind === "present") assert.deepEqual(observed.value.receipt, accepted);
  const refreshKey = `~refresh.${accepted.operation}.0`, applyKey = `~apply.${accepted.operation}`;
  const refresh = f.store.getOperation(auth.actor, refreshKey), applied = f.store.getOperation(auth.actor, applyKey);
  if (refresh?.kind !== "attest.record" || refresh.plan.fact.kind !== "review.integration" || applied?.kind !== "git.integrate")
    assert.fail("the original LOW policy must retain its exact broker-derived preparation and integration");
  assert.equal(refresh.plan.fact.request, accepted.operation); assert.equal(refresh.state, "succeeded");
  assert.equal(refresh.plan.fact.sourceOperation, accepted.operation);
  assert.equal(refresh.plan.fact.source.candidate, candidate); assert.equal(refresh.plan.fact.source.expectedBase, f.base);
  if (applied.plan.merge?.version !== 3) assert.fail("selected Review integration must retain its versioned preparation link");
  assert.equal(applied.plan.merge?.preparation, refresh.id);
  assert.equal(applied.plan.merge?.request, accepted.operation); assert.equal(applied.state, "succeeded");
  assert.equal(applied.plan.base, f.base); assert.equal(applied.plan.candidate, candidate);
  assert.deepEqual(acceptedIdentities(), [...baseline,
    { id: receipt.operation, actor: auth.actor, key: child, kind: "git.submit" },
    { id: accepted.operation, actor: auth.actor, key: bound.key, kind: "attest.record" },
    { id: refresh.id, actor: auth.actor, key: refreshKey, kind: "attest.record" },
    { id: applied.id, actor: auth.actor, key: applyKey, kind: "git.integrate" }],
    "only original invocations and their exact original Review-derived effects may exist; no replacement invocation");
});

test("004. Host invocation: typed Client and production broker pin exact SDK call, body, original key and receipt across a fresh host owner", async t => {
  const f = fixture(t), origin = addCall(f.manager, "call-original");
  const journal = fs.readFileSync(join(f.sessionRoot, origin.file));
  const first = await f.invoke(origin); assert.equal(first.state, "succeeded");
  const operation = f.store.getOperationById(first.operation!)!;
  assert.match(operation.requestKey, /^inv1-[a-f0-9]{64}$/);
  assert.equal(f.cache().readInvocation(operation.requestKey).kind, "present");
  assert.ok(first.result?.kind === "mail.send");
  const message = f.mail.readRecord(f.auth.actor, first.result.message);
  assert.equal(message.state, "published");
  if (message.state === "published") assert.equal(message.record.body, "\ufeffexact body\r\n\n");
  const delivery = f.store.deliveriesForOperation(operation.id); assert.equal(delivery[0]!.acknowledged, 0);
  f.restart(); const replay = await f.invoke(origin);
  assert.equal(replay.operation, first.operation); assert.equal(f.control.builds, 1); assert.equal(f.control.effects, 1);
  assert.deepEqual(fs.readFileSync(join(f.sessionRoot, origin.file)), journal, "host inspection must not rewrite SDK history");
  assert.deepEqual(f.store.deliveriesForOperation(operation.id), delivery);
  const later = await f.invoke(addCall(f.manager, "call-later")); assert.notEqual(later.operation, first.operation);
});

test("005. Host invocation: real SDK fork reuses copied original assistant identity, while a later fork call is new", async t => {
  const f = fixture(t), origin = addCall(f.manager, "call-fork"), first = await f.invoke(origin);
  f.manager.createBranchedSession(origin.branch);
  const fork = { ...origin, file: basename(f.manager.getSessionFile()!), session: f.manager.getSessionId() };
  assert.notEqual(fork.session, origin.session);
  f.restart(); assert.equal((await f.invoke(fork)).operation, first.operation);
  assert.notEqual((await f.invoke(addCall(f.manager, "call-new-fork"))).operation, first.operation);
});

test("006. Host invocation: acceptance unknown fences changed wording at another call, then original-key absence permits original freeze only", async t => {
  const f = fixture(t), origin = addCall(f.manager, "call-unknown"); f.control.dropBefore = true; f.control.lookupUnavailable = true;
  await assert.rejects(f.invoke(origin), /Acceptance status unknown/); assert.equal(f.control.dropped, true);
  const other: Json = { to: ["bob"], content: { kind: "text", value: "changed wording" } };
  const second = addCall(f.manager, "call-other", other); f.control.dropBefore = false;
  await assert.rejects(f.invoke(second, other), { code: "BROKER_UNAVAILABLE" });
  const pending = f.cache().pendingInvocations(); assert.equal(pending.length, 1);
  assert.equal(pending[0]!.toolCall, origin.toolCall); assert.equal(pending[0]!.phase, "sending");
  assert.equal(f.store.acceptedOperationPage().items.length, 0);
  assert.equal(f.control.effects, 1, "new call must not reach effect transport");
  f.control.lookupUnavailable = false; f.restart();
  const recovered = await f.invoke(origin); assert.equal(recovered.state, "succeeded");
  assert.equal(f.control.builds, 2, "original source builder is not rerun");
  const next = await f.invoke(second, other); assert.notEqual(next.operation, recovered.operation);
});

test("007. Host invocation: lost accepted reply and corrupt local/protected freeze still permit independent original receipt observation", async t => {
  const f = fixture(t), origin = addCall(f.manager, "call-lost"); f.control.dropAfter = true;
  await assert.rejects(f.invoke(origin), /Acceptance status unknown/); assert.equal(f.control.dropped, true);
  const [row] = f.store.acceptedOperationPage().items; assert.ok(row);
  const operation = f.store.getOperationById(row.operation.id)!;
  fs.writeFileSync(f.cache().bodyPath(operation.requestKey).replace(/\.body$/u, ".json"), "corrupt protected freeze");
  const local = new RequestCache(f.home); fs.writeFileSync(local.bodyPath(operation.requestKey).replace(/\.body$/u, ".json"), "corrupt mutable freeze");
  f.control.dropAfter = false; f.control.lookupUnavailable = false; f.restart();
  assert.equal((await f.invoke(origin)).operation, operation.id);
  assert.equal(f.control.builds, 1); assert.equal(f.control.effects, 1);
  assert.equal(f.cache().read(operation.requestKey).kind, "corrupt", "observation must not repair source evidence");
});

test("008. Host invocation: guessed session/branch/call, traversal, forged role, unselected session and raw mail bypass are refused", async t => {
  const f = fixture(t), origin = addCall(f.manager, "call-real");
  for (const altered of [{ ...origin, file: "../other.jsonl" }, { ...origin, session: "guessed" }, { ...origin, branch: "deadbeef" }, { ...origin, toolCall: "guessed" }])
    await assert.rejects(f.invoke(altered));
  await assert.rejects(f.client().invocationReceipt("oma_spawn", origin, { name: "x", from: "HEAD", brief: { kind: "text", value: "brief" } },
    () => { throw new Error("unsupported driver must never read source"); }, () => ({})));
  const bindingParams = { contract: "collaboration-v1" as const, origin, tool: "oma_send", arguments: args };
  const forged = await f.raw({ ...f.auth, role: "principal" }, { v: 1, id: "forged-role", method: "invocation.bind", params: bindingParams });
  const denied = decodeRpcReply("invocation.bind", forged, "forged-role", bindingParams);
  assert.equal(denied.ok, false); if (!denied.ok) assert.equal(denied.error.code, "AUTH_FAILED");
  await assert.rejects(f.client().sendMail({ to: ["bob"], subject: "bypass", kind: "message", body: "bypass" }, "fresh-legacy-key"));
  assert.equal(f.store.acceptedOperationPage().items.length, 0);
  const legacy = fixture(t, false), legacyOrigin = addCall(legacy.manager, "call-legacy");
  await assert.rejects(legacy.invoke(legacyOrigin), { code: "CAPABILITY_DENIED" });
  const sent = await legacy.client().sendMail({ to: ["bob"], subject: "legacy", body: "unchanged", kind: "message" }, "legacy-still-works");
  assert.match(sent, /succeeded/); assert.equal(fs.existsSync(join(legacy.root, "host-invocations")), false);
});
test("009. Host invocation: original mail cannot be redirected through the legacy continue context", async t => {
  const f = fixture(t), input: Json = { to: ["alice"], content: { kind: "text", value: "same body" }, subject: "continue" };
  const origin = addCall(f.manager, "call-no-method-change", input); f.control.dropBefore = true; f.control.lookupUnavailable = true;
  await assert.rejects(f.invoke(origin, input), /Acceptance status unknown/);
  const [binding] = f.cache().pendingInvocations(); assert.ok(binding);
  const response = await f.raw(f.auth, { v: 1, id: "wrong-method", method: "agent.continue", request: binding.key, params: { note: "same body" } });
  const reply = decodeRpcReply("agent.continue", response, "wrong-method", { note: "same body" });
  assert.equal(reply.ok, false); if (!reply.ok) assert.equal(reply.error.code, "REQUEST_KEY_REUSED");
  assert.equal(f.store.acceptedOperationPage().items.length, 0);
});

test("010. Host invocation: missing completed host freeze is not reconstructed from the mutable caller's intact copy", async t => {
  const f = fixture(t), origin = addCall(f.manager, "call-missing-freeze"); f.control.dropBefore = true; f.control.lookupUnavailable = true;
  await assert.rejects(f.invoke(origin), /Acceptance status unknown/);
  const [binding] = f.cache().pendingInvocations(); assert.ok(binding);
  fs.unlinkSync(f.cache().bodyPath(binding.key).replace(/\.body$/u, ".json"));
  f.control.dropBefore = false; f.control.lookupUnavailable = false; f.restart();
  await assert.rejects(f.invoke(origin), { code: "BROKER_UNAVAILABLE" });
  assert.equal(f.cache().read(binding.key).kind, "absent");
  assert.equal(f.control.builds, 1); assert.equal(f.control.effects, 1);
  assert.equal(f.store.acceptedOperationPage().items.length, 0);
});


test("011. Host invocation: interrupted protected-home directory flush never reaches the source builder", async t => {
  const f = fixture(t), origin = addCall(f.manager, "call-home-flush"), original = fs.fsyncSync;
  let injected = false;
  fs.fsyncSync = new Proxy(original, { apply(target, receiver, values) {
    let path = ""; try { path = fs.readlinkSync(`/proc/self/fd/${String(values[0])}`); } catch { /* unrelated descriptor */ }
    if (!injected && path === join(f.root, "host-invocations")) {
      injected = true; throw Object.assign(new Error("injected protected-home parent fsync loss"), { code: "EIO" });
    }
    return Reflect.apply(target, receiver, values);
  } }); syncBuiltinESMExports();
  try { await assert.rejects(f.invoke(origin)); }
  finally { fs.fsyncSync = original; syncBuiltinESMExports(); }
  assert.equal(injected, true); assert.equal(f.control.builds, 0); assert.equal(f.control.effects, 0);
  assert.equal(f.store.acceptedOperationPage().items.length, 0);
  f.restart(); assert.equal((await f.invoke(origin)).state, "succeeded");
  assert.equal(f.store.acceptedOperationPage().items.length, 1);
});

for (const phase of ["bound", "frozen", "sending", "observed"] as const) {
  test(`012. Host invocation: interrupted ${phase} write at the production RPC boundary preserves one original operation`, async t => {
    const f = fixture(t), origin = addCall(f.manager, `call-fault-${phase}`), original = fs.fsyncSync;
    let injected = false;
    fs.fsyncSync = new Proxy(original, { apply(target, receiver, values) {
      let bytes = ""; try { bytes = fs.readFileSync(`/proc/self/fd/${String(values[0])}`, "utf8"); } catch { /* directory/other descriptor */ }
      if (!injected && bytes.includes('"identityVersion":1') && bytes.includes(`"phase":"${phase}"`)) {
        injected = true; throw Object.assign(new Error(`injected host ${phase} fsync loss`), { code: "EIO" });
      }
      return Reflect.apply(target, receiver, values);
    } }); syncBuiltinESMExports();
    try {
      if (phase === "observed") assert.equal((await f.invoke(origin)).state, "succeeded", "canonical recovery may finish the interrupted receipt checkpoint");
      else await assert.rejects(f.invoke(origin));
    }
    finally { fs.fsyncSync = original; syncBuiltinESMExports(); }
    assert.equal(injected, true, "the intended host binding fsync must be reached");
    assert.equal(f.store.acceptedOperationPage().items.length, phase === "observed" ? 1 : 0, "fault must occur on the intended side of acceptance");
    f.restart(); assert.equal((await f.invoke(origin)).state, "succeeded");
    assert.equal(f.store.acceptedOperationPage().items.length, 1);
  });
}
