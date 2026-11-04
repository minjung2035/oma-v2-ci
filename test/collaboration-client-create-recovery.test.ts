/** Actual SDK journal -> Client -> Unix RPC -> production Host/Lifecycle/Git/Mail.
 * Original native quarantine and workspace preparation are real. Auth, selection
 * and child-policy inputs are fixtures; no Worker/provider activation, whole
 * broker crash, power loss or peer-auth qualification is claimed. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createServer, type Socket } from "node:net";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Client } from "@oma/client";
import { installRuntime } from "@oma/client/runtime";
import type { AuthContext, Json, Request } from "@oma/contracts";
import { Store } from "@oma/storage";
import { TransportSpool } from "@oma/storage/transport-spool";
import { RpcConnection } from "@oma/broker/connection";
import { SharedPeerPin } from "@oma/broker/peer-pin";
import type { PublicDispatcher } from "@oma/broker/public-dispatcher";
import { ProcessLock } from "@oma/native/process-lock";
import { resolvedSpecOf } from "@oma/domain/agent-spec";
import { resolveChildSpec, resolveChildPolicy } from "@oma/domain/child-policy";
import { ClientError } from "@oma/client/errors";
import { sessionDirPathAt } from "@oma/domain/paths";
import { createRootId } from "@oma/domain/derived";
import { createBroker, type BrokerExecution } from "#oma-test/app/broker/broker-composition";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { CLIENT_RUNTIME } from "#oma-test/app/runtime/client-runtime";
import { newSessionBirth, publishSessionBirth } from "#oma-test/app/runtime/session-mode";
import { RequestCache } from "#oma-test/app/request-cache";
import { ViewsModule } from "#oma-test/app/views";
import { nativeLifecycleExecution, type NativeLifecycleExecution } from "./fixtures/native-lifecycle-execution.js";
import { gitFixture, gitAuth, seedGit, gitCommand } from "./fixtures/git-crash.js";
import { ALL_CAPS, makeValidAgent, makeValidResolvedSpec, withWorkerCapacity } from "./fixtures/spec.js";
import { TEST_PROTOCOL_LIMITS } from "./fixtures/limits.js";
import { removeTree } from "./fixtures/cleanup.js";

for (const loss of ["before-acceptance", "after-acceptance", "local-without-git-submit", "canonical-without-git-submit", "name-conflict", "stopped-name"] as const) {
  test(`001. Client create: ${loss}${loss.endsWith("without-git-submit") ? " preserves source-publication authority" : loss === "stopped-name" || loss === "name-conflict" ? " preserves the original Worker identity" : " resumes one original without caller files or a replacement Worker"}`, async t => {
    const parent = fs.mkdtempSync(join(tmpdir(), "oma-client-create-")), root = join(parent, "crash");
    fs.mkdirSync(root);
    seedGit(root);
    let store = new Store(join(root, "runtime.sqlite"));
    const base = gitCommand(root, ["--git-dir", join(root, "repos/project.git"), "rev-parse", "refs/heads/main"]);
    const capabilities = ALL_CAPS.filter(capability => capability !== "context.publish");
    store.transaction(tx => {
      tx.insertAgent(makeValidAgent("principal", { from: base }));
      tx.insertAgent(makeValidAgent("a", { from: base, capabilities, createdBy: "principal" }));
    });
    publishSessionBirth(root, newSessionBirth(root, "society", parent, "collaboration-v1"));
    const home = join(root, "agents/a/home"), workspace = join(root, "agents/a/workspace");
    fs.mkdirSync(home, { recursive: true });
    gitCommand(parent, ["clone", "--no-local", join(root, "repos/project.git"), workspace]);
    gitCommand(workspace, ["checkout", "--detach", base]);
    fs.writeFileSync(join(workspace, "change.txt"), "original child starting point\n");
    gitCommand(workspace, ["add", "change.txt"]);
    gitCommand(workspace, ["-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", "commit", "-m", "original source"]);
    const candidate = gitCommand(workspace, ["rev-parse", "HEAD"]);
    const brief = "\uFEFFOriginal independent task\r\nPreserve this exact brief.\r\n";
    fs.writeFileSync(join(workspace, "brief.md"), brief);
    const input: Json = { name: "child", from: loss === "canonical-without-git-submit" ? base : "HEAD", brief: { kind: "file", value: "brief.md" } };
    const sessions = sessionDirPathAt(root, "a"); fs.mkdirSync(sessions, { recursive: true });
    const manager = SessionManager.create(workspace, sessions);
    manager.appendMessage({ role: "assistant", content: [{ type: "toolCall", id: "original-spawn", name: "oma_spawn", arguments: input }],
      api: "openai-completions", provider: "openai", model: "journal-fixture", stopReason: "toolUse", timestamp: Date.now(),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    const origin = { file: basename(manager.getSessionFile()!), session: manager.getSessionId(), branch: manager.getLeafId()!, toolCall: "original-spawn" };
    const journal = fs.readFileSync(join(sessions, origin.file));
    let auth: AuthContext = { ...gitAuth, capabilities: new Set(loss.endsWith("without-git-submit") ? ["agent.create" as const] : capabilities) };
    const childPolicy = { maxWorkers: 6, agentProfiles: { p: { modelProfile: "md", capabilities, delegable: capabilities, childProfile: "p" } }, modelProfiles: { md: {} } };
    let units: NativeLifecycleExecution | undefined;
    let dispatcher: PublicDispatcher;
    let lock: ProcessLock | undefined;
    let builds = 0;
    const control = { lost: false, lose: true }, calls: { method: unknown; key: unknown }[] = [];
    const sockets = new Set<Socket>(), connections = new Set<RpcConnection>(), tasks = new Set<Promise<void>>();
    const cleanupErrors: unknown[] = [];
    const server = createServer(socket => {
      sockets.add(socket); socket.on("close", () => sockets.delete(socket));
      const connection = new RpcConnection({ socket, limits: TEST_PROTOCOL_LIMITS,
        peer: new SharedPeerPin(() => true, () => {}), preflight: raw => dispatcher.preflight(auth, raw),
        makeSpool: descriptor => new TransportSpool(join(root, "staging"), descriptor),
        handle: async (raw, body) => {
          calls.push({ method: raw.method, key: raw.request });
          if (control.lost && raw.method === "operation.get") { socket.destroy(); return {}; }
          if (control.lose && !control.lost && raw.method === "agent.create" && loss === "before-acceptance") {
            control.lost = true; socket.destroy(); return {};
          }
          // SAFETY: production dispatch validates this raw framed request.
          const response = await dispatcher.dispatch(auth, raw as unknown as Request, body);
          if (control.lose && !control.lost && raw.method === "agent.create" && loss === "after-acceptance") {
            control.lost = true; socket.destroy();
          }
          return response;
        },
        onTask: task => { tasks.add(task); void task.then(() => tasks.delete(task), error => { cleanupErrors.push(error); tasks.delete(task); }); },
        onClosed: () => connections.delete(connection), onCleanupError: error => cleanupErrors.push(error),
      });
      connections.add(connection);
    });
    t.after(async () => {
      installRuntime(CLIENT_RUNTIME);
      for (const connection of connections) connection.close();
      for (const socket of sockets) socket.destroy();
      await Promise.allSettled([...tasks]);
      try {
        if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      } finally { try { await units?.closeExecution(); } finally { lock?.close(); store.close(); removeTree(parent); } }
    });
    const connect = async (initialize: boolean) => {
      units = await nativeLifecycleExecution(store, root, { initialize });
      const owner = new AbortController(), f = gitFixture(root, store, { ownerSignal: owner.signal, execution: units.executionOwner });
      const policy = Object.assign(withWorkerCapacity((parent, value) => resolveChildSpec(childPolicy, parent, value)?.spec ?? null), {
        revision: () => "original-child-policy", observe: (parent: { name: string; profile: string; capabilities: readonly import("@oma/contracts").Capability[] }) => resolveChildPolicy(childPolicy, parent),
      });
      const lifecycle = createLifecycleModule(store, units, { ...f.paths, hasGoal: () => false,
        activationAllowed: () => false, ownerSignal: owner.signal }, policy, f.mail, f.git);
      const execution: BrokerExecution = Object.assign(units, {
        pin: () => { throw new Error("this transport fixture does not authenticate a live runner"); },
        collaborationRecordsSelected: (actor: string) => actor === "a",
      });
      fs.mkdirSync(join(root, "run"), { recursive: true });
      lock = ProcessLock.acquire(join(root, "run/broker.lock"));
      const broker = createBroker({ store, mail: f.mail, units: execution, lifecycle, git: f.git,
        reviews: null, reconcile: null, views: new ViewsModule(store, root, "crash", "p"),
        paths: { stateRoot: root, runRoot: join(root, "run"), society: "crash", hasGoal: () => false },
        limits: TEST_PROTOCOL_LIMITS, lock });
      dispatcher = Reflect.get(broker, "publicDispatcher") as PublicDispatcher;
      return { ...f, lifecycle };
    };
    let f = await connect(true);
    installRuntime({ ...CLIENT_RUNTIME, collaboration: (...args) => { builds++; return CLIENT_RUNTIME.collaboration!(...args); } });
    const socketPath = join(parent, "broker.sock");
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(socketPath, () => { server.off("error", reject); resolve(); }); });
    const invoke = (callOrigin = origin, callInput = input) => new Client({ cwd: workspace, env: { HOME: home, OMA_ACTOR: "a", OMA_SOCIETY: "crash", OMA_SOCKET: socketPath,
      OMA_RECORD_ROOT: join(root, "records/a"), OMA_SUBJECT_BYTES: String(TEST_PROTOCOL_LIMITS.subjectBytes),
      OMA_BODY_BYTES: String(TEST_PROTOCOL_LIMITS.mailBodyBytes) } }).collaborationReceipt("oma_spawn", callOrigin, callInput, "resident");
    if (loss === "name-conflict" || loss === "stopped-name") {
      const accepted = await invoke(); assert.notEqual(accepted.disposition, "existing");
      if (accepted.disposition === "existing") assert.fail("fresh creation must own its acceptance");
      assert.equal(accepted.receipt.state, "succeeded");
      const original = store.getOperationById(accepted.receipt.operation); assert.ok(original?.kind === "agent.create");
      const newCall = async (id: string, value: { [key: string]: Json }) => {
        manager.appendMessage({ role: "assistant", content: [{ type: "toolCall", id, name: "oma_spawn", arguments: value }],
          api: "openai-completions", provider: "openai", model: "journal-fixture", stopReason: "toolUse", timestamp: Date.now(),
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
        return invoke({ ...origin, branch: manager.getLeafId()!, toolCall: id }, value);
      };
      const refused = (error: unknown) => {
        if (!(error instanceof ClientError)) return false;
        const failure = error.code === undefined ? JSON.parse(error.message) : { code: error.code };
        assert.equal(failure.code, "AGENT_CONFLICT"); return true;
      };
      if (loss === "name-conflict") {
        const linked = await newCall("same-intent", input); assert.notEqual(linked.disposition, "existing");
        if (linked.disposition === "existing") assert.fail("a linked create has its own receipt, not a Review resolution");
        const link = store.getOperationById(linked.receipt.operation); assert.ok(link?.kind === "agent.create");
        assert.equal(link.plan.existingCreation, original.id); assert.equal(link.plan.initialMessage, null);
        await assert.rejects(newCall("different-brief", { name: "child", from: candidate, brief: { kind: "text", value: "A different task" } }), refused);
        await assert.rejects(newCall("different-from", { name: "child", from: base, brief: { kind: "text", value: brief } }), refused);
        assert.equal(store.acceptedOperationPage().items.length, 2);
      } else {
        // A separate host-local decision uses the existing stop owner; no model tool gains stop authority.
        const stopped = await f.lifecycle.stop({ ...gitAuth, actor: "principal", role: "principal", channel: "host", incarnation: 0 }, "child", "human-stop-child");
        assert.equal(stopped.state, "succeeded"); assert.equal(store.getAgent("child")?.desired, "stopped");
        const sent = calls.filter(call => call.method === "agent.create").length;
        const observed = await invoke(); assert.notEqual(observed.disposition, "existing");
        if (observed.disposition === "existing") assert.fail("the accepted original remains its own receipt");
        assert.deepEqual(observed.receipt, accepted.receipt, "later stop does not rewrite an accepted creation fact");
        assert.equal(calls.filter(call => call.method === "agent.create").length, sent, "receipt observation cannot resend or reactivate");
        await assert.rejects(newCall("stopped-name", input), refused);
        assert.equal(store.getAgent("child")?.desired, "stopped");
        assert.equal(store.acceptedOperationPage().items.length, 2);
      }
      assert.equal(store.getAgent("child")?.incarnation, 0);
      assert.equal(store.findPhysicalCreate("child", original.plan.specHash)?.id, original.id);
      assert.equal(store.getOperationById(original.id)?.planJson, original.planJson);
      assert.equal(gitCommand(join(root, "agents/child/workspace"), ["rev-parse", "HEAD"]), candidate);
      assert.equal(gitCommand(root, ["--git-dir", join(root, "repos/project.git"), "rev-parse", "refs/heads/main"]), base);
      assert.deepEqual(cleanupErrors, []); return;
    }
    if (loss.endsWith("without-git-submit")) {
      if (loss === "local-without-git-submit") {
        await assert.rejects(invoke(), error => {
          if (!(error instanceof ClientError)) return false;
          const failure = JSON.parse(error.message);
          assert.equal(failure.code, "CAPABILITY_DENIED"); assert.equal(failure.retry, "never");
          assert.deepEqual(failure.details, { capability: "git.submit" });
          assert.match(failure.request, /^inv1-[a-f0-9]{64}$/u);
          return true;
        });
        assert.equal(store.getAgent("child"), null); assert.equal(store.acceptedOperationPage().items.length, 0);
        assert.equal(f.git.isPublished(candidate), false, "agent.create alone cannot publish the local starting commit");
      } else {
        const result = await invoke(); assert.notEqual(result.disposition, "existing");
        if (result.disposition === "existing") assert.fail("a fresh canonical-source creation must own its acceptance");
        assert.equal(result.receipt.state, "succeeded");
        const createCall = calls.find(call => call.method === "agent.create"); assert.ok(createCall && typeof createCall.key === "string");
        const created = store.getOperation("a", createCall.key); assert.ok(created?.kind === "agent.create");
        assert.equal(created.plan.spec.from, base); assert.equal(created.plan.spec.brief, brief);
        assert.deepEqual([...created.plan.spec.capabilities].sort(), ["agent.create", "code.integrate"], "child authority uses the original intersection and explicit host grant");
        assert.ok(created.plan.initialMessage);
        const initial = f.mail.readRecord("child", created.plan.initialMessage.id); assert.equal(initial.state, "published");
        if (initial.state === "published") assert.equal(initial.record.body, brief);
        const delivery = store.getDelivery(created.plan.initialMessage.id, "child"); assert.ok(delivery);
        assert.equal(delivery.materialized, 1); assert.equal(delivery.presented, 0); assert.equal(delivery.acknowledged, 0);
        assert.equal(created.plan.source?.publication, undefined, "canonical reuse is not a new publication or authorship grant");
        assert.equal(store.acceptedOperationPage().items.length, 1);
        assert.equal(store.getAgent("child")?.incarnation, 0);
        assert.equal(gitCommand(join(root, "agents/child/workspace"), ["rev-parse", "HEAD"]), base);
      }
      assert.equal(builds, 1);
      assert.equal(calls.filter(call => call.method === "git.submit").length, 0, "create never borrows a preliminary accepted submission");
      assert.equal(gitCommand(root, ["--git-dir", join(root, "repos/project.git"), "rev-parse", "refs/heads/main"]), base);
      assert.deepEqual(fs.readFileSync(join(sessions, origin.file)), journal); assert.deepEqual(cleanupErrors, []);
      return;
    }
    await assert.rejects(invoke());
    assert.equal(control.lost, true); assert.equal(builds, 1);
    const createCall = calls.find(call => call.method === "agent.create"); assert.ok(createCall && typeof createCall.key === "string");
    const key = createCall.key, id = createRootId("a", key), accepted = store.getOperation("a", key);
    assert.equal(accepted === null, loss === "before-acceptance");
    const protectedCache = new RequestCache(join(root, "host-invocations/a")), local = new RequestCache(home);
    const frozen = protectedCache.read(key); assert.equal(frozen.kind, "present");
    const originalBinding = protectedCache.readInvocation(key); assert.equal(originalBinding.kind, "present");
    assert.equal(originalBinding.value.creation?.policyRevision, "original-child-policy");
    fs.unlinkSync(local.bodyPath(key)); fs.unlinkSync(local.bodyPath(key).replace(/\.body$/u, ".json"));
    if (loss === "after-acceptance") fs.unlinkSync(protectedCache.bodyPath(key));
    fs.renameSync(workspace, `${workspace}.retained`); fs.mkdirSync(workspace);
    assert.equal(fs.existsSync(join(workspace, ".git")), false); assert.equal(fs.existsSync(join(workspace, "brief.md")), false);
    await Promise.allSettled([...tasks]);
    assert.equal(tasks.size, 0, "Store reopen follows settlement of the original connection tasks");
    await units!.closeExecution(); units = undefined; lock!.close(); lock = undefined;
    store.close(); store = new Store(join(root, "runtime.sqlite"));
    f = await connect(false); control.lose = false; control.lost = false;
    if (loss === "before-acceptance") {
      auth = { ...auth, capabilities: new Set() };
      await assert.rejects(invoke());
      assert.equal(store.getOperation("a", key), null, "a protected frozen source is not current parent authority");
      assert.deepEqual(protectedCache.read(key), frozen);
      auth = { ...gitAuth, capabilities: new Set(capabilities) };
    } else {
      // Current authenticated observation remains permitted without effect capabilities.
      // Retirement revokes the actor channel; accepted delegation recovery is
      // exercised separately through the original host owner, not a forged lease.
      auth = { ...auth, capabilities: new Set() };
    }
    const outcome = await invoke(); assert.notEqual(outcome.disposition, "existing");
    if (outcome.disposition === "existing") assert.fail("creation cannot masquerade as an unrelated review resolution");
    assert.equal(outcome.disposition, "replayed"); assert.equal(outcome.receipt.operation, id); assert.equal(outcome.receipt.state, "succeeded");
    assert.equal(builds, 1, "original HEAD/file spelling is never resolved again");
    const original = store.getOperation("a", key); assert.ok(original?.kind === "agent.create");
    assert.equal(original.plan.spec.from, candidate); assert.equal(original.plan.spec.brief, brief);
    assert.equal(original.plan.existingCreation, null); assert.ok(original.plan.initialMessage);
    assert.equal(resolvedSpecOf(store.getAgent("child")!).from, candidate);
    assert.equal(gitCommand(join(root, "agents/child/workspace"), ["rev-parse", "HEAD"]), candidate);
    assert.equal(gitCommand(root, ["--git-dir", join(root, "repos/project.git"), "rev-parse", "refs/heads/main"]), base);
    const record = f.mail.readRecord("child", original.plan.initialMessage.id); assert.equal(record.state, "published");
    if (record.state === "published") assert.equal(record.record.body, brief);
    const delivery = store.getDelivery(original.plan.initialMessage.id, "child"); assert.ok(delivery);
    assert.equal(delivery.materialized, 1); assert.equal(delivery.presented, 0); assert.equal(delivery.acknowledged, 0);
    assert.equal(store.getAgent("child")?.incarnation, 0);
    assert.equal(store.acceptedOperationPage().items.length, 1, "one create owns its source publication, clone and brief; no preliminary submit or replacement Worker");
    assert.equal(calls.filter(call => call.method === "agent.create").length, loss === "before-acceptance" ? 2 : 1);
    assert.deepEqual(fs.readFileSync(join(sessions, origin.file)), journal); assert.deepEqual(cleanupErrors, []);
    if (accepted !== null) assert.equal(original.planJson, accepted.planJson);
  });
}
