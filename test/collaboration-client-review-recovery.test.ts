/** Actual Client/RequestService/Transport/BrokerChannel over a Unix socket,
 * RpcConnection/TransportSpool and production broker dispatch, real SDK JSONL,
 * Store/Mail/Git/Review and the original native quarantine. Authentication and
 * selected launch policy are fixture inputs, not kernel/SDK containment proof.
 * Socket loss and Store reopen are not a whole-broker crash or power-loss test. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createServer, type Socket } from "node:net";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Client, SubmissionPublicationError } from "@oma/client";
import { installRuntime } from "@oma/client/runtime";
import type { AuthContext, Json, Request } from "@oma/contracts";
import { RpcConnection } from "@oma/broker/connection";
import { SharedPeerPin } from "@oma/broker/peer-pin";
import type { PublicDispatcher } from "@oma/broker/public-dispatcher";
import { TransportSpool } from "@oma/storage/transport-spool";
import { sessionDirPathAt } from "@oma/domain/paths";
import { submissionPublicationKey } from "@oma/protocol/invocation-submission";
import { runGitText } from "@oma/process/policies";
import type { LifecycleModule } from "@oma/lifecycle";
import type { ProcessLock } from "@oma/native/process-lock";
import { createBroker, type BrokerExecution } from "#oma-test/app/broker/broker-composition";
import { CLIENT_RUNTIME } from "#oma-test/app/runtime/client-runtime";
import { newSessionBirth, publishSessionBirth } from "#oma-test/app/runtime/session-mode";
import { RequestCache } from "#oma-test/app/request-cache";
import { ViewsModule } from "#oma-test/app/views";
import { fixture as reviewFixture } from "./fixtures/review-fixture.js";
import { nativeQuarantine } from "./fixtures/git-crash.js";
import { TEST_PROTOCOL_LIMITS } from "./fixtures/limits.js";
import { removeTree } from "./fixtures/cleanup.js";

for (const loss of ["before-parent-acceptance", "after-parent-acceptance"] as const) {
  test(`001. Client compound transport: ${loss} preserves the original without obsolete bundle or caller repository`, async t => {
    const parent = fs.mkdtempSync(join(tmpdir(), "oma-client-review-")), stateRoot = join(parent, "demo");
    const f = reviewFixture({ stateRoot, quarantine: nativeQuarantine({ stateRoot,
      projectGit: join(stateRoot, "repos/project.git"), contextGit: join(stateRoot, "context.git"),
      worldDir: join(stateRoot, "world"), society: "demo" }) });
    const sockets = new Set<Socket>(), connections = new Set<RpcConnection>(), tasks = new Set<Promise<void>>();
    const cleanupErrors: unknown[] = [];
    const server = createServer(socket => {
      sockets.add(socket); socket.on("close", () => sockets.delete(socket));
      const connection = new RpcConnection({ socket, limits: TEST_PROTOCOL_LIMITS,
        peer: new SharedPeerPin(() => true, () => {}),
        preflight: raw => dispatcher.preflight(auth, raw),
        makeSpool: descriptor => new TransportSpool(join(stateRoot, "staging"), descriptor),
        handle: async (raw, body) => {
          calls.push({ method: raw.method, key: raw.request, params: raw.params, streamed: body !== null });
          if (control.lost && raw.method === "operation.get") {
            socket.destroy(); return {};
          }
          if (!control.lost && control.lose && raw.method === "attest.record" && loss === "before-parent-acceptance") {
            control.lost = true; socket.destroy(); return {};
          }
          // SAFETY: raw framed wire input; the production dispatcher validates it.
          const response = await dispatcher.dispatch(auth, raw as unknown as Request, body);
          if (!control.lost && control.lose && raw.method === "attest.record" && loss === "after-parent-acceptance") {
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
      if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      f.close(); removeTree(parent);
    });
    publishSessionBirth(f.root, newSessionBirth(f.root, "society", parent, "collaboration-v1"));
    const home = join(f.root, "agents/alice/home"), workspace = join(f.root, "agents/alice/workspace");
    fs.mkdirSync(home, { recursive: true });
    const git = (args: string[], cwd = workspace): string => {
      const result = runGitText(args, { cwd, env: { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@invalid",
        GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@invalid" } });
      assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
    };
    git(["clone", "--no-local", join(f.root, "repos/project.git"), workspace], parent);
    git(["checkout", "--detach", f.base]); // The bare fixture's symbolic HEAD need not name main.
    fs.writeFileSync(join(workspace, "change.txt"), "original committed change\n");
    git(["add", "change.txt"]); git(["commit", "-m", "original candidate"]);
    const candidate = git(["rev-parse", "HEAD"]);
    let auth: AuthContext = f.auth("alice");
    assert.equal(f.module.isPublished(candidate), false);
    const input: Json = { change: { candidate, base: f.base }, reason: "Original evidence", title: "Original proposal", tier: "LOW" };
    const sessions = sessionDirPathAt(f.root, "alice"); fs.mkdirSync(sessions, { recursive: true });
    const manager = SessionManager.create(workspace, sessions);
    manager.appendMessage({ role: "assistant", content: [{ type: "toolCall", id: "original-merge", name: "oma_merge", arguments: input }],
      api: "openai-completions", provider: "openai", model: "journal-fixture", stopReason: "toolUse", timestamp: Date.now(),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    const origin = { file: basename(manager.getSessionFile()!), session: manager.getSessionId(), branch: manager.getLeafId()!, toolCall: "original-merge" };
    const journal = fs.readFileSync(join(sessions, origin.file));
    const units: BrokerExecution = { pin: () => { throw new Error("no live run scope in this authenticated transport fixture"); },
      collaborationRecordsSelected: actor => actor === auth.actor,
      observe: () => { throw new Error("no process observation in this fixture"); }, scopeRoot: () => null,
      runnerAlive: () => false, readLogs: async () => ({ text: "", truncated: false, observedAtMs: Date.now() }), bindRunRevoker: () => {},
      observeStatus: async actors => new Map(actors.map(actor => [actor, "no-unit" as const])) };
    const makeDispatcher = (): PublicDispatcher => Reflect.get(createBroker({ store: f.store, mail: f.mail, units,
      views: new ViewsModule(f.store, f.root, "demo", "p"),
      lifecycle: { creation: () => ({ capability: false, childProfile: null, childHasMailSend: null,
        observedAtMs: Date.now(), maxWorkers: 6, workerCount: 5 }) } as unknown as LifecycleModule,
      git: f.module, reviews: f.reviews, reviewTargets: f.reviews, reconcile: null,
      paths: { stateRoot: f.root, runRoot: join(f.root, "run"), society: "demo", hasGoal: () => false },
      limits: TEST_PROTOCOL_LIMITS, lock: { assertHeld: () => {} } as unknown as ProcessLock }), "publicDispatcher") as PublicDispatcher;
    let dispatcher = makeDispatcher();
    const control = { lose: true, lost: false }, calls: { method: unknown; key: unknown; params: unknown; streamed: boolean }[] = [];
    let builds = 0, bundles = 0;
    installRuntime({ ...CLIENT_RUNTIME,
      collaboration: (...args) => { builds++; return CLIENT_RUNTIME.collaboration!(...args); },
      submit: (...args) => { bundles++; return CLIENT_RUNTIME.submit(...args); },
    });
    const socketPath = join(parent, "broker.sock");
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(socketPath, () => { server.off("error", reject); resolve(); }); });
    const client = () => new Client({ cwd: workspace, env: { HOME: home, OMA_ACTOR: auth.actor, OMA_SOCIETY: "demo",
      OMA_SOCKET: socketPath, OMA_RECORD_ROOT: join(f.root, "records/alice"),
      OMA_SUBJECT_BYTES: String(TEST_PROTOCOL_LIMITS.subjectBytes), OMA_BODY_BYTES: String(TEST_PROTOCOL_LIMITS.mailBodyBytes) } });
    const invoke = () => client().collaborationReceipt("oma_merge", origin, input, "resident");
    await assert.rejects(invoke(), error => {
      assert.ok(error instanceof SubmissionPublicationError);
      assert.equal(error.publication.receipt?.state, "succeeded"); return true;
    });
    assert.equal(control.lost, true); assert.equal(builds, 1); assert.equal(bundles, 1);
    const protectedCache = new RequestCache(join(f.root, "host-invocations/alice"));
    const [binding] = protectedCache.pendingInvocations();
    // The canonical parent may already be observed; enumerate the exact original
    // key from the transport in both cases, never invent a replacement key.
    const parentCall = calls.find(call => call.method === "attest.record"); assert.ok(parentCall);
    assert.equal(typeof parentCall.key, "string"); const key = String(parentCall.key), child = submissionPublicationKey(key);
    assert.equal(parentCall.streamed, false);
    assert.ok(binding === undefined || binding.key === key);
    const protectedOriginal = protectedCache.read(key); assert.equal(protectedOriginal.kind, "present");
    const digest = protectedOriginal.value.digest; assert.ok(digest);
    const acceptedChild = f.store.getOperation(auth.actor, child); assert.equal(acceptedChild?.kind, "git.submit");
    assert.equal(acceptedChild?.state, "succeeded");
    const beforeParent = f.store.getOperation(auth.actor, key);
    assert.equal(beforeParent === null, loss === "before-parent-acceptance");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), loss === "before-parent-acceptance" ? f.base : candidate);
    const local = new RequestCache(home);
    for (const cache of [protectedCache, local]) fs.unlinkSync(cache.bodyPath(key));
    fs.unlinkSync(local.bodyPath(child));
    fs.unlinkSync(local.bodyPath(key).replace(/\.body$/u, ".json"));
    fs.renameSync(workspace, `${workspace}.retained`); fs.mkdirSync(workspace);
    assert.equal(fs.existsSync(join(workspace, ".git")), false, "continuation has no mutable caller repository to reopen");
    f.reopen(); dispatcher = makeDispatcher(); control.lose = false; control.lost = false;
    if (loss === "before-parent-acceptance") {
      auth = { ...auth, capabilities: new Set() };
      await assert.rejects(invoke(), error => {
        assert.ok(error instanceof SubmissionPublicationError);
        assert.match(error.message, /CAPABILITY_DENIED/);
        assert.equal(error.publication.receipt?.operation, acceptedChild?.id); return true;
      });
      assert.equal(f.store.getOperation(auth.actor, key), null, "published child and metadata handoff do not grant current parent authority");
      assert.equal(f.git(["rev-parse", "refs/heads/main"]), f.base);
      assert.deepEqual(protectedCache.read(key), protectedOriginal, "authority denial cannot rewrite the original freeze");
      assert.equal(protectedCache.readInvocation(key).kind, "present");
      auth = f.auth("alice");
    }
    const outcome = await invoke();
    assert.equal(outcome.disposition, "replayed");
    assert.equal(outcome.receipt.state, "succeeded");
    assert.equal(outcome.publication?.receipt?.operation, acceptedChild?.id);
    assert.equal(builds, 1); assert.equal(bundles, 1);
    assert.equal(outcome.receipt.operation, f.store.getOperation(auth.actor, key)?.id);
    assert.equal(f.store.getOperation(auth.actor, child)?.id, acceptedChild?.id);
    assert.equal(calls.filter(call => call.method === "git.submit").length, 1, "original child publication is not retransmitted");
    assert.equal(calls.filter(call => call.method === "attest.record").length, loss === "before-parent-acceptance" ? 3 : 1);
    assert.deepEqual(fs.readFileSync(join(sessions, origin.file)), journal);
    assert.equal(protectedCache.readBody(key, digest).kind, "absent");
    assert.equal(local.readBody(key, digest).kind, "absent");
    assert.deepEqual(cleanupErrors, []);
    const review = f.store.getOperation(auth.actor, key); assert.equal(review?.kind, "attest.record");
    const preparation = f.store.getOperation(auth.actor, `~refresh.${outcome.receipt.operation}.0`);
    const integration = f.store.getOperation(auth.actor, `~apply.${outcome.receipt.operation}`);
    if (preparation?.kind !== "attest.record" || preparation.plan.fact.kind !== "review.integration" || integration?.kind !== "git.integrate")
      assert.fail("the original LOW-policy preparation and integration must exist");
    assert.equal(preparation.plan.fact.request, review?.id); assert.equal(preparation.plan.fact.sourceOperation, review?.id);
    assert.equal(preparation.plan.fact.source.candidate, candidate); assert.equal(preparation.plan.fact.source.expectedBase, f.base);
    if (integration.plan.merge?.version !== 3) assert.fail("selected integration must retain its v3 preparation relationship");
    assert.equal(integration.plan.merge.request, review?.id); assert.equal(integration.plan.merge.preparation, preparation.id);
    assert.equal(integration.plan.base, f.base); assert.equal(integration.plan.candidate, candidate);
    assert.deepEqual(f.store.acceptedOperationPage().items.map(({ operation }) => ({
      id: operation.id, key: operation.requestKey, actor: operation.actor, kind: operation.kind, state: operation.state,
    })), [acceptedChild, review, preparation, integration].map(operation => ({
      id: operation!.id, key: operation!.requestKey, actor: auth.actor, kind: operation!.kind, state: "succeeded",
    })), "only the original submit, Review and exact LOW-policy preparation/integration may exist");
  });
}
