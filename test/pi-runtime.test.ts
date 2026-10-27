import { engineSettingsFiles } from "#oma-test/app/engine/settings-files";
import { sha256Hex } from "@oma/domain/canonical-json";
import test from "node:test";
import { RESIDENT_TEST_OPTIONS } from "./fixtures/resident.js";
import assert from "node:assert/strict";
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StoreError } from "@oma/domain/errors";
import {
  ENGINE_HOME, PI_AGENT_DIR_ENV, PI_PACKAGE,
  piAgentDir, piIsolationEnv, preparePiRetry, resolvePiRuntime,
} from "@oma/engine/pi-runtime";
import { preparePiInteractive } from "@oma/engine/pi-presentation";
import { sessionArgv, sessionEnv } from "@oma/engine/principal-session";
import { SOCIETY_FENCE_ENV, SOCIETY_FENCE_FD } from "@oma/process/async";
import {
  DEFAULT_MODEL_PROFILE, DEFAULT_PRINCIPAL_PROFILE, DEFAULT_RESIDENT_PROFILE,
  defaultHostConfig, defaultSocietyFor,
} from "@oma/config/defaults";
import { readSettings } from "#oma-test/app/application/settings";

const scratch = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix));

test("INF-001: engine retry settings preserve unrelated fields and allow exactly five outer retries", t => {
  const root = scratch("oma-retry-settings-"); t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "settings.json");
  writeFileSync(path, JSON.stringify({ defaultProvider: "fake", theme: "dark", retry: {
    enabled: false, maxRetries: 99, baseDelayMs: 50, maxAgentDelayMs: 200, provider: { maxRetries: 9, timeoutMs: 3000 },
  } }));
  preparePiRetry(engineSettingsFiles, root);
  const result = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(result.defaultProvider, "fake"); assert.equal(result.theme, "dark");
  assert.deepEqual(result.retry, { enabled: true, maxRetries: 5, baseDelayMs: 50, maxAgentDelayMs: 200,
    provider: { maxRetries: 0, timeoutMs: 3000 } });
  const bytes = readFileSync(path, "utf8"); preparePiRetry(engineSettingsFiles, root); assert.equal(readFileSync(path, "utf8"), bytes);
  rmSync(path); preparePiRetry(engineSettingsFiles, root);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")).retry, { enabled: true, maxRetries: 5,
    baseDelayMs: 1000, maxAgentDelayMs: 8000, provider: { maxRetries: 0 } });
});

test("Open TUI: the preview's look is the default, the Human's own choices are kept, telemetry to Pi stays off", t => {
  const fresh = scratch("oma-open-defaults-"); t.after(() => rmSync(fresh, { recursive: true, force: true }));
  preparePiInteractive(engineSettingsFiles, fresh);
  const defaults = JSON.parse(readFileSync(join(fresh, "settings.json"), "utf8"));
  const defaultUi = JSON.parse(readFileSync(join(fresh, "open-tui.json"), "utf8"));
  assert.equal(defaults.theme, "oma"); assert.equal(defaults.hideThinkingBlock, true); assert.equal(defaults.quietStartup, true);
  assert.equal(JSON.parse(readFileSync(join(fresh, "themes", "oma.json"), "utf8")).vars.accent, "#cba6f7");
  assert.equal(defaultUi.thinkingPeek.lines, 0); assert.equal(defaultUi.telemetry.enabled, false);
  assert.equal(defaultUi.footerSegments, undefined, "Open TUI's own footer defaults apply");
  const root = scratch("oma-open-settings-"); t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "settings.json"), JSON.stringify({ theme: "dark", hideThinkingBlock: false, enableAnalytics: true,
    enableSkillCommands: false }));
  writeFileSync(join(root, "open-tui.json"), JSON.stringify({ enabled: false, thinkingPeek: { lines: 2 }, footerSegments: { model: true } }));
  preparePiInteractive(engineSettingsFiles, root);
  const settings = JSON.parse(readFileSync(join(root, "settings.json"), "utf8"));
  const ui = JSON.parse(readFileSync(join(root, "open-tui.json"), "utf8"));
  assert.equal(settings.theme, "dark"); assert.equal(settings.hideThinkingBlock, false);
  assert.equal(settings.enableAnalytics, false);
  // Pi supplies its default; an explicit Human choice survives preparation.
  assert.equal(settings.enableSkillCommands, false);
  assert.ok(!("enableSkillCommands" in defaults), "a fresh settings file carries the suppression");
  assert.equal(ui.enabled, true); assert.equal(ui.thinkingPeek.lines, 2);
  assert.deepEqual(ui.footerSegments, { model: true });
  const before = readFileSync(join(root, "open-tui.json"), "utf8");
  preparePiInteractive(engineSettingsFiles, root); assert.equal(readFileSync(join(root, "open-tui.json"), "utf8"), before);
});

test("INF-001: unreadable, malformed or linked settings cannot silently disable the retry policy", t => {
  const root = scratch("oma-retry-refuse-"); t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "settings.json"), target = join(root, "original.json");
  // Every refusal is the taxonomy's, never a raw SyntaxError: bytes that do
  // not parse are STORE_CORRUPT; parsed values outside the settings grammar
  // are UNSUPPORTED_PROFILE, as settingsObject classifies them.
  for (const [bytes, code] of [
    ["{", "STORE_CORRUPT"], ["[]", "UNSUPPORTED_PROFILE"],
    ['{"retry":[]}', "UNSUPPORTED_PROFILE"], ['{"retry":{"provider":null}}', "UNSUPPORTED_PROFILE"],
  ] as const) {
    writeFileSync(path, bytes);
    assert.throws(() => preparePiRetry(engineSettingsFiles, root), (error: unknown) =>
      error instanceof StoreError && error.code === code && !(error instanceof SyntaxError),
      `${bytes} must fail classified`);
    assert.equal(readFileSync(path, "utf8"), bytes);
  }
  // A malformed sibling file fails the same way, on a settings file that
  // parses.
  writeFileSync(path, "{}");
  writeFileSync(join(root, "keybindings.json"), "{");
  assert.throws(() => preparePiInteractive(engineSettingsFiles, root), (error: unknown) =>
    error instanceof StoreError && error.code === "STORE_CORRUPT");
  rmSync(path); writeFileSync(target, "{}");
  for (const link of [symlinkSync, linkSync]) {
    link(target, path); assert.throws(() => preparePiRetry(engineSettingsFiles, root)); assert.equal(readFileSync(target, "utf8"), "{}"); rmSync(path);
  }
});

test("P0-8/DR32: a mode-000 agent directory or themes tail is repaired inside its boundary, never wedged on", t => {
  // The wedge this regression names: a same-UID stray left `.engine` (or its
  // `themes` tail) mode-000, and the plain ensure wedged on EACCES before any
  // settings file could be written -- the Resident never spawned.
  const root = scratch("oma-agent-dir-000-"); t.after(() => { chmodSync(root, 0o700); rmSync(root, { recursive: true, force: true }); });
  chmodSync(root, 0o000);
  preparePiRetry(engineSettingsFiles, root);
  assert.equal(statSync(root).mode & 0o777, 0o700, "the damaged leaf is repaired to owner access");
  assert.equal(JSON.parse(readFileSync(join(root, "settings.json"), "utf8")).retry.maxRetries, 5);
  // The deeper tail: `.engine` is sound and `themes` alone is the stray's.
  chmodSync(root, 0o700);
  mkdirSync(join(root, "themes")); chmodSync(join(root, "themes"), 0o000);
  preparePiInteractive(engineSettingsFiles, root);
  assert.equal(statSync(join(root, "themes")).mode & 0o777, 0o700, "the damaged tail is repaired");
  assert.equal(JSON.parse(readFileSync(join(root, "themes", "oma.json"), "utf8")).name, "oma");
  assert.equal(JSON.parse(readFileSync(join(root, "open-tui.json"), "utf8")).enabled, true);
});

test("P0-8/DR32: damage above the ownership boundary is refused, never repaired or read as absent", t => {
  // `preparePiInteractive`'s boundary is the agent directory itself: a stray
  // mode-000 on its parent is the caller's, and oma does not touch it -- the
  // walk refuses rather than silently claiming the directory absent.
  const parent = scratch("oma-agent-parent-000-"); t.after(() => { chmodSync(parent, 0o700); rmSync(parent, { recursive: true, force: true }); });
  const agentDir = join(parent, "engine");
  mkdirSync(agentDir); chmodSync(parent, 0o000);
  assert.throws(() => preparePiInteractive(engineSettingsFiles, agentDir));
  assert.equal(statSync(parent).mode & 0o777, 0o000, "the ancestor above the boundary keeps its mode");
});

test("INF-001: the Resident adapter waits for five failed provider retries, then reports PROVIDER_FAILED without a boundary", RESIDENT_TEST_OPTIONS, async () => {
  const { withScenario } = await import("./fixtures/scenario.js");
  await withScenario({ residents: ["alice"] }, async s => {
    await s.residentSends("alice", { to: ["alice"], subject: "Retry", body: "Read this mail" }, "retry-task");
    s.script(() => ({ kind: "cut" }));
    const failed = await s.activate("alice");
    assert.notEqual(failed.code, 0);
    assert.match(failed.stderr, /PROVIDER_FAILED/);
    assert.equal(s.provider.seen.length, 6);
    assert.equal(s.store.preparedBatches("alice").length, 1);
    s.script([{ kind: "text", text: "Recovered" }]);
    await s.restartBroker();
    const recovered = await s.activate("alice");
    assert.equal(recovered.code, 0, recovered.stderr);
    assert.deepEqual(s.store.preparedBatches("alice"), []);
    assert.equal(s.provider.seen.length, 7);
  });
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
    const runtime = resolvePiRuntime({ libdir: root, stateRoot: join(root, "state"), override: pinned });
    assert.equal(runtime.source, "host-pinned");
    assert.equal(runtime.executable, pinned);
    assert.deepEqual(runtime.args, [], "a pinned executable runs directly");

    assert.throws(() => resolvePiRuntime({ libdir: root, stateRoot: root, override: "pi" }), (error: unknown) =>
      error instanceof StoreError && /absolute path/.test(error.message));
    assert.throws(() => resolvePiRuntime({ libdir: root, stateRoot: root, override: join(root, "absent") }), (error: unknown) =>
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
  const runtime = resolvePiRuntime({ libdir: process.cwd(), stateRoot });
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

test("the Principal session carries the isolation variable to the engine", () => {
  const env = sessionEnv({ HOME: "/h", PATH: "/usr/bin" }, {
    society: "demo", provider: "pi", model: "current", extensions: [],
  }, { piAgentDir: "/var/lib/oma/demo/pi" });
  assert.equal(env[PI_AGENT_DIR_ENV], "/var/lib/oma/demo/pi");
  assert.equal(env.HOME, "/h");
  const without = sessionEnv({ HOME: "/h" }, {
    society: "demo", provider: "pi", model: "current", extensions: [],
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
  const profile = { society: "demo", provider: "pi", model: "current", extensions: [] };
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
  const runtime = resolvePiRuntime({ libdir: process.cwd(), stateRoot: "/s" });
  const argv = [...runtime.args, ...sessionArgv(
    { piCommand: runtime.executable, piArgs: runtime.args, coreExtension: "/lib/core.js",
      sessionDir: "/s", workspace: "/w", home: "/h" },
    { society: "demo", provider: "pi", model: "current", extensions: [] },
  )];
  assert.equal(argv[0], runtime.bundle, "the bundle is argv[0] for Node");
  assert.equal(argv[1], "--mode");
  assert.equal(argv[2], "rpc");
});

test("T106/TUI-019: running in a bare project needs no setup command and no hand-written config", () => {
  const root = scratch("oma-zeroconf-");
  try {
    const config = defaultHostConfig({
      society: defaultSocietyFor("/home/someone/My Project", sha256Hex("/home/someone/My Project")),
      node: process.execPath, libdir: root,  deploymentDigest: "a".repeat(64),
    });
    // The society follows the project directory, so two checkouts stay apart.
    assert.match(config.society, /^my-project-[0-9a-f]{16}$/);

    const path = join(root, "config.json");
    writeFileSync(path, JSON.stringify(config, null, 2));
    // The generated file must satisfy the real closed validator, not a relaxed one.
    const loaded = readSettings(path).config;

    // Model and credentials stay the engine's own flow: OMA claims neither.
    const model = loaded.modelProfiles[DEFAULT_MODEL_PROFILE]!;
    assert.equal(model.provider, "pi");
    assert.equal(model.model, "current");

    // DR37: resource/count limits are disabled; integration remains explicit.
    assert.ok(loaded.schemaVersion === 4);
    assert.ok(!("quota" in loaded));
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
    for (const id of ["principal-model", "worker-model", "initial-workers"])
      assert.ok(fields.includes(id), `${id} must be editable`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
