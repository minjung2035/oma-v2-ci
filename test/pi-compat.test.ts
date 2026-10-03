/** A7/A4: the Pi compatibility boundary, held to the vendored engine itself.
 *
 * The oracle tests do not mirror Pi's literals: they read them out of the
 * installed 0.87.1 package, so an upstream change in the session-environment
 * names, the exit hint or the wire emission fails here rather than drifting
 * past the boundary silently.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StoreError } from "../src/domain/errors.js";
import { ProcessLock } from "../src/runtime/process-lock.js";
import { PI_RESUME_HINT, PI_SESSION_ENV_NAMES } from "../src/pi-compat/env.js";
import { PI_INTERACTIVE_PRIVATE_MEMBERS } from "../src/pi-compat/interactive-mode.js";
import { sessionHeaderIdentity } from "../src/pi-compat/session.js";
import { OmaSettingsStorage, prepareEngineInteractiveSettings } from "../src/pi-compat/settings.js";
import type { PiInboundEvent, RpcCommand } from "../src/pi-compat/wire.js";
import { PiRpcClient, SKIPPED_EVENT, type PiObservedEvent } from "../src/runtime/pi-rpc.js";
import { preparePiRetry } from "../src/runtime/pi-runtime.js";
import { planPiSpawn, type PiAdapterOptions } from "../src/runtime/pi-spawn-plan.js";

const scratch = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix));
// The package's exports map hides ./package.json; the root is two levels up
// from its ESM entry (dist/index.js), as resolvePiRuntime finds it too.
const PI_ROOT = dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));

test("A7 oracle: the session-environment strip list covers every name the vendored engine clears", () => {
  // Pi exports these into commands it starts (core/tools/bash.js); an `oma`
  // launched inside one must not hand a parent session's identity onward.
  const bash = readFileSync(join(PI_ROOT, "dist", "core", "tools", "bash.js"), "utf8");
  const cleared = [...bash.matchAll(/delete env2?\.(PI_[A-Z_]+)/g)].map(match => match[1]);
  assert.ok(cleared.length > 0, "the vendored bash tool clears no PI_* environment names");
  for (const name of cleared)
    assert.ok((PI_SESSION_ENV_NAMES as readonly string[]).includes(name!),
      `the engine exports ${name} into subprocesses but the strip list omits it`);
});

test("A7 oracle: the resume hint is the text the vendored interactive mode emits", () => {
  const mode = readFileSync(join(PI_ROOT, "dist", "modes", "interactive", "interactive-mode.js"), "utf8");
  assert.ok(mode.includes(PI_RESUME_HINT), `the engine no longer emits ${JSON.stringify(PI_RESUME_HINT)}`);
});

test("A7 oracle: every private InteractiveMode member OMA overrides still exists on the vendored prototype", async () => {
  const { InteractiveMode } = await import("@earendil-works/pi-coding-agent");
  for (const name of PI_INTERACTIVE_PRIVATE_MEMBERS)
    assert.equal(typeof (InteractiveMode.prototype as unknown as Record<string, unknown>)[name], "function",
      `the engine's InteractiveMode no longer carries ${name}; the overrides in the entries now write a member nothing calls`);
});

test("A6: the session header probe accepts only the identity the engine could have written", async () => {
  const cwd = "/work/project";
  const good = { type: "session", id: "abc-123_X.y", timestamp: "2026-01-01T00:00:00.000Z", cwd, version: 3 };
  assert.deepEqual(await sessionHeaderIdentity(structuredClone(good), cwd), { id: good.id, timestamp: good.timestamp });
  // A header without a version predates versioned files and is still admitted.
  const unversioned = { ...good } as Record<string, unknown>; delete unversioned.version;
  assert.ok(await sessionHeaderIdentity(unversioned, cwd) !== null);
  for (const header of [
    { ...good, type: "entry" }, { ...good, id: "has spaces" }, { ...good, timestamp: "not a date" },
    { ...good, cwd: "/elsewhere" }, { ...good, version: 0 }, { ...good, version: 1 << 30 },
    "text", null, [good],
  ]) assert.equal(await sessionHeaderIdentity(header, cwd), null, JSON.stringify(header));
});

function spawnOptions(overrides: Partial<PiAdapterOptions> = {}): PiAdapterOptions {
  return {
    actor: "alice", society: "demo",
    profile: { provider: "pi", model: "current", inferenceSeconds: 60, prompt: "", extensions: [], workspaceBytes: 1 << 20 },
    limits: { frameBytes: 1 << 20, idleStreamSeconds: 30, receiptWaitSeconds: 30, batchMaxMessages: 24,
      mailBodyBytes: 1 << 20, contextBytes: 1 << 20, bundleBytes: 1 << 20 },
    paths: { piCommand: "/bin/pi", piAgentDir: "/agent", coreExtension: "/ext.js", cli: "/cli.js",
      workspace: "/w", sessionDir: "/s", agentHome: "/h", mailArchive: "/m", workerArchive: "/wa",
      projectGit: "/g", batchView: "/v", socket: "/sock" },
    ...overrides,
  };
}

test("A7: an unconfined engine never inherits a parent Pi session's environment", () => {
  const ambient: Record<string, string> = { OMA_KEEP: "1" };
  for (const name of [...PI_SESSION_ENV_NAMES, "PI_SESSION_CWD", "PI_SESSION_REASON"]) ambient[name] = "inherited";
  const saved = process.env;
  process.env = ambient;
  try {
    const env = planPiSpawn(spawnOptions()).env;
    for (const name of [...PI_SESSION_ENV_NAMES, "PI_SESSION_CWD", "PI_SESSION_REASON"])
      assert.equal(env[name], undefined, `${name} reached the engine's environment`);
    assert.equal(env.OMA_KEEP, "1");
    assert.equal(env.PI_CODING_AGENT_DIR, "/agent");
  } finally { process.env = saved; }
});

test("A4: absent settings get OMA's interactive defaults through the engine's own manager", t => {
  const root = scratch("oma-compat-settings-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  prepareEngineInteractiveSettings(root);
  const settings = JSON.parse(readFileSync(join(root, "settings.json"), "utf8"));
  assert.equal(settings.theme, "oma");
  assert.equal(settings.hideThinkingBlock, true);
  assert.equal(settings.quietStartup, true);
  assert.equal(settings.enableInstallTelemetry, false);
  assert.equal(settings.enableAnalytics, false);
  assert.equal(settings.enableSkillCommands, false);
  assert.equal(settings.fullscreenExitOutput, "resume-hint");
});

test("A4: the Human's choices are kept, telemetry is always off, and fields the engine does not own survive", t => {
  const root = scratch("oma-compat-settings-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "settings.json");
  writeFileSync(path, JSON.stringify({ theme: "dark", hideThinkingBlock: false, quietStartup: false,
    enableAnalytics: true, enableInstallTelemetry: true,
    // The bridge must keep what it was never asked to own: the retry owner is
    // preparePiRetry's fact, and an unknown field is the engine's own.
    retry: { enabled: true, maxRetries: 5, provider: { maxRetries: 0 } },
    customExtensionField: { nested: [1, 2] } }));
  prepareEngineInteractiveSettings(root);
  const settings = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(settings.theme, "dark");
  assert.equal(settings.hideThinkingBlock, false);
  assert.equal(settings.quietStartup, false);
  assert.equal(settings.enableAnalytics, false);
  assert.equal(settings.enableInstallTelemetry, false);
  assert.deepEqual(settings.retry, { enabled: true, maxRetries: 5, provider: { maxRetries: 0 } });
  assert.deepEqual(settings.customExtensionField, { nested: [1, 2] });
  // Nothing to change is not a write: a second preparation leaves the bytes.
  const before = readFileSync(path, "utf8");
  prepareEngineInteractiveSettings(root);
  assert.equal(readFileSync(path, "utf8"), before);
});

test("A4: the settings bridge and the retry owner compose in both orders under one lock", t => {
  for (const retryFirst of [false, true]) {
    const root = scratch("oma-compat-settings-");
    t.after(() => rmSync(root, { recursive: true, force: true }));
    if (retryFirst) { preparePiRetry(root); prepareEngineInteractiveSettings(root); }
    else { prepareEngineInteractiveSettings(root); preparePiRetry(root); }
    const settings = JSON.parse(readFileSync(join(root, "settings.json"), "utf8"));
    assert.equal(settings.retry.enabled, true, `order retryFirst=${retryFirst}`);
    assert.equal(settings.retry.maxRetries, 5);
    assert.equal(settings.retry.provider.maxRetries, 0);
    assert.equal(settings.theme, "oma");
    assert.equal(settings.fullscreenExitOutput, "resume-hint");
  }
});

test("A4: malformed or non-object settings are refused with the bytes untouched", t => {
  const root = scratch("oma-compat-settings-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "settings.json");
  for (const bytes of ["{", "[]", "[1,2]", "null", Buffer.from([0xff, 0xfe])]) {
    writeFileSync(path, bytes);
    assert.throws(() => prepareEngineInteractiveSettings(root));
    assert.deepEqual(readFileSync(path), Buffer.from(bytes), `bytes ${JSON.stringify(bytes)} changed`);
    // The writer lock came back: the next attempt can still be made.
    const lock = ProcessLock.tryAcquire(join(root, "oma-settings.lock"));
    assert.ok(lock, "the settings lock was not returned");
    lock.close();
  }
});

test("A4 / P0-5: a held settings lock refuses the write, keeps the bytes, and the retry after release lands", t => {
  const root = scratch("oma-compat-settings-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "settings.json");
  writeFileSync(path, '{"theme":"light"}');
  const lock = ProcessLock.acquire(join(root, "oma-settings.lock"));
  try {
    assert.throws(() => prepareEngineInteractiveSettings(root), (error: unknown) =>
      error instanceof StoreError && error.code === "BROKER_UNAVAILABLE");
    assert.equal(readFileSync(path, "utf8"), '{"theme":"light"}', "a refused writer changed the file");
  } finally { lock.close(); }
  prepareEngineInteractiveSettings(root);
  const settings = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(settings.theme, "light");
  assert.equal(settings.fullscreenExitOutput, "resume-hint");
});

test("A4: the engine's project scope has no OMA file; a write through it is refused, a read is absent", t => {
  const root = scratch("oma-compat-settings-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const storage = new OmaSettingsStorage(root);
  // A read-only lock answers absent, as the storage contract states.
  let seen: string | undefined | null = null;
  storage.withLock("project", current => { seen = current; return undefined; });
  assert.equal(seen, undefined);
  // A write would be a fact with no owner: refused, not dropped.
  assert.throws(() => storage.withLock("project", () => "{}"), (error: unknown) =>
    error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE");
});

test("A2/A7: every wire event kind the engine emits reaches an observer intact, beside the frame-overflow marker", { timeout: 10000 }, async t => {
  const lines = [
    { type: "response", id: "1", command: "get_state", success: true, data: { sessionId: "s" } },
    { type: "agent_start" },
    { type: "extension_ui_request", id: "e1", method: "notify", message: "OMA_PI_BOUNDARY_V1 {}", notifyType: "info" },
    { type: "extension_error", extensionPath: "/ext.js", event: "session_start", error: "boom", stack: "at x" },
  ];
  const child = spawn(process.execPath, ["-e",
    `process.stdout.write(${JSON.stringify(lines.map(line => JSON.stringify(line)).join("\n") + "\n")}); setInterval(() => {}, 1000)`],
    { stdio: ["pipe", "pipe", "pipe"] });
  const ended = once(child, "close");
  const client = new PiRpcClient(child, { frameBytes: 4096, idleStreamSeconds: 2, receiptWaitSeconds: 2 });
  t.after(() => client.close());
  const found: PiObservedEvent[] = [];
  const seenAll = new Promise<void>(resolve => client.onEvent(event => { found.push(event); if (found.length === lines.length) resolve(); }));
  await seenAll;
  assert.deepEqual(found.map(event => event.type), lines.map(line => line.type));
  const inbound = found as readonly PiInboundEvent[];
  const ui = inbound.find((event): event is Extract<PiInboundEvent, { type: "extension_ui_request" }> =>
    event.type === "extension_ui_request");
  assert.equal(ui?.method, "notify");
  const failure = inbound.find((event): event is Extract<PiInboundEvent, { type: "extension_error" }> =>
    event.type === "extension_error");
  assert.equal(failure?.extensionPath, "/ext.js");
  assert.equal(failure?.stack, "at x");
  client.close(); await ended;
});

test("A2: an RpcCommand serializes verbatim on the wire; a non-command is refused at compile time", { timeout: 10000 }, async t => {
  const child = spawn(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], { stdio: ["pipe", "pipe", "pipe"] });
  const ended = once(child, "close");
  const client = new PiRpcClient(child, { frameBytes: 4096, idleStreamSeconds: 2, receiptWaitSeconds: 2 });
  t.after(() => client.close());
  const echoed = new Promise<PiObservedEvent>(resolve => client.onEvent(resolve));
  const command: RpcCommand = { type: "prompt", message: "hello" };
  await client.send(command);
  // @ts-expect-error A2: the transport accepts Pi's command union, not OMA's broad event shape
  void client.send({ type: "not_a_pi_command" });
  const event = await echoed;
  assert.deepEqual(event, command);
  client.close(); await ended;
});

test("A2/DR15: the frame-overflow marker still reaches observers as OMA's own event", { timeout: 10000 }, async t => {
  const big = JSON.stringify({ type: "agent_end", payload: "x".repeat(20000) });
  const child = spawn(process.execPath, ["-e",
    `process.stdout.write(${JSON.stringify(`{"type":"agent_start"}\n${big}\n{"type":"agent_end"}\n`)}); setInterval(() => {}, 1000)`],
    { stdio: ["pipe", "pipe", "pipe"] });
  const ended = once(child, "close");
  const client = new PiRpcClient(child, { frameBytes: 4096, idleStreamSeconds: 2, receiptWaitSeconds: 2 });
  t.after(() => client.close());
  const found: PiObservedEvent[] = [];
  const seenAll = new Promise<void>(resolve => client.onEvent(event => { found.push(event); if (found.length === 3) resolve(); }));
  await seenAll;
  assert.equal(found[0]?.type, "agent_start");
  assert.equal(found[1]?.type, SKIPPED_EVENT);
  assert.equal((found[1] as { bytes?: number }).bytes, Buffer.byteLength(big));
  assert.equal(found[2]?.type, "agent_end");
  client.close(); await ended;
});

test("A7: the compat module is the only importer of engine wire names", () => {
  // The boundary fails closed by convention: production modules name Pi's
  // wire types through pi-compat, never the package directly (rpc surface).
  const source = readFileSync(join(process.cwd(), "src", "runtime", "pi-rpc.ts"), "utf8");
  assert.ok(!source.includes('from "@earendil-works/pi-coding-agent"'), "pi-rpc imports the package directly");
});

// Guard for environments where the vendored package layout was not installed.
assert.ok(existsSync(join(PI_ROOT, "dist", "core", "tools", "bash.js")), "the vendored engine tree is not readable");
