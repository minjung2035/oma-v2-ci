/** Regressions for the numbered 2514385f backlog; no provider/native namespace qualification. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { connect, createServer, type Socket } from "node:net";
import { loadConfigurationSnapshot, validateConfig } from "@oma/config";
import { commitInlineConfiguration, commitManagedGeneration } from "@oma/config/generations";
import { startProcess } from "@oma/process/async";
import { registerMcpTools } from "@oma/tool-mcp";
import { isAskRequest, isAskClaim, isAskResponse, isAskCancel } from "@oma/protocol/ask-user-question";
import { RequestCache } from "#oma-test/app/request-cache";
import { provisionSociety } from "#oma-test/app/runtime/provision";
import { startInferenceBridge } from "@oma/extension/inference-bridge";
import { createCompleteConfigurationFixture } from "./fixtures/configuration.js";
import { withinDirectory } from "@oma/native/files";
import { lockFileDescriptor } from "@oma/native/linux";

function directory(t: import("node:test").TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "oma-backlog-"));
  t.after(() => rmSync(root, { recursive: true, force: true })); return root;
}

for (const kind of ["inline", "managed"] as const)
  test(`001. Remaining runtime regressions: ${kind} configuration holds a cross-process writer through the rename`, t => {
    const f = createCompleteConfigurationFixture(); t.after(f.close);
    const path = kind === "inline" ? f.input : f.path;
    const snapshot = loadConfigurationSnapshot(path);
    const candidate = validateConfig({ ...snapshot.config, modelProfiles: { ...snapshot.config.modelProfiles,
      standard: { ...snapshot.config.modelProfiles.standard!, model: "parent-edit" } } });
    let attempted = false;
    const faults = (point: { point: string; phase: string; path: string }) => {
      if (attempted || point.point !== "derived-rename" || point.phase !== "before" || point.path !== path) return;
      attempted = true;
      const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
        import {loadConfigurationSnapshot,validateConfig} from '@oma/config';
        import {commitInlineConfiguration,commitManagedGeneration} from '@oma/config/generations';
        const s=loadConfigurationSnapshot(${JSON.stringify(path)});
        const c=validateConfig({...s.config,modelProfiles:{...s.config.modelProfiles,review:{...s.config.modelProfiles.review,model:'child-edit'}}});
        try { ${kind === "inline" ? "commitInlineConfiguration(s,c)" : "commitManagedGeneration(s,{config:c})"}; console.log('COMMITTED'); }
        catch(e) { console.log(e.code); }
      `], { cwd: process.cwd(), encoding: "utf8", timeout: 5000 });
      assert.equal(child.status, 0, child.stderr);
      assert.equal(child.stdout.trim(), "BROKER_UNAVAILABLE", "a second process must not commit between the version check and rename");
    };
    if (kind === "inline") commitInlineConfiguration(snapshot, candidate, faults);
    else commitManagedGeneration(snapshot, { config: candidate }, faults);
    assert.equal(attempted, true);
    const after = loadConfigurationSnapshot(path);
    assert.equal(after.config.modelProfiles.standard!.model, "parent-edit");
    assert.equal(after.config.modelProfiles.review!.model, snapshot.config.modelProfiles.review!.model);
    assert.throws(() => kind === "inline" ? commitInlineConfiguration(snapshot, candidate) : commitManagedGeneration(snapshot, { config: candidate }), { code: "POLICY_CHANGED" });
  });
test("002. Configuration editing does not contend with the Society's parent-directory tenure", t => {
  const f = createCompleteConfigurationFixture(); t.after(f.close);
  const snapshot = loadConfigurationSnapshot(f.input);
  withinDirectory(f.input, directory => {
    assert.equal(lockFileDescriptor(directory).kind, "held");
    assert.doesNotThrow(() => commitInlineConfiguration(snapshot, validateConfig(snapshot.config)));
  });
});
test("003. A collector from a second Society cannot remove an active configuration publication", t => {
  const f = createCompleteConfigurationFixture(); t.after(f.close);
  const snapshot = loadConfigurationSnapshot(f.path);
  const candidate = validateConfig({ ...snapshot.config, modelProfiles: { ...snapshot.config.modelProfiles,
    standard: { ...snapshot.config.modelProfiles.standard!, model: "pending-publication" } } });
  let attempted = false;
  commitManagedGeneration(snapshot, { config: candidate }, point => {
    if (attempted || point.point !== "derived-rename" || point.phase !== "before" || point.path !== f.path) return;
    attempted = true;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import {loadConfigurationSnapshot} from '@oma/config';
      import {collectManagedGenerations} from '@oma/config/generations';
      try { collectManagedGenerations(loadConfigurationSnapshot(${JSON.stringify(f.path)})); console.log('COLLECTED'); }
      catch(e) { console.log(e.code); }
    `], { encoding: "utf8", timeout: 5000 });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout.trim(), "BROKER_UNAVAILABLE", "collection must use the publication lock, not a different Society tenure");
  });
  assert.equal(attempted, true);
  assert.equal(loadConfigurationSnapshot(f.path).config.modelProfiles.standard!.model, "pending-publication");
});

for (const stream of ["stdout", "stderr"] as const)
  test(`004. Remaining runtime regressions: ${stream} spool refuses an existing hardlink without changing its inode`, async t => {
    const root = directory(t), victim = join(root, "victim"), spool = join(root, "spool");
    writeFileSync(victim, "preserve existing bytes"); linkSync(victim, spool);
    const task = startProcess({ executable: process.execPath, argv: ["-e", `process.${stream}.write('x'.repeat(8192))`], env: {}, timeoutMs: 2000,
      stdoutBytes: 8, stderrBytes: 8, [stream === "stdout" ? "stdoutSpool" : "stderrSpool"]: spool });
    const result = await task.result; await task.closed;
    assert.equal(result.errorCode, "EEXIST");
    assert.equal(readFileSync(victim, "utf8"), "preserve existing bytes");
    assert.equal(readFileSync(spool, "utf8"), "preserve existing bytes");
  });

function mcpHarness() {
  const tools: string[] = [], hooks = new Map<string, Array<(...args: never[]) => unknown>>();
  const api = {
    registerTool(tool: { name: string }) { tools.push(tool.name); },
    on(event: string, handler: (...args: never[]) => unknown) { hooks.set(event, [...(hooks.get(event) ?? []), handler]); },
    events: { on() {}, emit() { return false; }, off() {} },
    appendEntry() {}, sendMessage() {}, sendUserMessage() {}, getFlag() {},
    getActiveTools() { return []; }, setActiveTools() {}, getAllTools() { return tools.map(name => ({ name })); },
    registerCommand() { assert.fail("no extra MCP command"); }, registerShortcut() {}, registerFlag() {},
    exec() { assert.fail("registration must not execute a child"); },
  };
  return { api, tools, async shutdown() {
    const context = { sessionManager: { getBranch: () => [] }, ui: { setStatus() {}, notify() {} }, hasUI: false };
    for (const handler of hooks.get("session_shutdown") ?? []) await handler({} as never, context as never);
  } };
}
test("005. Valid private MCP state registers the real adapter (positive control)", async t => {
  const root = directory(t), h = mcpHarness();
  await registerMcpTools(h.api as never, { agentDir: root, config: { mcpServers: {} } });
  assert.deepEqual(h.tools, ["mcp"]);
  assert.equal(Buffer.from(readFileSync(join(root, "mcp-adapter/oauth-file-key"), "utf8").trim(), "base64").length, 32);
  await h.shutdown();
});
for (const entry of ["mcp-adapter", "mcp-adapter/scratch", "mcp-adapter/oauth", "mcp-adapter/oauth-file-key"])
  test(`006. MCP contains a linked ${entry} without changing the external target`, async t => {
    const root = directory(t), agent = join(root, "agent"), external = join(root, "external"), h = mcpHarness();
    mkdirSync(agent); mkdirSync(external); chmodSync(external, 0o755);
    const sentinel = join(external, "sentinel"); writeFileSync(sentinel, "keep me");
    const target = entry.endsWith("oauth-file-key") ? join(external, "key") : external;
    const original = `${Buffer.alloc(32, 1).toString("base64")}\n`;
    if (target !== external) writeFileSync(target, original, { mode: 0o640 });
    if (entry !== "mcp-adapter") mkdirSync(join(agent, "mcp-adapter"));
    symlinkSync(target, join(agent, entry));
    const registration = registerMcpTools(h.api as never, { agentDir: agent, config: { mcpServers: {} } });
    if (entry.endsWith("/scratch")) {
      // A per-engine leaf does not depend on or traverse the old shared scratch alias.
      await registration; assert.deepEqual(h.tools, ["mcp"]); await h.shutdown();
    } else {
      await assert.rejects(registration, /ELOOP|ENOTDIR|private state/);
      assert.deepEqual(h.tools, []);
    }
    assert.equal(statSync(external).mode & 0o777, 0o755);
    assert.equal(readFileSync(sentinel, "utf8"), "keep me");
    if (target !== external) { assert.equal(readFileSync(target, "utf8"), original); assert.equal(statSync(target).mode & 0o777, 0o640); }
    assert.equal(existsSync(join(external, "oauth-file-key")), false);
  });

test("007. Malformed ask payload guards are total for null/undefined and primitive values", () => {
  for (const guard of [isAskRequest, isAskClaim, isAskResponse, isAskCancel])
    for (const value of [null, undefined, false, 0, "bad", {}, []]) assert.equal(guard(value), false);
  assert.equal(isAskRequest({ id: "request", questions: [{ question: "Q?", header: "Q", options: [{ label: "Yes", description: "yes" }] }] }), true);
});

test("008. Mutation cache repairs its owned directory before freeze/replay observations", t => {
  const root = directory(t), cache = new RequestCache(root);
  const input = { key: "first", method: "route.follow" as const, params: { topic: "dev" }, createdAtMs: 1 };
  cache.freeze(input);
  const path = join(root, ".local/state/oma/requests"); chmodSync(path, 0);
  assert.equal(new RequestCache(root).prepareReplay(input).key, "first");
  chmodSync(path, 0);
  assert.equal(new RequestCache(root).freeze({ ...input, key: "second" }).kind, "created");
  assert.equal(statSync(path).mode & 0o700, 0o700);
});

test("009. Provisioning repairs repos before collecting repository staging", t => {
  const root = directory(t);
  provisionSociety(root, { conversationOnly: true });
  chmodSync(join(root, "repos"), 0);
  assert.doesNotThrow(() => provisionSociety(root, { conversationOnly: true }));
  assert.equal(statSync(join(root, "repos")).mode & 0o700, 0o700);
});

test("010. Inference shutdown destroys accepted downstream and upstream connections", { timeout: 5000 }, async t => {
  const root = directory(t), path = join(root, "relay.sock");
  let peer: Socket | undefined, client: Socket | undefined;
  const upstream = createServer(socket => { peer = socket; });
  upstream.listen(path); await once(upstream, "listening");
  let shutdown: (() => void) | undefined, baseUrl = "";
  const environment = { OMA_INFERENCE_SOCKET: path, OMA_INFERENCE_PROVIDER: "fixture", OMA_INFERENCE_KEY: "placeholder", OMA_INFERENCE_PORT: "49152" };
  const previous = new Map(Object.keys(environment).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, environment);
    await startInferenceBridge({ on(_event: string, handler: () => void) { shutdown = handler; }, registerProvider(_name: string, value: { baseUrl: string }) { baseUrl = value.baseUrl; } } as never);
    const connected = once(upstream, "connection");
    client = connect(Number(new URL(baseUrl).port), "127.0.0.1"); await connected;
    const downstreamClosed = once(client, "close"), upstreamClosed = once(peer!, "close");
    shutdown!();
    const deadline = new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error("accepted relay sockets survived shutdown")), 1000); timer.unref(); });
    await Promise.race([Promise.all([downstreamClosed, upstreamClosed]), deadline]);
  } finally {
    for (const [key, value] of previous) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    shutdown?.(); client?.destroy(); peer?.destroy(); await new Promise<void>(resolve => upstream.close(() => resolve()));
  }
});
