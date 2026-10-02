import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StoreError } from "../src/domain/errors.js";
import {
  ENGINE_HOME, PI_AGENT_DIR_ENV, PI_PACKAGE, adoptEngineHome,
  piAgentDir, piIsolationEnv, preparePiRetry, preparePiInteractive, resolvePiRuntime,
} from "../src/runtime/pi-runtime.js";
import { sessionArgv, sessionEnv } from "../src/tui/session.js";
import { SOCIETY_FENCE_ENV, SOCIETY_FENCE_FD } from "../src/process/async.js";
import {
  DEFAULT_MODEL_PROFILE, DEFAULT_PRINCIPAL_PROFILE, DEFAULT_RESIDENT_PROFILE,
  defaultHostConfig, societyFromDirectory,
} from "../src/config/defaults.js";
import { readSettings } from "../src/tui/sources/settings.js";

const scratch = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix));

test("INF-001: engine retry settings preserve unrelated fields and allow exactly five outer retries", t => {
  const root = scratch("oma-retry-settings-"); t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "settings.json");
  writeFileSync(path, JSON.stringify({ defaultProvider: "fake", theme: "dark", retry: {
    enabled: false, maxRetries: 99, baseDelayMs: 50, maxAgentDelayMs: 200, provider: { maxRetries: 9, timeoutMs: 3000 },
  } }));
  preparePiRetry(root);
  const result = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(result.defaultProvider, "fake"); assert.equal(result.theme, "dark");
  assert.deepEqual(result.retry, { enabled: true, maxRetries: 5, baseDelayMs: 50, maxAgentDelayMs: 200,
    provider: { maxRetries: 0, timeoutMs: 3000 } });
  const bytes = readFileSync(path, "utf8"); preparePiRetry(root); assert.equal(readFileSync(path, "utf8"), bytes);
  rmSync(path); preparePiRetry(root);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")).retry, { enabled: true, maxRetries: 5,
    baseDelayMs: 1000, maxAgentDelayMs: 8000, provider: { maxRetries: 0 } });
});

test("Open TUI: the preview's look is the default, the Human's own choices are kept, telemetry to Pi stays off", t => {
  const fresh = scratch("oma-open-defaults-"); t.after(() => rmSync(fresh, { recursive: true, force: true }));
  preparePiInteractive(fresh);
  const defaults = JSON.parse(readFileSync(join(fresh, "settings.json"), "utf8"));
  const defaultUi = JSON.parse(readFileSync(join(fresh, "open-tui.json"), "utf8"));
  assert.equal(defaults.theme, "oma"); assert.equal(defaults.hideThinkingBlock, true); assert.equal(defaults.quietStartup, true);
  assert.equal(JSON.parse(readFileSync(join(fresh, "themes", "oma.json"), "utf8")).vars.accent, "#cba6f7");
  assert.equal(defaultUi.thinkingPeek.lines, 0); assert.equal(defaultUi.telemetry.enabled, false);
  assert.equal(defaultUi.footerSegments, undefined, "Open TUI's own footer defaults apply");
  const root = scratch("oma-open-settings-"); t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "settings.json"), JSON.stringify({ theme: "dark", hideThinkingBlock: false, enableAnalytics: true }));
  writeFileSync(join(root, "open-tui.json"), JSON.stringify({ enabled: false, thinkingPeek: { lines: 2 }, footerSegments: { model: true } }));
  preparePiInteractive(root);
  const settings = JSON.parse(readFileSync(join(root, "settings.json"), "utf8"));
  const ui = JSON.parse(readFileSync(join(root, "open-tui.json"), "utf8"));
  assert.equal(settings.theme, "dark"); assert.equal(settings.hideThinkingBlock, false);
  assert.equal(settings.enableAnalytics, false);
  assert.equal(ui.enabled, true); assert.equal(ui.thinkingPeek.lines, 2);
  assert.deepEqual(ui.footerSegments, { model: true });
  const before = readFileSync(join(root, "open-tui.json"), "utf8");
  preparePiInteractive(root); assert.equal(readFileSync(join(root, "open-tui.json"), "utf8"), before);
});

test("INF-001: unreadable, malformed or linked settings cannot silently disable the retry policy", t => {
  const root = scratch("oma-retry-refuse-"); t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "settings.json"), target = join(root, "original.json");
  for (const bytes of ["{", "[]", '{"retry":[]}', '{"retry":{"provider":null}}']) {
    writeFileSync(path, bytes); assert.throws(() => preparePiRetry(root)); assert.equal(readFileSync(path, "utf8"), bytes);
  }
  rmSync(path); writeFileSync(target, "{}");
  for (const link of [symlinkSync, linkSync]) {
    link(target, path); assert.throws(() => preparePiRetry(root)); assert.equal(readFileSync(target, "utf8"), "{}"); rmSync(path);
  }
});

test("INF-001: the Resident adapter waits for five failed provider retries, then reports PROVIDER_FAILED without a boundary", { timeout: 30000 }, async t => {
  const { PiAdapter } = await import("../src/runtime/pi-adapter.js");
  const { scriptedProvider } = await import("./fixtures/scripted-provider.js");
  const root = scratch("oma-resident-retry-");
  const provider = await scriptedProvider(() => ({ kind: "cut" }));
  t.after(async () => { await provider.close(); rmSync(root, { recursive: true, force: true }); });
  for (const name of ["workspace", "sessions", "home", "archive", "view"]) mkdirSync(join(root, name));
  const runtime = resolvePiRuntime({ stateRoot: root }); provider.configure(runtime.agentDir);
  const batch = { id: "b-00000000-0000-4000-8000-000000000001", agent: "alice", incarnation: 1,
    messageIds: [], sessionPath: null, deliveryMode: "followUp" as const, notice: "Read this mail", indexPath: "/inbox.md" as const };
  writeFileSync(join(root, "view", `batch-${batch.id}.json`), JSON.stringify({ id: batch.id, agent: batch.agent,
    incarnation: batch.incarnation, messageIds: batch.messageIds, deliveryMode: batch.deliveryMode, notice: batch.notice }));
  const adapter = new PiAdapter({ actor: "alice", society: "demo",
    profile: { provider: "fake", model: "scripted", inferenceSeconds: 20, prompt: "", extensions: [], workspaceBytes: 1 << 20 },
    limits: { frameBytes: 1 << 20, idleStreamSeconds: 5, receiptWaitSeconds: 5, batchMaxMessages: 24, mailBodyBytes: 1 << 20, contextBytes: 1 << 20, bundleBytes: 1 << 20 },
    paths: { piCommand: runtime.executable, piArgs: runtime.args, piAgentDir: runtime.agentDir,
      coreExtension: join(process.cwd(), "dist/src/pi-extension.js"), cli: join(process.cwd(), "dist/src/cli.js"),
      workspace: join(root, "workspace"), sessionDir: join(root, "sessions"), agentHome: join(root, "home"),
      mailArchive: join(root, "archive"), workerArchive: join(root, "workers"), projectGit: join(root, "project.git"), batchView: join(root, "view"), socket: join(root, "absent.sock") } });
  await assert.rejects(adapter.deliver(batch), { code: "PROVIDER_FAILED" });
  assert.equal(provider.seen.length, 6);
  provider.script([{ kind: "text", text: "Recovered" }]);
  const boundary = await adapter.deliver(batch);
  assert.ok(boundary);
  assert.equal(boundary.batchId, batch.id);
  assert.equal(provider.seen.length, 7);
});

/** An installation tree that ships its own engine, like a deployed OMA. */
function installation(root: string, entry = "dist/bundle/cli.js"): string {
  const pkg = join(root, "node_modules", PI_PACKAGE);
  mkdirSync(join(pkg, "dist", "bundle"), { recursive: true });
  writeFileSync(join(pkg, "dist", "bundle", "cli.js"), "#!/usr/bin/env node\n");
  writeFileSync(join(pkg, "package.json"), JSON.stringify({
    name: PI_PACKAGE, version: "0.85.1", bin: { pi: entry },
  }));
  return pkg;
}

test("OMA runs the engine it shipped with, not one found on PATH", () => {
  const root = scratch("oma-pi-bundled-");
  try {
    installation(root);
    const runtime = resolvePiRuntime({ stateRoot: join(root, "state"), libdir: root });
    assert.equal(runtime.source, "bundled");
    assert.equal(runtime.bundle, join(root, "node_modules", PI_PACKAGE, "dist", "bundle", "cli.js"));
    // The bundle is JavaScript, so it runs under the Node that runs OMA.
    assert.equal(runtime.executable, process.execPath);
    assert.deepEqual(runtime.args, [runtime.bundle]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the engine entry comes from the package's own bin, not a guessed path", () => {
  const root = scratch("oma-pi-bin-");
  try {
    const pkg = installation(root, "custom/entry.js");
    mkdirSync(join(pkg, "custom"), { recursive: true });
    writeFileSync(join(pkg, "custom", "entry.js"), "\n");
    const runtime = resolvePiRuntime({ stateRoot: join(root, "state"), libdir: root });
    assert.equal(runtime.bundle, join(pkg, "custom", "entry.js"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a package that is not Pi is never accepted as the engine", () => {
  const root = scratch("oma-pi-wrong-");
  try {
    const pkg = join(root, "node_modules", PI_PACKAGE);
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "something-else", bin: { pi: "cli.js" } }));
    writeFileSync(join(pkg, "cli.js"), "\n");
    // WP31: a directory that merely has the right name is not an engine, and
    // the installation does not borrow another installation's instead.
    assert.throws(() => resolvePiRuntime({ stateRoot: join(root, "state"), libdir: root }), (error: unknown) =>
      error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("an operator may pin an engine, and a missing or relative pin is refused", () => {
  const root = scratch("oma-pi-pin-");
  try {
    const pinned = join(root, "pi");
    writeFileSync(pinned, "#!/bin/sh\n");
    chmodSync(pinned, 0o755);
    const runtime = resolvePiRuntime({ stateRoot: join(root, "state"), override: pinned });
    assert.equal(runtime.source, "host-pinned");
    assert.equal(runtime.executable, pinned);
    assert.deepEqual(runtime.args, [], "a pinned executable runs directly");

    assert.throws(() => resolvePiRuntime({ stateRoot: root, override: "pi" }), (error: unknown) =>
      error instanceof StoreError && /absolute path/.test(error.message));
    assert.throws(() => resolvePiRuntime({ stateRoot: root, override: join(root, "absent") }), (error: unknown) =>
      error instanceof StoreError && /missing/.test(error.message));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("an installation without an engine fails closed instead of using a PATH Pi", () => {
  const root = scratch("oma-pi-none-");
  try {
    // libdir has no engine; resolution must reach neither for a Pi on PATH nor
    // for another installation's engine (WP31) -- it refuses.
    assert.throws(() => resolvePiRuntime({ stateRoot: join(root, "state"), libdir: root }), (error: unknown) =>
      error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE" && /does not fall back/.test(error.message));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("DR24: the engine is pointed at the Human's one OMA engine home, beside every session and never the user's own Pi", () => {
  const stateRoot = "/var/lib/oma/demo";
  const runtime = resolvePiRuntime({ stateRoot });
  assert.equal(runtime.agentDir, piAgentDir(stateRoot));
  assert.equal(runtime.agentDir, join("/var/lib/oma", ENGINE_HOME));
  // Every session of every project shares it: a login and a model chosen once hold.
  assert.equal(piAgentDir("/var/lib/oma/other-1234"), runtime.agentDir);
  const isolation = piIsolationEnv(runtime);
  assert.equal(isolation[PI_AGENT_DIR_ENV], runtime.agentDir);
  // The user's own Pi state must not appear anywhere in what we hand the engine.
  assert.doesNotMatch(runtime.agentDir, /(^|\/)\.pi(\/|$)/);
  assert.ok(runtime.agentDir.startsWith("/var/lib/oma/"));
});

test("DR24: the engine home takes on every earlier society's login, the newest where two hold one provider, and keeps its own", t => {
  const data = scratch("oma-engine-home-"); t.after(() => rmSync(data, { recursive: true, force: true }));
  const earlier = (society: string, auth: Record<string, unknown>, ageMs: number): void => {
    mkdirSync(join(data, society, "pi", "bin"), { recursive: true });
    writeFileSync(join(data, society, "pi", "auth.json"), JSON.stringify(auth));
    writeFileSync(join(data, society, "pi", "settings.json"), JSON.stringify({ theme: society }));
    writeFileSync(join(data, society, "pi", "bin", "rg"), "#!/bin/sh\n");
    const when = new Date(Date.now() - ageMs);
    utimesSync(join(data, society, "pi", "auth.json"), when, when);
    utimesSync(join(data, society, "pi", "settings.json"), when, when);
  };
  earlier("first", { anthropic: { key: "old" }, groq: { key: "g" } }, 60_000);
  earlier("second", { anthropic: { key: "new" } }, 1_000);
  const home = join(data, ENGINE_HOME);
  adoptEngineHome(home);
  assert.deepEqual(JSON.parse(readFileSync(join(home, "auth.json"), "utf8")), { anthropic: { key: "new" }, groq: { key: "g" } });
  assert.equal(JSON.parse(readFileSync(join(home, "settings.json"), "utf8")).theme, "second");
  assert.equal(readFileSync(join(home, "bin", "rg"), "utf8"), "#!/bin/sh\n");
  // Once the home has a login, a later start leaves it as the Human set it.
  writeFileSync(join(home, "auth.json"), JSON.stringify({ openai: { key: "mine" } }));
  adoptEngineHome(home);
  assert.deepEqual(JSON.parse(readFileSync(join(home, "auth.json"), "utf8")), { openai: { key: "mine" } });
  // A start that died after adopting the login and before the settings: the
  // next start adopts what is still missing and leaves what was adopted.
  rmSync(join(home, "settings.json"));
  adoptEngineHome(home);
  assert.equal(JSON.parse(readFileSync(join(home, "settings.json"), "utf8")).theme, "second");
  assert.deepEqual(JSON.parse(readFileSync(join(home, "auth.json"), "utf8")), { openai: { key: "mine" } });
});

test("the Principal session carries the isolation variable to the engine", () => {
  const env = sessionEnv({ HOME: "/h", PATH: "/usr/bin" }, {
    society: "demo", provider: "pi", model: "current", workspaceBytes: 1024, extensions: [],
  }, { piAgentDir: "/var/lib/oma/demo/pi" });
  assert.equal(env[PI_AGENT_DIR_ENV], "/var/lib/oma/demo/pi");
  assert.equal(env.HOME, "/h");
  const without = sessionEnv({ HOME: "/h" }, {
    society: "demo", provider: "pi", model: "current", workspaceBytes: 1024, extensions: [],
  });
  assert.ok(!(PI_AGENT_DIR_ENV in without));
});

test("REC-007: the Principal session tells the engine which descriptor its society lease is on", () => {
  // The engine inherits the lease whether or not it is told, but it starts the
  // model-facing CLI -- a writer of this society's private state that survives
  // signals sent to the engine -- and it can only pass the lease on to a
  // descriptor it can name. Inferring the number from how it was spawned is
  // not available to it: the trusted extension inside it cannot see the host's
  // spawn flags. So the number is declared, and an fd number grants nothing to
  // anyone who was not handed the descriptor.
  const profile = { society: "demo", provider: "pi", model: "current", workspaceBytes: 1024, extensions: [] };
  const fenced = sessionEnv({ HOME: "/h" }, profile, { piAgentDir: "/p", fence: 41 });
  assert.equal(fenced[SOCIETY_FENCE_ENV], String(SOCIETY_FENCE_FD),
    "the engine was told a descriptor other than the one the host places the lease on");
  // Not the host's own number for it: what the engine has is the slot it was
  // handed, and saying otherwise would send it to a descriptor of its own.
  assert.notEqual(fenced[SOCIETY_FENCE_ENV], "41");
  // A session started with no fence declares none, so a Pi run by hand outside
  // a society is not told to pass on a lease it does not have.
  const unfenced = sessionEnv({ HOME: "/h" }, profile, { piAgentDir: "/p" });
  assert.ok(!(SOCIETY_FENCE_ENV in unfenced), "a session with no lease claimed one");
  assert.ok(!(SOCIETY_FENCE_ENV in sessionEnv({ HOME: "/h" }, profile)));
});

test("the engine entry precedes Pi's own flags on the command line", () => {
  const runtime = resolvePiRuntime({ stateRoot: "/s" });
  const argv = [...runtime.args, ...sessionArgv(
    { piCommand: runtime.executable, piArgs: runtime.args, coreExtension: "/lib/core.js",
      sessionDir: "/s", workspace: "/w", home: "/h" },
    { society: "demo", provider: "pi", model: "current", workspaceBytes: 1024, extensions: [] },
  )];
  assert.equal(argv[0], runtime.bundle, "the bundle is argv[0] for Node");
  assert.equal(argv[1], "--mode");
  assert.equal(argv[2], "rpc");
});

test("T106/TUI-019: running in a bare project needs no setup command and no hand-written config", () => {
  const root = scratch("oma-zeroconf-");
  try {
    const config = defaultHostConfig({
      society: societyFromDirectory("/home/someone/My Project"),
      node: process.execPath, libdir: root, rootfs: "/", deploymentDigest: "a".repeat(64),
    });
    // The society follows the project directory, so two checkouts stay apart.
    assert.equal(config.society, "my-project");
    assert.equal(societyFromDirectory("/x/2024-notes"), "notes");
    assert.equal(societyFromDirectory("/"), "workspace");

    const path = join(root, "config.json");
    writeFileSync(path, JSON.stringify(config, null, 2));
    // The generated file must satisfy the real closed validator, not a relaxed one.
    const loaded = readSettings(path).config;

    // Model and credentials stay the engine's own flow: OMA claims neither.
    const model = loaded.modelProfiles[DEFAULT_MODEL_PROFILE]!;
    assert.equal(model.provider, "pi");
    assert.equal(model.model, "current");

    // CFG-002: nothing unlimited, and integration stays an explicit empty set.
    assert.ok(loaded.quota.societyAgents > 0 && Number.isFinite(loaded.quota.societyAgents));
    assert.ok(loaded.quota.storageBytes > 0 && Number.isFinite(loaded.quota.storageBytes));
    assert.deepEqual(loaded.integration.checks, []);
    assert.deepEqual(loaded.integration.protectedPaths, []);

    // A Resident does not get canonical main by default.
    assert.ok(!loaded.agentProfiles[DEFAULT_RESIDENT_PROFILE]!.capabilities.includes("code.integrate"));
    assert.ok(!loaded.agentProfiles[DEFAULT_PRINCIPAL_PROFILE]!.capabilities.includes("code.integrate"));
    // DR27: one host seed, still gated on GOAL before activation.
    assert.deepEqual(loaded.initialResidents.map(seed => ({ name: seed.name, profile: seed.profile })),
      [{ name: "worker-1", profile: DEFAULT_RESIDENT_PROFILE }]);

    // Every generated value is reachable from the Control Panel.
    const fields = readSettings(path).fields.map(field => field.id);
    for (const id of ["principal-model", "worker-model", "worker-limit"])
      assert.ok(fields.includes(id), `${id} must be editable`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

