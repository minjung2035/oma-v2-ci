import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StoreError } from "../src/domain/errors.js";
import {
  PI_AGENT_DIR_ENV, PI_PACKAGE,
  piAgentDir, piIsolationEnv, resolvePiRuntime,
} from "../src/runtime/pi-runtime.js";
import { sessionArgv, sessionEnv } from "../src/tui/session.js";
import {
  DEFAULT_MODEL_PROFILE, DEFAULT_PRINCIPAL_PROFILE, DEFAULT_RESIDENT_PROFILE,
  defaultHostConfig, societyFromDirectory,
} from "../src/config/defaults.js";
import { readSettings } from "../src/tui/sources/settings.js";

const scratch = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix));

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
    // Falls through to this repository's own installed engine rather than
    // trusting a directory that merely has the right name.
    const runtime = resolvePiRuntime({ stateRoot: join(root, "state"), libdir: root });
    assert.notEqual(runtime.bundle, join(pkg, "cli.js"));
    assert.equal(runtime.source, "bundled");
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
    // libdir has no engine; resolution must not silently reach for /usr/bin/pi.
    const runtime = resolvePiRuntime({ stateRoot: join(root, "state"), libdir: root });
    assert.equal(runtime.source, "bundled");
    assert.doesNotMatch(runtime.bundle, /^\/usr\/bin\/pi$/);
    assert.match(runtime.bundle, new RegExp(PI_PACKAGE.replace("/", "\\/")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the engine is pointed at an OMA-owned agent directory, never the user's", () => {
  const stateRoot = "/var/lib/oma/demo";
  const runtime = resolvePiRuntime({ stateRoot });
  assert.equal(runtime.agentDir, piAgentDir(stateRoot));
  assert.equal(runtime.agentDir, join(stateRoot, "pi"));
  const isolation = piIsolationEnv(runtime);
  assert.equal(isolation[PI_AGENT_DIR_ENV], runtime.agentDir);
  // The user's own Pi state must not appear anywhere in what we hand the engine.
  assert.doesNotMatch(runtime.agentDir, /(^|\/)\.pi(\/|$)/);
  assert.ok(runtime.agentDir.startsWith(stateRoot));
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

test("the engine entry precedes Pi's own flags on the command line", () => {
  const runtime = resolvePiRuntime({ stateRoot: "/s" });
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
    // No Residents are started before anyone asks for one.
    assert.deepEqual(loaded.initialResidents, []);

    // Every generated value is reachable from the Control Panel.
    const fields = readSettings(path).fields.map(field => field.id);
    for (const id of ["principal-model", "worker-model", "worker-limit"])
      assert.ok(fields.includes(id), `${id} must be editable`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T106/TUI-017: the engine's state stays under OMA and never names the user's Pi", () => {
  const source = readFileSync(new URL("../../src/runtime/pi-runtime.ts", import.meta.url), "utf8");
  // OMA must not reach into a user's Pi installation for credentials or models.
  assert.doesNotMatch(source, /homedir|\.pi[/"']/);
  const entry = readFileSync(new URL("../../src/entry/oma.ts", import.meta.url), "utf8");
  assert.doesNotMatch(entry, /homedir|\.pi[/"']/);
  // Behaviour must not depend on whether the user installed Pi at all.
  const runtime = resolvePiRuntime({ stateRoot: "/s" });
  assert.ok(runtime.agentDir.startsWith("/s"));
});
