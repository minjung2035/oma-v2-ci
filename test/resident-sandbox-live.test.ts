import { productSurfaceMasks } from "@oma/storage/installation-surface";
import { residentEngineEffects } from "#oma-test/app/engine/resident-effects";
/** SB-001..006 + INF-005..008, live: a Resident's engine under real bubblewrap.
 *
 * Everything here is the production path except the provider, which is a local
 * TLS stand-in. The rootfs is the one `oma` generates, the mount plan is the
 * one the adapter builds, and the engine is the bundled one. Inside there is no
 * real provider credential. These scenarios verify key substitution by the
 * relay; current shared-network behavior has its own production-recipe probe.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { provisionSociety } from "#oma-test/app/runtime/provision";
import { InferenceRelay } from "#oma-test/app/runtime/inference-relay";
import { placeholderFor } from "@oma/engine/engine-auth";
import { PiAdapter } from "@oma/engine/pi-adapter";
import { hostSystemLayout } from "@oma/platform-linux/resident-rootfs";
import { resolvePiRuntime } from "@oma/engine/pi-runtime";
import { spawnSandboxed } from "@oma/platform-linux/worker-spawn";
import { PiRpcClient } from "@oma/engine/pi-rpc";
import { decodeRunLease } from "@oma/protocol/run-lease";
import { confinedPath } from "@oma/domain/resident-paths";
import { type SandboxDirectories as ResidentDirectories } from "@oma/contracts/runtime";
import { actorSocketPathAt, agentRootPathAt, runnerSessionDirPathAt, runnerViewPathAt, workspacePathAt } from "@oma/domain/paths";
import { tlsProvider } from "./fixtures/tls-provider.js";
import { observeDeliveryReceipt, publishDeliveryReceipt } from "@oma/storage/delivery-receipt";

const root = fileURLToPath(new URL("../../", import.meta.url));
const bwrapAvailable = spawnSync("bwrap", ["--version"]).status === 0;

/** DR18 (D-5): a probe run on the production plan gets the plan's filter on
 * descriptor 3, as the adapter gives it; bubblewrap reads it to the end. */
function withFilter<T>(plan: { readonly input?: Uint8Array }, run: (stdio: ["pipe", "pipe", "pipe", number]) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "oma-filter-"));
  const path = join(dir, "filter.bpf");
  writeFileSync(path, plan.input ?? new Uint8Array());
  const fd = openSync(path, "r");
  try { return run(["pipe", "pipe", "pipe", fd]); }
  finally { closeSync(fd); rmSync(dir, { recursive: true, force: true }); }
}

test("T117 a confined Resident reaches its provider only through the relay, with the real key", {
  skip: bwrapAvailable ? false : "bubblewrap is not installed on this host",
  timeout: 90000,
}, async () => {
  const work = mkdtempSync(join(tmpdir(), "oma-live-"));
  const provider = await tlsProvider();
  const previousTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  let control: Server | null = null;
  let relay: InferenceRelay | null = null;
  let rpc: PiRpcClient | null = null;
  let child: ReturnType<typeof spawnSandboxed> | null = null;
  let stderr = "";
  try {
    const stateRoot = join(work, "s");
    const runRoot = join(work, "r");
    provisionSociety(stateRoot);
    const actor = "alice";
    const directories: ResidentDirectories = {
      workspace: workspacePathAt(stateRoot, actor),
      home: join(agentRootPathAt(stateRoot, actor), "home"),
      archive: join(stateRoot, "mail", "archive"), workerArchive: join(stateRoot, "mail", "workers"),
      selfMail: join(stateRoot, "mail", "inboxes", actor),
      view: runnerViewPathAt(stateRoot, actor),
      world: join(stateRoot, "world"),
      projectGit: join(stateRoot, "repos", "project.git"), projectMirror: join(stateRoot, "repos", "project-mirror.git"),
      sessions: runnerSessionDirPathAt(stateRoot, actor),
    };
    for (const path of Object.values(directories)) mkdirSync(path, { recursive: true });
    // A file the Resident must not be able to read: the engine's agent directory
    // on the host, where a real login would put the credential.
    mkdirSync(join(stateRoot, "pi"), { recursive: true });
    writeFileSync(join(stateRoot, "pi", "auth.json"), '{"anthropic":"host-only"}');

    // The broker owns the lease socket before a runner starts; bwrap binds it.
    const leaseSocket = actorSocketPathAt(runRoot, actor, 1);
    mkdirSync(dirname(leaseSocket), { recursive: true });
    control = createServer(socket => { socket.destroy(); });
    await new Promise<void>(resolve => { control!.listen(leaseSocket, () => { resolve(); }); });
    const lease = decodeRunLease({ actor, incarnation: 1, socketHostPath: leaseSocket }, { actor, runRoot });

    const secret = "sk-ant-api03-" + "L1ve".repeat(10);
    const placeholder = placeholderFor(secret);
    const relaySocket = join(dirname(leaseSocket), "inference.sock");
    relay = await InferenceRelay.open(relaySocket,
      { origin: provider.origin, headers: {}, substitute: { placeholder, secret } },
      { concurrent: 4, timeoutMs: 30000 });

    const runtime = resolvePiRuntime({ stateRoot, libdir: root });
    const adapter = new PiAdapter(residentEngineEffects, {
      actor, society: "live",
      limits: { frameBytes: 1 << 20, idleStreamSeconds: 60, receiptWaitSeconds: 30, batchMaxMessages: 24, mailBodyBytes: 4096, addresses: 64, contextBytes: 1 << 20, bundleBytes: 1 << 20 },
      profile: { provider: "pi", model: "current", inferenceSeconds: 600, prompt: "", extensions: [] },
      paths: {
        piCommand: runtime.executable, piArgs: runtime.args, piAgentDir: join(stateRoot, "pi"),
        coreExtension: join(root, "packages/extension/dist/index.js"), cli: join(root, "apps/oma/dist/cli.js"),
        workspace: directories.workspace, sessionDir: directories.sessions, agentHome: directories.home,
        mailArchive: join(directories.archive, "cur"), workerArchive: join(directories.workerArchive, "cur"), projectGit: directories.projectGit, batchView: directories.view, socket: leaseSocket,
      },
      confinement: {
        host: {
           libdir: root,
          node: realpathSync(process.execPath),  hidden: productSurfaceMasks(root),
          pi: confinedPath({ libdir: root }, directories, runtime.args[0]!), piModeArgs: [],
          stateRoot, runRoot, limits: { frameBytes: 1 << 20, batchMaxMessages: 24 },
        },
        lease, directories,
        inference: { socketHostPath: relaySocket, provider: "anthropic", model: "claude-fable-5", placeholder },
      },
    });
    const plan = adapter.spawnPlan();
    child = spawnSandboxed([plan.command, ...plan.args], plan.env, plan.input);
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    rpc = new PiRpcClient(child, { frameBytes: 1 << 20, idleStreamSeconds: 60, receiptWaitSeconds: 30 });
    await rpc.send({ id: "go", type: "prompt", message: "say hello" });
    for (let attempt = 0; attempt < 400 && provider.seen.length === 0 && child.exitCode === null; attempt += 1)
      await new Promise(resolve => setTimeout(resolve, 100));

    assert.ok(provider.seen.length > 0,
      `the confined engine never reached the provider; exit=${child.exitCode} stderr=${stderr.slice(-2000)}`);
    const request = provider.seen[0]!;
    assert.match(request.path ?? "", /^\/v1\/messages(\?|$)/);
    const credential = String(request.headers["x-api-key"] ?? request.headers.authorization);
    assert.ok(credential.includes(secret), "the provider did not receive the real key");
    for (const value of Object.values(request.headers))
      assert.ok(!String(value).includes(placeholder), "the placeholder leaked past the relay");
    // The relay carried this authenticated request; this is not an egress-denial proof.
    assert.ok(relay.observe().accepted >= 1);
  } finally {
    rpc?.close();
    child?.kill("SIGKILL");
    await relay?.close();
    await new Promise<void>(resolve => { if (control) control.close(() => { resolve(); }); else resolve(); });
    await provider.close();
    if (previousTls === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTls;
    rmSync(work, { recursive: true, force: true });
  }
});

/** An Anthropic Messages stream that ends one assistant turn with `end_turn`. */
function anthropicTurn(text: string): string[] {
  const event = (name: string, data: object): string => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
  return [
    event("message_start", { type: "message_start", message: { id: "msg_v27a", type: "message", role: "assistant", model: "claude-fable-5",
      content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }),
    event("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    event("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }),
    event("content_block_stop", { type: "content_block_stop", index: 0 }),
    event("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } }),
    event("message_stop", { type: "message_stop" }),
  ];
}

test("V27A: the bundled engine, on the production plan, delivers a batch to a settled boundary it recorded in its session", {
  skip: bwrapAvailable ? false : "bubblewrap is not installed on this host",
  timeout: 120000,
}, async () => {
  // The whole production delivery: generated rootfs, the adapter's own spawn
  // plan and deadlines, the trusted core extension, the relay with a
  // placeholder, and a provider stand-in that answers one turn.
  const work = mkdtempSync(join(tmpdir(), "oma-v27a-"));
  const provider = await tlsProvider();
  provider.reply = { status: 200, chunks: anthropicTurn("read it"), delayMs: 0 };
  const previousTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  let control: Server | null = null;
  let relay: InferenceRelay | null = null;
  try {
    const stateRoot = join(work, "s");
    const runRoot = join(work, "r");
    provisionSociety(stateRoot);
    const actor = "alice";
    const directories: ResidentDirectories = {
      workspace: workspacePathAt(stateRoot, actor),
      home: join(agentRootPathAt(stateRoot, actor), "home"),
      archive: join(stateRoot, "mail", "archive"), workerArchive: join(stateRoot, "mail", "workers"),
      selfMail: join(stateRoot, "mail", "inboxes", actor),
      view: runnerViewPathAt(stateRoot, actor),
      world: join(stateRoot, "world"),
      projectGit: join(stateRoot, "repos", "project.git"), projectMirror: join(stateRoot, "repos", "project-mirror.git"),
      sessions: runnerSessionDirPathAt(stateRoot, actor),
    };
    for (const path of Object.values(directories)) mkdirSync(path, { recursive: true });
    const notice = "새 연락 1건. Full list: /inbox.md\n1. mail m-00000000-0000-4000-8000-0000000000a7-0";
    const batch = { id: "b-00000000-0000-4000-8000-0000000000a7", agent: actor, incarnation: 1, deliveryMode: "followUp" as const,
      notice, messageIds: ["m-00000000-0000-4000-8000-0000000000a7-0"], sessionPath: null, indexPath: "/inbox.md" as const };
    writeFileSync(join(directories.view, `batch-${batch.id}.json`), JSON.stringify({ id: batch.id, agent: actor, incarnation: 1,
      deliveryMode: batch.deliveryMode, notice, messageIds: batch.messageIds }));
    const leaseSocket = actorSocketPathAt(runRoot, actor, 1);
    mkdirSync(dirname(leaseSocket), { recursive: true });
    control = createServer(socket => { socket.destroy(); });
    await new Promise<void>(resolve => { control!.listen(leaseSocket, () => { resolve(); }); });
    const lease = decodeRunLease({ actor, incarnation: 1, socketHostPath: leaseSocket }, { actor, runRoot });
    const secret = "sk-ant-api03-" + "V27a".repeat(10);
    const placeholder = placeholderFor(secret);
    const relaySocket = join(dirname(leaseSocket), "inference.sock");
    relay = await InferenceRelay.open(relaySocket, { origin: provider.origin, headers: {}, substitute: { placeholder, secret } },
      { concurrent: 4, timeoutMs: 30000 });
    const runtime = resolvePiRuntime({ stateRoot, libdir: root });
    const adapter = new PiAdapter(residentEngineEffects, {
      actor, society: "live",
      limits: { frameBytes: 1 << 20, idleStreamSeconds: 60, receiptWaitSeconds: 30, batchMaxMessages: 24, mailBodyBytes: 4096, addresses: 64, contextBytes: 1 << 20, bundleBytes: 1 << 20 },
      profile: { provider: "anthropic", model: "claude-fable-5", inferenceSeconds: 90, prompt: "", extensions: [] },
      paths: {
        piCommand: runtime.executable, piArgs: runtime.args, piAgentDir: join(stateRoot, "pi"),
        coreExtension: join(root, "packages/extension/dist/index.js"), cli: join(root, "apps/oma/dist/cli.js"),
        workspace: directories.workspace, sessionDir: directories.sessions, agentHome: directories.home,
        mailArchive: join(directories.archive, "cur"), workerArchive: join(directories.workerArchive, "cur"), projectGit: directories.projectGit, batchView: directories.view, socket: leaseSocket,
      },
      confinement: {
        host: {
           libdir: root,
          node: realpathSync(process.execPath),  hidden: productSurfaceMasks(root),
          pi: confinedPath({ libdir: root }, directories, runtime.args[0]!), piModeArgs: [],
          stateRoot, runRoot, limits: { frameBytes: 1 << 20, batchMaxMessages: 24 },
        },
        lease, directories,
        inference: { socketHostPath: relaySocket, provider: "anthropic", model: "claude-fable-5", placeholder },
      },
    });
    const boundary = await adapter.deliver(batch);
    assert.ok(boundary);
    assert.equal(boundary.batchId, batch.id);
    assert.match(boundary.entryId, /^[0-9a-f]{8}$/);
    // The notification is one fact; the entry in the engine's own session file
    // is another. Both must name the same thing.
    // The hashline sidecar lives under <sessions>/hashline/sessions/ — it is
    // the bundled extension's claim state, not the engine's session journal.
    const sessions = readdirSync(directories.sessions, { recursive: true }).map(String)
      .filter(name => name.endsWith(".jsonl") && !name.startsWith("hashline/"));
    assert.equal(sessions.length, 1, `expected one session file, saw ${JSON.stringify(sessions)}`);
    assert.equal(basename(sessions[0]!), basename(boundary.sessionPath));
    const entries = readFileSync(join(directories.sessions, sessions[0]!), "utf8").split("\n").filter(Boolean)
      .map(line => JSON.parse(line) as { type?: string; id?: string; customType?: string; message?: { role?: string; customType?: string; stopReason?: string } });
    const at = (found: number, what: string): number => {
      assert.ok(found >= 0, `the session holds no ${what}: ${JSON.stringify(entries.map(entry => [entry.type, entry.customType, entry.message?.role, entry.message?.customType, entry.message?.stopReason]))}`);
      return found;
    };
    const mail = at(entries.findIndex(entry => entry.type === "custom_message" && entry.customType === "oma-mail"), "presented batch");
    const answer = at(entries.findIndex(entry => entry.message?.role === "assistant" && entry.message.stopReason === "stop"), "settled assistant turn");
    const recorded = at(entries.findIndex(entry => entry.type === "custom" && entry.customType === "oma-delivery-boundary"), "boundary entry");
    assert.ok(mail < answer && answer < recorded, "the session does not read batch, answer, boundary in that order");
    assert.equal(entries[recorded]!.id, boundary.entryId, "the notified boundary is not the entry the session holds");
    // The engine reached the provider only through the relay, with the real key.
    assert.ok(provider.seen.length >= 1);
    assert.ok(String(provider.seen[0]!.headers["x-api-key"] ?? provider.seen[0]!.headers.authorization).includes(secret));
    assert.ok(provider.seen[0]!.body.includes("m-00000000-0000-4000-8000-0000000000a7-0"), "the provider was not shown the batch");
    // AV17 / D01, SB-006: the trusted receipt names the durable session file by
    // its host path, and it is a receipt the batch settles from. The functional
    // run found every confined delivery refused here, and the batch re-delivered
    // at each new incarnation, because the boundary carried the sandbox's view.
    assert.equal(boundary.sessionPath, join(directories.sessions, basename(boundary.sessionPath)),
      "the boundary names the session by the sandbox's path, not the host's");
    const receipt = publishDeliveryReceipt(stateRoot, batch as never, boundary, 1 << 20);
    assert.equal(receipt.sessionPath, boundary.sessionPath);
    assert.equal(observeDeliveryReceipt(stateRoot, batch as never, 1 << 20).kind, "verified");
  } finally {
    await relay?.close();
    await new Promise<void>(resolve => { if (control) control.close(() => { resolve(); }); else resolve(); });
    await provider.close();
    if (previousTls === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTls;
    rmSync(work, { recursive: true, force: true });
  }
});


test("T117 a confined Resident loads the trusted extension and receives mail as a custom message", {
  skip: bwrapAvailable ? false : "bubblewrap is not installed on this host",
  timeout: 90000,
}, async () => {
  // The delivery path, on the production rootfs and plan with nothing spliced
  // in by hand. No relay is given, so the turn the mail triggers has no
  // provider: the evidence is the custom message, then the provider error.
  const work = mkdtempSync(join(tmpdir(), "oma-live-deliver-"));
  let control: Server | null = null;
  let rpc: PiRpcClient | null = null;
  let child: ReturnType<typeof spawnSandboxed> | null = null;
  let stderr = "";
  try {
    const stateRoot = join(work, "s");
    const runRoot = join(work, "r");
    provisionSociety(stateRoot);
    const actor = "alice";
    const directories: ResidentDirectories = {
      workspace: workspacePathAt(stateRoot, actor),
      home: join(agentRootPathAt(stateRoot, actor), "home"),
      archive: join(stateRoot, "mail", "archive"), workerArchive: join(stateRoot, "mail", "workers"),
      selfMail: join(stateRoot, "mail", "inboxes", actor),
      view: runnerViewPathAt(stateRoot, actor),
      world: join(stateRoot, "world"),
      projectGit: join(stateRoot, "repos", "project.git"), projectMirror: join(stateRoot, "repos", "project-mirror.git"),
      sessions: runnerSessionDirPathAt(stateRoot, actor),
    };
    for (const path of Object.values(directories)) mkdirSync(path, { recursive: true });
    const manifest = {
      id: "b-00000000-0000-4000-8000-000000000000", agent: actor, incarnation: 1, deliveryMode: "followUp",
      notice: "새 연락 1건. Full list: /inbox.md\n1. mail m-00000000-0000-4000-8000-000000000001-0",
      messageIds: ["m-00000000-0000-4000-8000-000000000001-0"],
    };
    writeFileSync(join(directories.view, `batch-${manifest.id}.json`), JSON.stringify(manifest));

    const leaseSocket = actorSocketPathAt(runRoot, actor, 1);
    mkdirSync(dirname(leaseSocket), { recursive: true });
    control = createServer(socket => { socket.destroy(); });
    await new Promise<void>(resolve => { control!.listen(leaseSocket, () => { resolve(); }); });
    const lease = decodeRunLease({ actor, incarnation: 1, socketHostPath: leaseSocket }, { actor, runRoot });
    const runtime = resolvePiRuntime({ stateRoot, libdir: root });
    const adapter = new PiAdapter(residentEngineEffects, {
      actor, society: "live",
      limits: { frameBytes: 262144, idleStreamSeconds: 60, receiptWaitSeconds: 30, batchMaxMessages: 24, mailBodyBytes: 4096, addresses: 64, contextBytes: 1 << 20, bundleBytes: 1 << 20 },
      profile: { provider: "pi", model: "current", inferenceSeconds: 600, prompt: "", extensions: [] },
      paths: {
        piCommand: runtime.executable, piArgs: runtime.args, piAgentDir: join(stateRoot, "pi"),
        coreExtension: join(root, "packages/extension/dist/index.js"), cli: join(root, "apps/oma/dist/cli.js"),
        workspace: directories.workspace, sessionDir: directories.sessions, agentHome: directories.home,
        mailArchive: join(directories.archive, "cur"), workerArchive: join(directories.workerArchive, "cur"), projectGit: directories.projectGit, batchView: directories.view, socket: leaseSocket,
      },
      confinement: {
        host: {
           libdir: root,
          node: realpathSync(process.execPath),  hidden: productSurfaceMasks(root),
          pi: confinedPath({ libdir: root }, directories, runtime.args[0]!), piModeArgs: [],
          stateRoot, runRoot, limits: { frameBytes: 262144, batchMaxMessages: 24 },
        },
        lease, directories,
      },
    });
    const plan = adapter.spawnPlan();
    child = spawnSandboxed([plan.command, ...plan.args], plan.env, plan.input);
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    rpc = new PiRpcClient(child, { frameBytes: 262144, idleStreamSeconds: 60, receiptWaitSeconds: 30 });
    const events: { type: string; message?: { role?: string; customType?: string; stopReason?: string } }[] = [];
    const settled = new Promise<void>(resolve => {
      rpc!.onEvent(event => {
        events.push(event as never);
        const custom = events.some(e => e.type === "message_start" && e.message?.role === "custom");
        const failed = events.some(e => e.type === "message_end" && e.message?.stopReason === "error");
        if (custom && failed) resolve();
      });
      child!.once("close", () => { resolve(); });
    });
    await rpc.send({ id: "d1", type: "prompt", message: `/oma-deliver ${manifest.id}` });
    await Promise.race([settled, new Promise(resolve => setTimeout(resolve, 30000))]);

    const custom = events.find(e => e.type === "message_start" && e.message?.role === "custom");
    assert.ok(custom, `no custom message inside the sandbox; exit=${child.exitCode} stderr=${stderr.slice(-2000)}`);
    // Peer mail is never dressed up as the Human speaking.
    assert.equal(custom.message?.customType, "oma-mail");
    assert.ok(events.some(e => e.type === "message_end" && e.message?.stopReason === "error"),
      "with no provider path the turn must end in an error, not appear to succeed");
  } finally {
    rpc?.close();
    child?.kill("SIGKILL");
    await new Promise<void>(resolve => { if (control) control.close(() => { resolve(); }); else resolve(); });
    rmSync(work, { recursive: true, force: true });
  }
});

test("T117 the host product's code cannot be read inside a Resident (TUI-003)", {
  skip: bwrapAvailable ? false : "bubblewrap is not installed on this host",
  timeout: 60000,
}, async () => {
  // The installation is mounted into every Resident, and it contains the host
  // product. This runs the production mount plan with a probe in place of the
  // engine, so what it sees is exactly what an engine would see.
  const work = mkdtempSync(join(tmpdir(), "oma-live-hide-"));
  let control: Server | null = null;
  try {
    const stateRoot = join(work, "s");
    const runRoot = join(work, "r");
    provisionSociety(stateRoot);
    const actor = "alice";
    const directories: ResidentDirectories = {
      workspace: workspacePathAt(stateRoot, actor),
      home: join(agentRootPathAt(stateRoot, actor), "home"),
      archive: join(stateRoot, "mail", "archive"), workerArchive: join(stateRoot, "mail", "workers"),
      selfMail: join(stateRoot, "mail", "inboxes", actor),
      view: runnerViewPathAt(stateRoot, actor),
      world: join(stateRoot, "world"),
      projectGit: join(stateRoot, "repos", "project.git"), projectMirror: join(stateRoot, "repos", "project-mirror.git"),
      sessions: runnerSessionDirPathAt(stateRoot, actor),
    };
    for (const path of Object.values(directories)) mkdirSync(path, { recursive: true });
    const leaseSocket = actorSocketPathAt(runRoot, actor, 1);
    mkdirSync(dirname(leaseSocket), { recursive: true });
    control = createServer(socket => { socket.destroy(); });
    await new Promise<void>(resolve => { control!.listen(leaseSocket, () => { resolve(); }); });
    const lease = decodeRunLease({ actor, incarnation: 1, socketHostPath: leaseSocket }, { actor, runRoot });
    const runtime = resolvePiRuntime({ stateRoot, libdir: root });
    const masks = productSurfaceMasks(root);
    assert.ok(masks.some(mask => mask.path === "packages/tui/dist"), "the built product surface should exist to hide");
    for (const path of ["apps/oma/dist/application", "packages/engine/dist/principal-session.js", "packages/domain/dist/settings-policy.js", "packages/domain/dist/surface-bounds.js"])
      assert.ok(masks.some(mask => mask.path === path), `the moved host product must stay hidden: ${path}`);
    const adapter = new PiAdapter(residentEngineEffects, {
      actor, society: "live",
      limits: { frameBytes: 262144, idleStreamSeconds: 60, receiptWaitSeconds: 30, batchMaxMessages: 24, mailBodyBytes: 4096, addresses: 64, contextBytes: 1 << 20, bundleBytes: 1 << 20 },
      profile: { provider: "pi", model: "current", inferenceSeconds: 600, prompt: "", extensions: [] },
      paths: {
        piCommand: runtime.executable, piArgs: runtime.args, piAgentDir: join(stateRoot, "pi"),
        coreExtension: join(root, "packages/extension/dist/index.js"), cli: join(root, "apps/oma/dist/cli.js"),
        workspace: directories.workspace, sessionDir: directories.sessions, agentHome: directories.home,
        mailArchive: join(directories.archive, "cur"), workerArchive: join(directories.workerArchive, "cur"), projectGit: directories.projectGit, batchView: directories.view, socket: leaseSocket,
      },
      confinement: {
        host: {
           libdir: root,
          node: realpathSync(process.execPath),  hidden: masks,
          pi: confinedPath({ libdir: root }, directories, runtime.args[0]!), piModeArgs: [],
          stateRoot, runRoot, limits: { frameBytes: 262144, batchMaxMessages: 24 },
        },
        lease, directories,
      },
    });
    const plan = adapter.spawnPlan();
    const separator = plan.args.lastIndexOf("--");
    const probe = withFilter(plan, stdio => spawnSync(plan.command, [...plan.args.slice(0, separator + 1), "/opt/oma-node/node", "-e", `
      const fs = require("fs");
      const read = p => { try { return fs.readFileSync(p, "utf8").length; } catch (e) { return e.code; } };
      const list = p => { try { return fs.readdirSync(p); } catch (e) { return e.code; } };
      const write = p => { try { fs.writeFileSync(p, "x"); return "written"; } catch (e) { return e.code; } };
      console.log(JSON.stringify({
        tuiDir: list("/opt/oma/packages/tui/dist"), tuiSource: list("/opt/oma/packages/tui/src"),
        tuiLink: list("/opt/oma/node_modules/@oma/tui/dist"),
        tuiCode: read("/opt/oma/node_modules/@oma/tui/dist/app.js"),
        promptEditor: read("/opt/oma/packages/engine/dist/pi-compat/prompt-editor.js"),
        application: list("/opt/oma/apps/oma/dist/application"), engine: read("/opt/oma/packages/engine/dist/principal-session.js"),
        settingsPolicy: read("/opt/oma/packages/domain/dist/settings-policy.js"), surfaceBounds: read("/opt/oma/packages/domain/dist/surface-bounds.js"),
        entry: read("/opt/oma/apps/oma/dist/entry/oma.js"), entrySource: read("/opt/oma/apps/oma/src/entry/oma.ts"),
        writeIntoMask: write("/opt/oma/packages/tui/dist/planted.js"),
        extension: read("/opt/oma/packages/extension/dist/index.js") }));`], { encoding: "utf8", timeout: 30000, stdio }));
    assert.equal(probe.status, 0, probe.stderr);
    const seen = JSON.parse(probe.stdout.trim()) as Record<string, unknown>;
    assert.deepEqual(seen.tuiDir, [], "the built product surface is readable inside");
    assert.deepEqual(seen.tuiSource, [], "the product surface's source is readable inside");
    assert.deepEqual(seen.tuiLink, [], "the workspace link bypasses the product mask");
    assert.equal(typeof seen.tuiCode, "string", "the workspace export remains readable through its link");
    assert.ok(typeof seen.promptEditor === "string" || seen.promptEditor === 0, "the moved prompt adapter is readable inside");
    assert.deepEqual(seen.application, [], "the host Application is readable inside");
    assert.ok(typeof seen.engine === "string" || seen.engine === 0, "the Principal session owner is readable inside");
    for (const value of [seen.settingsPolicy, seen.surfaceBounds])
      assert.ok(typeof value === "string" || value === 0, "moved presentation policy contents are readable inside");
    assert.equal(typeof seen.entry, "string", "the product entrypoint is readable inside");
    assert.equal(typeof seen.entrySource, "string", "the product entrypoint's source is readable inside");
    assert.notEqual(seen.writeIntoMask, "written", "the mask must not become writable space");
    // What the Resident needs is still there.
    assert.equal(typeof seen.extension, "number", "hiding the product must not hide the trusted extension");
  } finally {
    await new Promise<void>(resolve => { if (control) control.close(() => { resolve(); }); else resolve(); });
    rmSync(work, { recursive: true, force: true });
  }
});

test("AV16 / CLI-001, arch §11.1: inside the production sandbox `oma` is the installed CLI on the pinned Node", {
  skip: bwrapAvailable ? false : "bubblewrap is not installed on this host",
  timeout: 60000,
}, async () => {
  // A Resident's START tells it to run `oma send`, `oma submit HEAD`; the
  // functional run found no `oma` and no `node` on the sandbox's PATH.
  const work = mkdtempSync(join(tmpdir(), "oma-live-command-"));
  let control: Server | null = null;
  try {
    const stateRoot = join(work, "s");
    const runRoot = join(work, "r");
    provisionSociety(stateRoot);
    const actor = "alice";
    const directories: ResidentDirectories = {
      workspace: workspacePathAt(stateRoot, actor), home: join(agentRootPathAt(stateRoot, actor), "home"),
      archive: join(stateRoot, "mail", "archive"), workerArchive: join(stateRoot, "mail", "workers"), selfMail: join(stateRoot, "mail", "inboxes", actor),
      view: runnerViewPathAt(stateRoot, actor), world: join(stateRoot, "world"),
      projectGit: join(stateRoot, "repos", "project.git"), projectMirror: join(stateRoot, "repos", "project-mirror.git"), sessions: runnerSessionDirPathAt(stateRoot, actor),
    };
    for (const path of Object.values(directories)) mkdirSync(path, { recursive: true });
    const leaseSocket = actorSocketPathAt(runRoot, actor, 1);
    mkdirSync(dirname(leaseSocket), { recursive: true });
    control = createServer(socket => { socket.destroy(); });
    await new Promise<void>(resolve => { control!.listen(leaseSocket, () => { resolve(); }); });
    const lease = decodeRunLease({ actor, incarnation: 1, socketHostPath: leaseSocket }, { actor, runRoot });
    const runtime = resolvePiRuntime({ stateRoot, libdir: root });
    const adapter = new PiAdapter(residentEngineEffects, {
      actor, society: "live",
      limits: { frameBytes: 262144, idleStreamSeconds: 60, receiptWaitSeconds: 30, batchMaxMessages: 24, mailBodyBytes: 4096, addresses: 64, contextBytes: 1 << 20, bundleBytes: 1 << 20 },
      profile: { provider: "pi", model: "current", inferenceSeconds: 600, prompt: "", extensions: [] },
      paths: {
        piCommand: runtime.executable, piArgs: runtime.args, piAgentDir: join(stateRoot, "pi"),
        coreExtension: join(root, "packages/extension/dist/index.js"), cli: join(root, "apps/oma/dist/cli.js"),
        workspace: directories.workspace, sessionDir: directories.sessions, agentHome: directories.home,
        mailArchive: join(directories.archive, "cur"), workerArchive: join(directories.workerArchive, "cur"), projectGit: directories.projectGit, batchView: directories.view, socket: leaseSocket,
      },
      confinement: {
        host: {
           libdir: root,
          node: realpathSync(process.execPath),  hidden: productSurfaceMasks(root),
          pi: confinedPath({ libdir: root }, directories, runtime.args[0]!), piModeArgs: [],
          stateRoot, runRoot, limits: { frameBytes: 262144, batchMaxMessages: 24 },
        },
        lease, directories,
      },
    });
    const plan = adapter.spawnPlan();
    // The production plan, with a shell in the engine's place.
    const at = plan.args.lastIndexOf("--");
    const probe = withFilter(plan, stdio => spawnSync(plan.command, [...plan.args.slice(0, at + 1), "/bin/sh", "-c",
      "command -v oma; command -v node; node --version; oma; echo \"exit=$?\""], { encoding: "utf8", timeout: 30000, stdio }));
    const lines = `${probe.stdout}\n${probe.stderr}`;
    assert.match(lines, /^\/opt\/oma\/apps\/oma\/dist\/libexec\/oma$/m, `oma is not on the sandbox's PATH: ${lines.slice(0, 600)}`);
    assert.match(lines, /^\/opt\/oma-node\/node$/m, "node on the PATH is not the pinned Node");
    assert.match(lines, new RegExp(`^${process.version.replace(/\./g, "\\.")}$`, "m"));
    // The CLI itself ran: without arguments it prints its usage and exits 2 (CLI-003).
    assert.doesNotMatch(lines, /not found|No such file/);
    assert.match(lines, /^  oma submit <revision>/m);
    assert.match(lines, /^exit=2$/m);
  } finally {
    await new Promise<void>(resolve => { if (control) control.close(() => { resolve(); }); else resolve(); });
    rmSync(work, { recursive: true, force: true });
  }
});
