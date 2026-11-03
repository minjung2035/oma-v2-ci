/** Client -> real Unix RPC/dispatcher -> HostInvocations -> original effect owners.
 * SDK journals, ledger, immutable records, Mail, Git and native quarantine are real.
 * Authentication/selection are fixture inputs. The source builder receives explicit
 * view/physical roots instead of a Worker mount; this is not peer/provider proof. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createServer, type Socket } from "node:net";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import type { TestContext } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Client } from "@oma/client";
const { registerCollaborationTools } = await import(new URL("collaboration-tools.js", import.meta.resolve("@oma/extension/mail-tools")).href);
import { installRuntime } from "@oma/client/runtime";
import { currentContext } from "@oma/client/context";
import type { AuthContext, Json, Request } from "@oma/contracts";
import { RpcConnection } from "@oma/broker/connection";
import { SharedPeerPin } from "@oma/broker/peer-pin";
import type { PublicDispatcher } from "@oma/broker/public-dispatcher";
import { TransportSpool } from "@oma/storage/transport-spool";
import { ProcessLock } from "@oma/native/process-lock";
import { sessionDirPathAt, collaborationRecordRootPathAt } from "@oma/domain/paths";
import { type CollaborationTarget } from "@oma/domain/collaboration-targets";
import { createBroker, type BrokerExecution } from "#oma-test/app/broker/broker-composition";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { CLIENT_RUNTIME } from "#oma-test/app/runtime/client-runtime";
import { prepareCollaborationSources } from "#oma-test/app/runtime/collaboration-sources";
import { collaborationSocietyBirth, newSessionBirth, publishSessionBirth } from "#oma-test/app/runtime/session-mode";
import { ViewsModule } from "#oma-test/app/views";
import { CollaborationReviewViews } from "#oma-test/app/views/collaboration-reviews";
import { fixture, type FixtureOptions } from "./review-fixture.js";
import { nativeQuarantine } from "./git-crash.js";
import { nativeLifecycleExecution } from "./native-lifecycle-execution.js";
import { withWorkerCapacity } from "./spec.js";
import { TEST_PROTOCOL_LIMITS as limits } from "./limits.js";
import { removeTree } from "./cleanup.js";

export async function collaborationClient(t: TestContext, options: FixtureOptions = {}) {
  const parent = fs.mkdtempSync(join(tmpdir(), "oma-client-actions-")), root = join(parent, "demo");
  const f = fixture({ ...options, parents: { alice: "principal", bob: "principal", carol: "principal", dave: "principal", ellen: "principal", ...options.parents }, stateRoot: root, quarantine: nativeQuarantine({ stateRoot: root,
    projectGit: join(root, "repos/project.git"), contextGit: join(root, "context.git"),
    worldDir: join(root, "world"), society: "demo" }) });
  publishSessionBirth(root, newSessionBirth(root, "society", parent, "collaboration-v1"));
  const birth = collaborationSocietyBirth(root, "demo", f.store.getAgent("principal"));
  const units = await nativeLifecycleExecution(f.store, root, { initialize: false });
  const owner = new AbortController();
  const lifecycle = createLifecycleModule(f.store, units, { stateRoot: root, society: "demo",
    projectGit: f.projectGit, hasGoal: () => false, activationAllowed: () => false, ownerSignal: owner.signal },
    withWorkerCapacity(() => null), f.mail, f.module);
  const execution: BrokerExecution = Object.assign(units, {
    pin: () => { throw new Error("no authenticated Worker runner in this transport fixture"); },
    collaborationRecordsSelected: () => true,
    observeStatus: async (actors: readonly string[]) => new Map(actors.map(actor => [actor, "no-unit" as const])),
  });
  fs.mkdirSync(join(root, "run"), { recursive: true });
  const lock = ProcessLock.acquire(join(root, "run/broker.lock"));
  const broker = createBroker({ store: f.store, mail: f.mail, units: execution, lifecycle, git: f.module,
    reviews: f.reviews, reviewTargets: f.reviews, reconcile: null, views: new ViewsModule(f.store, root, "demo", "p"),
    paths: { stateRoot: root, runRoot: join(root, "run"), society: "demo", hasGoal: () => false }, limits, lock });
  const dispatcher = Reflect.get(broker, "publicDispatcher") as PublicDispatcher;
  let auth: AuthContext = f.auth("alice");
  const sockets = new Set<Socket>(), connections = new Set<RpcConnection>(), tasks = new Set<Promise<void>>();
  const errors: unknown[] = [], calls: { method: unknown; key: unknown; params: unknown }[] = [];
  let beforeDispatch: ((method: unknown) => void | Promise<void>) | undefined;
  const server = createServer(socket => {
    sockets.add(socket); socket.on("close", () => sockets.delete(socket));
    const connection = new RpcConnection({ socket, limits, peer: new SharedPeerPin(() => true, () => {}),
      preflight: raw => dispatcher.preflight(auth, raw),
      makeSpool: descriptor => new TransportSpool(join(root, "staging"), descriptor),
      handle: async (raw, body) => {
        calls.push({ method: raw.method, key: raw.request, params: raw.params });
        await beforeDispatch?.(raw.method);
        // SAFETY: raw wire request; production dispatch validates every field.
        return dispatcher.dispatch(auth, raw as unknown as Request, body);
      },
      onTask: task => { tasks.add(task); void task.then(() => tasks.delete(task), error => { errors.push(error); tasks.delete(task); }); },
      onClosed: () => connections.delete(connection), onCleanupError: error => errors.push(error),
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
    } finally {
      try { await units.closeExecution(); }
      finally { lock.close(); f.close(); removeTree(parent); }
    }
    assert.deepEqual(errors, []);
  });
  installRuntime({ ...CLIENT_RUNTIME, collaboration: (tool, args, role) => {
    const context = currentContext(), records = collaborationRecordRootPathAt(root, context.env.OMA_ACTOR!);
    return prepareCollaborationSources(tool, args, { role, actor: context.env.OMA_ACTOR!, society: "demo",
      cwd: context.cwd, recordRoot: role === "resident" ? "/oma" : records,
      roots: [{ view: role === "resident" ? "/oma" : records, physical: records }, { view: context.cwd, physical: context.cwd }], limits,
      resolveRevision: revision => CLIENT_RUNTIME.resolveOid(revision), recordedBase: () => CLIENT_RUNTIME.recordedBase(),
      goal: (body, expected) => { const prepared = CLIENT_RUNTIME.goal(body, expected); return { ...prepared, content: Buffer.from(prepared.content) }; } });
  } });
  const socketPath = join(parent, "broker.sock");
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(socketPath, () => { server.off("error", reject); resolve(); }); });
  const sessions = new Map<string, SessionManager>();
  const client = (actor: string) => {
    const workspace = join(root, "agents", actor, "workspace"), home = join(root, "agents", actor, "home");
    fs.mkdirSync(workspace, { recursive: true }); fs.mkdirSync(home, { recursive: true });
    return new Client({ cwd: workspace, env: { HOME: home, OMA_ACTOR: actor, OMA_SOCIETY: "demo", OMA_SOCKET: socketPath,
      OMA_RECORD_ROOT: actor === "principal" ? collaborationRecordRootPathAt(root, actor) : "/oma",
      OMA_CONTEXT_GIT: join(root, "context.git"), OMA_SUBJECT_BYTES: String(limits.subjectBytes), OMA_BODY_BYTES: String(limits.mailBodyBytes) } });
  };
  let nextCall = 0;
  const call = (actor: string, tool: string, args: { [key: string]: Json }, id = `call-${nextCall++}`) => {
    const caller = client(actor);
    let manager = sessions.get(actor);
    if (!manager) {
      const directory = sessionDirPathAt(root, actor); fs.mkdirSync(directory, { recursive: true });
      manager = SessionManager.create(join(root, "agents", actor, "workspace"), directory); sessions.set(actor, manager);
    }
    manager.appendMessage({ role: "assistant", content: [{ type: "toolCall", id, name: tool, arguments: args }],
      api: "openai-completions", provider: "openai", model: "journal-fixture", stopReason: "toolUse", timestamp: Date.now(),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    const origin = { file: basename(manager.getSessionFile()!), session: manager.getSessionId(), branch: manager.getLeafId()!, toolCall: id };
    const invoke = () => { auth = f.auth(actor); return caller.collaborationReceipt(tool, origin, args, auth.role); };
    type Definition = { name: string; execute(id: string, input: unknown, signal: undefined, update: undefined, context: never): Promise<{ content: { type: string; text?: string }[]; details?: unknown }> };
    const definitions = new Map<string, Definition>();
    registerCollaborationTools({ on() {}, registerTool: (definition: Definition) => definitions.set(definition.name, definition) } as never,
      caller, f.auth(actor).role, { addresses: limits.addresses });
    const invokeTool = () => {
      auth = f.auth(actor);
      const definition = definitions.get(tool);
      if (!definition) throw new Error(`${tool} is not available for ${actor}`);
      return definition.execute(id, args, undefined, undefined, { sessionManager: manager } as never);
    };
    return { invoke, invokeTool, definitions, origin, caller };
  };
  const target = (actor: string, request: string, kind: CollaborationTarget["kind"]) => {
    const records = new CollaborationReviewViews(f.store, root, f.module, limits.frameBytes);
    const published = records.publish(f.auth(actor), f.reviews.observeRecords(f.auth(actor), birth), new Date().toISOString());
    assert.equal(published.failed, 0, `target publication must have its actual dependencies:\n${fs.readdirSync(join(collaborationRecordRootPathAt(root, actor), "reviews/pages")).map(name => fs.readFileSync(join(collaborationRecordRootPathAt(root, actor), "reviews/pages", name), "utf8")).join("\n")}`);
    const status = fs.readFileSync(join(collaborationRecordRootPathAt(root, actor), "reviews", request, "status.md"), "utf8");
    const references = status.split("\n").filter(line => line.startsWith(`${kind} target: `));
    assert.equal(references.length, 1, `status must expose one current ${kind} target for ${actor}`);
    return references[0]!.slice(`${kind} target: `.length);
  };
  return { f, birth, calls, call, target, lifecycle, units,
    beforeDispatch: (hook?: typeof beforeDispatch) => { beforeDispatch = hook; } };
}
