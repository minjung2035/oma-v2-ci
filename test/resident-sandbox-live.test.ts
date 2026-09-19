/** SB-001..006 + INF-005..008, live: a Resident's engine under real bubblewrap.
 *
 * Everything here is the production path except the provider, which is a local
 * TLS stand-in. The rootfs is the one `oma` generates, the mount plan is the
 * one the adapter builds, and the engine is the bundled one. Inside there is no
 * network and no credential, so the only way the provider can receive a
 * request carrying the real key is through the relay.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { provisionSociety, residentRootfsPath } from "../src/runtime/provision.js";
import { InferenceRelay } from "../src/runtime/inference-relay.js";
import { placeholderFor } from "../src/runtime/engine-auth.js";
import { PiAdapter } from "../src/runtime/pi-adapter.js";
import { hostSystemLayout } from "../src/runtime/resident-rootfs.js";
import { resolvePiRuntime } from "../src/runtime/pi-runtime.js";
import { spawnSandboxed } from "../src/process/async.js";
import { PiRpcClient } from "../src/runtime/pi-rpc.js";
import { decodeRunLease } from "../src/protocol/run-lease.js";
import { confinedPath, type ResidentDirectories } from "../src/sandbox.js";
import { actorSocketPathAt, agentRootPathAt, runnerSessionDirPathAt, runnerViewPathAt, workspacePathAt } from "../src/storage/paths.js";
import { tlsProvider } from "./fixtures/tls-provider.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const bwrapAvailable = spawnSync("bwrap", ["--version"]).status === 0;

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
      archive: join(stateRoot, "mail", "archive"),
      selfMail: join(stateRoot, "mail", "inboxes", actor),
      view: runnerViewPathAt(stateRoot, actor),
      world: join(stateRoot, "world"),
      projectGit: join(stateRoot, "repos", "project.git"),
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
    const adapter = new PiAdapter({
      actor, society: "live",
      limits: { frameBytes: 1 << 20, idleStreamSeconds: 60, receiptWaitSeconds: 30, batchMaxMessages: 24, mailBodyBytes: 4096 },
      profile: { provider: "pi", model: "current", prompt: "", workspaceBytes: 1 << 24, extensions: [] },
      paths: {
        piCommand: runtime.executable, piArgs: runtime.args, piAgentDir: join(stateRoot, "pi"),
        coreExtension: join(root, "dist/src/pi-extension.js"), cli: join(root, "dist/src/cli.js"),
        workspace: directories.workspace, sessionDir: directories.sessions, agentHome: directories.home,
        mailArchive: join(directories.archive, "cur"), batchView: directories.view, socket: leaseSocket,
      },
      confinement: {
        host: {
          rootfs: residentRootfsPath(stateRoot), libdir: root,
          node: realpathSync(process.execPath), systemBinds: hostSystemLayout().binds,
          pi: confinedPath(root, directories, runtime.args[0]!), piModeArgs: [],
          tmpBytes: 64 * 1024 * 1024,
          checkResources: { memoryBytes: 1 << 30, tasks: 64, cpuQuotaPercent: 100, tmpBytes: 1 << 26,
            workspaceBytes: 1 << 24, stagingBytes: 1 << 24, checkTimeoutSeconds: 30 },
          stateRoot, runRoot, limits: { frameBytes: 1 << 20, batchMaxMessages: 24 },
        },
        lease, directories,
        inference: { socketHostPath: relaySocket, provider: "anthropic", model: "claude-fable-5", placeholder },
      },
    });
    const plan = adapter.spawnPlan();
    child = spawnSandboxed([plan.command, ...plan.args], plan.env);
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
    // The relay carried it; there was no other road out.
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

test("T117 inside the generated rootfs a Resident cannot see the host or leave by network", {
  skip: bwrapAvailable ? false : "bubblewrap is not installed on this host",
  timeout: 60000,
}, async () => {
  const work = mkdtempSync(join(tmpdir(), "oma-live-escape-"));
  try {
    const stateRoot = join(work, "s");
    provisionSociety(stateRoot);
    mkdirSync(join(stateRoot, "pi"), { recursive: true });
    writeFileSync(join(stateRoot, "pi", "auth.json"), '{"secret":"host-only"}');
    const layout = hostSystemLayout();
    const node = realpathSync(process.execPath);
    // The same base the Resident plan uses: the generated rootfs read-only as
    // `/`, the operating system's programs over it, and no other host path.
    const probe = spawnSync("bwrap", [
      "--unshare-all", "--new-session", "--die-with-parent", "--cap-drop", "ALL",
      "--ro-bind", residentRootfsPath(stateRoot), "/",
      ...layout.binds.flatMap(path => ["--ro-bind", path, path]),
      "--ro-bind", node, "/opt/oma-node/node",
      "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--clearenv", "--setenv", "PATH", "/usr/bin:/bin",
      "--", "/opt/oma-node/node", "-e", `
        const fs = require("fs"); const net = require("net");
        const seen = p => { try { fs.accessSync(p); return true; } catch { return false; } };
        const report = { stateRoot: seen(${JSON.stringify(stateRoot)}), credential: seen(${JSON.stringify(join(stateRoot, "pi", "auth.json"))}),
          home: seen(${JSON.stringify(process.env.HOME ?? "/home")}), writableRoot: (() => { try { fs.writeFileSync("/x", "x"); return true; } catch { return false; } })(),
          user: require("os").userInfo().username };
        const socket = net.connect({ host: "1.1.1.1", port: 443 });
        socket.setTimeout(1500, () => { report.egress = "timeout"; console.log(JSON.stringify(report)); process.exit(0); });
        socket.on("connect", () => { report.egress = "connected"; console.log(JSON.stringify(report)); process.exit(0); });
        socket.on("error", error => { report.egress = error.code; console.log(JSON.stringify(report)); process.exit(0); });`,
    ], { encoding: "utf8", timeout: 30000 });
    assert.equal(probe.status, 0, probe.stderr);
    const report = JSON.parse(probe.stdout.trim()) as Record<string, unknown>;
    assert.equal(report.stateRoot, false, "the host state root is visible inside");
    assert.equal(report.credential, false, "the engine's credential file is visible inside");
    assert.equal(report.home, false, "the host home is visible inside");
    assert.equal(report.writableRoot, false, "the rootfs is writable from inside");
    assert.notEqual(report.egress, "connected", "a confined Resident reached the network");
    // The generated identity names only the agent.
    assert.equal(report.user, "agent");
  } finally { rmSync(work, { recursive: true, force: true }); }
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
      archive: join(stateRoot, "mail", "archive"),
      selfMail: join(stateRoot, "mail", "inboxes", actor),
      view: runnerViewPathAt(stateRoot, actor),
      world: join(stateRoot, "world"),
      projectGit: join(stateRoot, "repos", "project.git"),
      sessions: runnerSessionDirPathAt(stateRoot, actor),
    };
    for (const path of Object.values(directories)) mkdirSync(path, { recursive: true });
    const manifest = {
      id: "b-00000000-0000-4000-8000-000000000000", agent: actor, incarnation: 1, deliveryMode: "followUp",
      notice: "새 연락 1건. 전체 목록: /inbox.md\n1. mail m-00000000-0000-4000-8000-000000000001-0",
      messageIds: ["m-00000000-0000-4000-8000-000000000001-0"],
    };
    writeFileSync(join(directories.view, `batch-${manifest.id}.json`), JSON.stringify(manifest));

    const leaseSocket = actorSocketPathAt(runRoot, actor, 1);
    mkdirSync(dirname(leaseSocket), { recursive: true });
    control = createServer(socket => { socket.destroy(); });
    await new Promise<void>(resolve => { control!.listen(leaseSocket, () => { resolve(); }); });
    const lease = decodeRunLease({ actor, incarnation: 1, socketHostPath: leaseSocket }, { actor, runRoot });
    const runtime = resolvePiRuntime({ stateRoot, libdir: root });
    const adapter = new PiAdapter({
      actor, society: "live",
      limits: { frameBytes: 262144, idleStreamSeconds: 60, receiptWaitSeconds: 30, batchMaxMessages: 24, mailBodyBytes: 4096 },
      profile: { provider: "pi", model: "current", prompt: "", workspaceBytes: 1 << 24, extensions: [] },
      paths: {
        piCommand: runtime.executable, piArgs: runtime.args, piAgentDir: join(stateRoot, "pi"),
        coreExtension: join(root, "dist/src/pi-extension.js"), cli: join(root, "dist/src/cli.js"),
        workspace: directories.workspace, sessionDir: directories.sessions, agentHome: directories.home,
        mailArchive: join(directories.archive, "cur"), batchView: directories.view, socket: leaseSocket,
      },
      confinement: {
        host: {
          rootfs: residentRootfsPath(stateRoot), libdir: root,
          node: realpathSync(process.execPath), systemBinds: hostSystemLayout().binds,
          pi: confinedPath(root, directories, runtime.args[0]!), piModeArgs: [],
          tmpBytes: 64 * 1024 * 1024,
          checkResources: { memoryBytes: 1 << 30, tasks: 64, cpuQuotaPercent: 100, tmpBytes: 1 << 26,
            workspaceBytes: 1 << 24, stagingBytes: 1 << 24, checkTimeoutSeconds: 30 },
          stateRoot, runRoot, limits: { frameBytes: 262144, batchMaxMessages: 24 },
        },
        lease, directories,
      },
    });
    const plan = adapter.spawnPlan();
    child = spawnSandboxed([plan.command, ...plan.args], plan.env);
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
