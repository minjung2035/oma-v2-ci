import * as cleanupMeaning from "@oma/native/cleanup";
import * as nativeSupportMeaning from "#oma-test/app/runtime/native-support";
import * as sessionHandoffMeaning from "@oma/protocol/session-handoff";
import * as hostLossMeaning from "@oma/process/host-loss";
import * as deploymentMeaning from "@oma/domain/deployment";
import * as settingsPolicy from "@oma/domain/settings-policy";
/** T119 / TUI-002, PR-001, PR-002, LIFE-006: the product entrypoint's wiring.
 *
 * Every part of the Principal's path had a test and the path was still broken,
 * twice, because nothing ran the file that wires the parts together. This runs
 * the real `apps/oma/src/entry/oma-society.ts` with controlled module boundaries and no host
 * I/O, and asserts the order and the values it passes between them.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { Script } from "node:vm";
import ts from "typescript";
import { codeFor, exitFor } from "#oma-test/app/application/exit";
import { parseOmaArguments } from "#oma-test/app/runtime/host-arguments";
import { HOST_LOSS_SIGNALS } from "@oma/process/host-loss";
import { encodedPrincipalToolSurface } from "@oma/domain/tool-surface";

/** A production module compiled and run with its own controlled boundary.
 *
 * The tenure is not stood in for. It is the object that now answers every
 * "may I" the entry used to answer with a flag of its own, so a stand-in here
 * would test the stand-in's rules and not the product's. Its one real
 * dependency -- the lease -- is what the test controls instead. */
function loadSource(relative, deps) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../${relative}`, import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module_ = { exports: {} };
  new Script(compiled, { filename: relative }).runInNewContext({
    exports: module_.exports, module: module_, setTimeout, clearTimeout, Promise,
    require(name) {
if (name === "@oma/protocol/session-handoff" && !Object.hasOwn(deps, name)) return sessionHandoffMeaning;
if (name === "@oma/process/host-loss" && !Object.hasOwn(deps, name)) return hostLossMeaning;
if (name === "@oma/domain/deployment" && !Object.hasOwn(deps, name)) return deploymentMeaning;

      assert.ok(Object.hasOwn(deps, name), `uncontrolled dependency in ${relative}: ${name}`);
      return deps[name];
    },
  });
  return module_.exports;
}

class StoreError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/** The descriptor the lease lives on. Everything this process starts because
 * of the lease must be handed it, so that the society cannot change hands
 * while any of them can still write to it. */
const FENCE = 41;

const SESSION_ENVIRONMENT = { OMA_MARKER: "built by principalEnvironment" };
const SESSION_DIR_FROM_OWNER = "answered-by-principalSessionDir";
const WORKSPACE_FROM_OWNER = "answered-by-principalWorkspace";

/** A supervised broker the test drives: it becomes ready when told, answers
 * registrations with the next credential in `credentials`, and records every
 * call. */
function brokerStandIn(state, credentials, disownedReason = null) {
  const readyListeners = [];
  const lostListeners = [];
  const disownedListeners = [];
  const record = {
    registrations: [], stops: 0,
    fireReady: () => { for (const listener of readyListeners) listener(); },
    fireLost: () => { for (const listener of lostListeners) listener(); },
    fireDisowned: reason => { for (const listener of disownedListeners) listener(reason); },
  };
  return {
    record,
    handle: {
      state,
      onReady(listener) { readyListeners.push(listener); },
      onLost(listener) { lostListeners.push(listener); },
      // The real handle calls a listener at once when ownership is already
      // settled against this process, so a listener added later cannot miss it.
      onDisowned(listener) {
        disownedListeners.push(listener);
        if (disownedReason !== null) listener(disownedReason);
      },
      async register(sessionHandle, pid) {
        record.registrations.push({ sessionHandle, pid });
        // An entry may be a promise, so a test can answer a registration late.
        return await (credentials.shift() ?? null);
      },
      stop() { record.stops += 1; },
    },
  };
}

async function run({ brokerState = { kind: "started", pid: 1 }, credentials = ["1".repeat(64), "2".repeat(64)],
  disowned = null, leased = true, engineExits = true, startFailures = 0, acquiredFailures = 0,
  brokerAlreadyListening = false, untrustedRunRoot = false, binding = "fresh", rereadFails = false, commitRefused = false, startupFailure = null, statusReply = null, onBrokerStart = null,
  resumeBirth = null, resumeError = null, resumeReply = null, hostNew = false, hostHistory = null, tenureGraceMs, frameBytes = 262144,
  projectPointerRead = () => "controlled-settings-version", env = {}, argv = ["node", "oma", "--society", "fixture"] } = {}) {
  // DR24: a start without a society is a new session of the project; the
  // ownership rules below are asked of the society a start names.
  const expected = argv.includes("--society") ? argv[argv.indexOf("--society") + 1] : "fixture-new";
  const source = readFileSync(process.env.OMA_SOCIETY_ENTRY_SOURCE ?? new URL("../apps/oma/src/entry/oma-society.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText
    // The entry resolves its installation directory from its own module URL,
    // which CommonJS has no equivalent for. Only that one expression is
    // substituted; nothing else about the file is rewritten.
    .replaceAll("import.meta.url", JSON.stringify("file:///lib/apps/oma/dist/entry/oma-society.js"));
  const calls = [];
  const restarts = [];
  const lines = [];
  const grants = [];
  const handlers = {};
  const deliveries = [];
  const intervals = new Set();
  const lease = { holds: leased, releases: 0 };
  let started = null;
  let capturedPorts = null;
  let sessionListener = null;
  const broker = brokerStandIn(brokerState, credentials, disowned);
  const settings = {
    config: {
      society: expected,
      installation: { node: "node", libdir: "/lib",  deploymentDigest: "a".repeat(64) },
      limits: { frameBytes, mailBodyBytes: 262144, batchMaxMessages: 24, idleStreamSeconds: 30, receiptWaitSeconds: 30 },
      principalProfile: "principal",
      initialResidents: [],
      agentProfiles: { principal: { modelProfile: "m" } },
      modelProfiles: { m: { provider: "pi", model: "current" } },
    },
    fields: [],
    workerProfile: "worker",
  };
  const PACKAGE_STORE = "/state/oma/.packages";
  const readSettings = path => {
    calls.push("readSettings");
    if (startupFailure === "settings") throw new StoreError("BROKER_UNAVAILABLE", "settings could not be observed");
    // The file as it is at each read: 6 when the screen first read it, 5 after an operator's hand edit.
    // What the start reads is the file as it was; what the screen reads back later is the file as it now is.
    if (commitRefused) return { ...settings, config: { ...settings.config, shownLimit: capturedPorts !== null ? 5 : 6 } };
    if (rereadFails && capturedPorts !== null && path === `/state/oma/${expected}/config.json`) throw new Error("manifest unreadable");
    return settings;
  };
  const modules = {
    // Composition policy only: actual journal/recovery and native gates run
    // in their real-kernel suites. No execution or authority is minted here.
    "../runtime/execution-runtime.js": { async recoverExecutionState() {} },
    "@oma/native/cleanup": cleanupMeaning,
    "../runtime/native-support.js": nativeSupportMeaning,
"@oma/protocol/session-handoff": sessionHandoffMeaning,
"@oma/process/host-loss": hostLossMeaning,
"@oma/domain/deployment": deploymentMeaning,

    "../engine/start-effects.js": {engineLoginDirectory: {}, engineStartEffects: {}},
    "../engine/principal-profile.js": {principalSessionProfile: () => ({ society: "fixture", provider: "pi", model: "current", extensions: [], inferenceSeconds: 600 })},
    "node:path": path,
    "node:fs": { existsSync: () => true, mkdirSync() {}, realpathSync: path => { calls.push(`realpath:${path}`); return path === "/saved-personal" ? path : "/project"; },
      readdirSync: () => [], statSync: () => ({ mtimeMs: 1, size: 1, isDirectory: () => true }) },
    "node:url": { fileURLToPath: () => "/lib/" },
    "../runtime/host-arguments.js": { parseOmaArguments },
    "../runtime/session-mode.js": {
      newSessionBirth: (root, mode, cwd) => ({ id: path.basename(root), mode, cwd }),
      publishSessionBirth(root, birth) { calls.push(`publishSessionBirth:${root}`); return birth; },
    },
    "../runtime/session-catalog.js": {
      RESUME_SESSION_ENV: "OMA_RESUME_SESSION",
      async sessionBirthForHistory(...args) { calls.push("sessionBirthForHistory"); if (resumeError) throw resumeError; return resumeReply ? await resumeReply(...args) : resumeBirth; },
      sessionHistoryDirectories() { calls.push("sessionHistoryDirectories"); return []; },
    },
    "@oma/domain/identifiers": { isValidSocietyName: () => true },
    // The path checks are the product's own; what this harness controls is
    // only whether they pass, because what is under test here is when the
    // entry asks -- before it takes the society, and before it writes.
    "@oma/native/directory-layout": { assertHostDirectoryLayout: (root, allowMissing) => {
        calls.push(`assertHostDirectoryLayout:${root}`);
        assert.equal(allowMissing, true, "the run root was required to exist before it had been made");
        if (untrustedRunRoot) throw new StoreError("INVALID_ARGUMENT", "host directory ancestors must be real directories, not symlinks");
      } },
"../runtime/assets.js": {
      // The host decides the location once, from its own environment.
      hostLaunchLocation: (society, env, configPath) => {
        calls.push("hostLaunchLocation");
        return { society, stateRoot: path.join(env.XDG_DATA_HOME, "oma", society), runRoot: path.join(env.XDG_RUNTIME_DIR, "oma", society),
          configPath: configPath ?? path.join(env.XDG_DATA_HOME, "oma", society, "config.json") };
      },
    },
    "@oma/domain/deployment": { DEPLOYMENT_LAYOUT: { extension: "packages/extension/dist/index.js", cli: "apps/oma/dist/cli.js",
      entries: { interactive: "apps/oma/dist/entry/pi-interactive.js", tui: "apps/oma/dist/entry/oma.js" } } },
    "@oma/domain/mail-values": { storedMailBytes: bodyBytes => bodyBytes },
    "@oma/engine/pi-runtime": { resolvePiRuntime: () => ({ executable: "node", args: [], agentDir: "/state/oma/.engine", source: "bundled" }) },
    "@oma/storage/directory": { ensureDirectory() {},
      ensureOwnedDirectory(directory, ownedFrom, mode) {
        // The boundary is oma's data root itself: `ensureOwnedDirectory(store,
        // store)` or a user-rooted boundary would leave the store's own parent
        // unowned -- and its stray slots uncollectable -- forever.
        assert.equal(ownedFrom, "/state/oma", "the owned boundary is oma's data root, never the slot's own path");
        assert.ok(directory === "/state/oma/.packages" || directory === "/state/oma/.engine",
          `the owned ensure names only oma's own slots, got ${directory}`);
        assert.equal(mode, 0o700);
      },
      removeUnusedTree: path => { calls.push(`removeUnusedTree:${path}`); } },
    "@oma/tui/app": { TuiApp: class {
      constructor(ports) { calls.push("TuiApp"); capturedPorts = ports; }
      close() { calls.push("app.close"); }
      refresh() { calls.push("app.refresh"); } draw() { calls.push("app.draw"); } line(text) { lines.push(text); } setBusy() {} note() {}
    } },
    // The product's own exit reading (DR13); only the exit itself is stood in for.
    "../application/exit.js": { codeFor, exitFor, fail: (reason, code) => { calls.push(`fail:${code}`); calls.push(`holdsAtFail:${lease.holds}`); throw new Error(`fail: ${reason}`); } },
    // One terminal owner: this process's panel, or the engine's screen.
    "@oma/tui/panel-terminal": { PanelTerminal: class {
      restore() { calls.push("restore"); } onResize() {} onKeys() {} handoff() {} reclaim() { calls.push("reclaim"); } open() {} size() {} draw() {}
      whenUnclaimed() {}
    } },
    "@oma/tui/dashboard": { dashboardData: () => ({}) },
    "@oma/engine/principal-session": {
      newSessionHandle: () => "h".repeat(32),
      // The entry must take the session directory from its owner and pass it
      // through untouched. A path spelled out here would be a second, silent
      // owner of PR-003's rule -- and was: it still named the location the
      // owner had already moved away from, so this test went on asserting the
      // very layout the product had stopped using. What the owner actually
      // answers is asserted where the owner is tested.
      principalSessionDir: root => { calls.push("principalSessionDir"); return `${root}/${SESSION_DIR_FROM_OWNER}`; },
      // AV3: the model's workspace has an owner too; the entry asks it.
      principalWorkspace: root => { calls.push("principalWorkspace"); return `${root}/${WORKSPACE_FROM_OWNER}`; },
      principalEnvironment: (...args) => {
        calls.push(`principalEnvironment/${args.length}`);
        return { ...SESSION_ENVIRONMENT };
      },
      PrincipalSession: class {
        static start(_effects, paths, profile, limits, environment, sink) {
          calls.push("PrincipalSession.start");
          if (startFailures-- > 0) throw new Error("injected engine start failure");
          // The engine the entry is holding, not a snapshot of its arguments:
          // whether it is still running when ownership ends is the whole
          // question TUI-004 asks here.
          let confirmDeath = () => {};
          started = {
            paths, profile, limits, environment, sink, closes: 0,
            pid: 777, busy: false, running: true,
            // The operating system's answer, not this process's request. A
            // teardown that treated `close()` as the death could give the
            // society away while the engine it paid for was still running.
            exited: new Promise(resolve => { confirmDeath = resolve; }),
            confirmDeath: () => { confirmDeath(); },
            uiEvents: [],
            sendUi(event) { this.uiEvents.push(event); },
            grant(credential, sessionHandle) { grants.push({ credential, sessionHandle }); },
            onEvent(listener) { sessionListener = listener; return () => {}; },
            deliver: async () => {}, submit: async () => {},
            close() {
              calls.push("PrincipalSession.close"); this.closes += 1; this.running = false;
              // A real engine's exit is reported by the operating system on a
              // later turn, never inside the call that asked it to stop.
              // Resolving it here would make a teardown that never waited
              // indistinguishable from one that did.
              if (engineExits) setImmediate(() => { calls.push("PrincipalSession.exited"); confirmDeath(); });
            },
          };
          sink.onAcquire?.(started);
          if (acquiredFailures-- > 0) {
            started.close();
            throw new Error("injected setup failure after acquisition");
          }
          return started;
        }
      },
    },
    "../runtime/principal-delivery.js": {
      principalHostBroker: runRoot => ({ runRoot }),
      PrincipalDelivery: class {
        constructor(session, hostBroker, options) { calls.push("PrincipalDelivery"); this.options = options; this.hostBroker = hostBroker; }
        async tick() { deliveries.push("tick"); return { kind: "idle" }; }
      },
    },
    "../application/status-observation.js": {
      limitsOf: value => value,
      TuiTransport: class {
        constructor() { if (startupFailure === "display-transport") throw new StoreError("BROKER_UNAVAILABLE", "display transport could not start"); }
        async status() { calls.push("status"); return statusReply ? await statusReply(handlers) : { kind: "unknown", reason: "probe", observedAtMs: 1 }; }
      },
    },
    "../application/mail.js": { principalMailbox: () => ({}), readBody: () => null, readMailbox: () => [], readSocietyMail: () => ({ rows: [], unreadable: null, omitted: 0 }), unreadCount: () => 0 },
    "../application/extensions.js": { readExtensions: () => {
      if (startupFailure === "extensions") throw new StoreError("BROKER_UNAVAILABLE", "extensions could not be observed");
      return { rows: [] };
    }, toggleExtension() {} },
    "../application/settings.js": {
      commitField: (current, field) => {
        calls.push(`commitField:${field}:${current.config.shownLimit ?? "-"}`);
        if (commitRefused && current.config.shownLimit === 6)
          throw new StoreError("POLICY_CHANGED", "configuration changed since it was read; reload it before editing");
        return { kind: "saved" };
      },
      bootstrapStateOf: () => "unknown",
      fieldsOf: config => rereadFails || commitRefused ? [{ kind: "number", id: "worker-limit", label: "Worker limit", value: config.shownLimit ?? 8, min: 1, max: 64, apply: "restart", blocked: null },
        { kind: "link", id: "extensions", label: "Extensions" }] : settings.fields,
      readSettings,
      writeSettings() { calls.push("writeSettings"); },
      // DR24: the project's settings, which a session's society configuration is made from.
      projectSettingsPath: (root, project) => `${root}/.projects/${project}/config.json`,
      sessionConfigOf: (project, own) => ({ ...project, society: own.society }),
      // DR25: the project's settings are a managed bundle naming the package store,
      // and a session's configuration is made from them, roles and all.
      readSettingsForEditing: path => readSettings(path),
      projectBundle: path => { const read = readSettings(path);
        return { ...read, config: { ...read.config, installation: { ...read.config.installation, packages: PACKAGE_STORE } } }; },
      deriveSessionSettings: (_project, path) => { calls.push(`deriveSessionSettings:${path}`); return { settings: readSettings(path), missing: [] }; },
      commitRoleSet() { calls.push("commitRoleSet"); return { kind: "unchanged", generation: null }; },
      commitManagedEdit() { calls.push("commitManagedEdit"); return { kind: "unchanged", generation: null }; },
      roleSetOf: () => ({}),
    },
    // DR25: the project's settings, made once and kept a bundle naming the store.
    "../application/project-settings.js": {
      ensureProjectSettings: (root, project) => { const read = readSettings(`${root}/.projects/${project}/config.json`);
        return { ...read, config: { ...read.config, installation: { ...read.config.installation, packages: PACKAGE_STORE } } }; },
      applyPackageChange: () => { throw new Error("a start applied a package change"); },
    },
    // DR25: the package store; a start reads its index and changes nothing in it.
    "../runtime/packages/index.js": { PACKAGE_USAGE: "usage: oma pi ...", packageStoreDir: () => PACKAGE_STORE,
      readPackageIndex: () => [], packageCommand: () => { throw new Error("a start ran oma pi"); },
      writePackageIndex: async () => { throw new Error("a start wrote the package index"); }, reconciledEntries: entries => entries },
    // C20: local-package staging is a package command's concern; a start never touches it.
    "../application/local-packages.js": { stageLocalPackage: () => { throw new Error("a start staged a local package"); },
      pruneLocalStage: () => { throw new Error("a start pruned the local stage"); } },
    "../runtime/personal-settings.js": { reconcilePersonalSettings() { throw new Error("a Society start reconciled Personal choices"); } },
    "../runtime/session-handoff.js": { requestHostNewSession() { calls.push("host-new"); return hostNew; } },
    "@oma/engine/host-history-channel": { HostHistoryChannel: { open() { return hostHistory; } } },
    "@oma/protocol/host-history": { isHostHistoryReference: value => value.startsWith("oma-host-history:") },
    "@oma/protocol/guest-history": { guestHistoryReference() { throw new Error("Guest reference requires a host history channel"); } },
    "../runtime/session-history.js": { inspectSessionHistory() { throw new Error("Guest inspection requires a host history channel"); } },
    "@oma/domain/canonical-json": { sha256Hex: bytes => { calls.push("sha256Hex"); return "f".repeat(64); } },
    "@oma/config/defaults": { defaultHostConfig: () => ({}), defaultSocietyFor: (path, digest) => { calls.push(`defaultSocietyFor:${path}:${digest.length}`); return "fixture"; },
      sessionSocietyName: project => `${project}-new` },
    "../runtime/provision.js": {
      // D05: the binding scenario is controlled; the decision itself is the
      // product's pure rule, exercised against real files in project-binding.test.
      observeProjectBinding: root => {
        calls.push(`observeProjectBinding:${root}`);
        if (startupFailure === "binding") throw new StoreError("BROKER_UNAVAILABLE", "binding could not be observed");
        if (root !== `/state/oma/${expected}`) return { kind: "absent" };
        if (binding === "bound") return { kind: "bound", binding: { kind: "oma-project-binding-v1", society: expected, canonicalProjectPath: "/project" } };
        if (binding === "mismatch") return { kind: "bound", binding: { kind: "oma-project-binding-v1", society: expected, canonicalProjectPath: "/elsewhere" } };
        return { kind: "absent" };
      },
      stateRootHasSociety: root => root === `/state/oma/${expected}` ? binding === "bound" || binding === "mismatch" : false,
      projectBindingDecision: input => {
        calls.push("projectBindingDecision");
        if (input.observation.kind === "bound")
          return input.observation.binding.canonicalProjectPath === input.canonicalProjectPath ? { kind: "proceed" } : { kind: "refuse", code: "INVALID_REQUEST", reason: "another project" };
        return { kind: "publish" };
      },
      publishProjectBinding: (root, value) => { calls.push(`publishProjectBinding:${root}:${value.society}:${value.canonicalProjectPath}`); },
      provisionSociety: () => {
        calls.push("provisionSociety");
        if (startupFailure === "provision") throw new StoreError("BROKER_UNAVAILABLE", "provisioning could not be observed");
        return { created: [], seeded: false, seedSource: null, seedNote: null, pendingRepairs: ["/state/rootfs/etc/passwd"] };
      },
      repairSociety: () => {
        calls.push("repairSociety");
        return ["/state/rootfs/etc/passwd"];
      },
      residentRootfsPath: () => "/state/rootfs",
    },
    "@oma/domain/errors": { StoreError, exceptionText: error => error instanceof Error ? error.message : String(error) },
    // The real tenure over a controlled lease: what the entry may do, and when,
    // is the thing under test here.
    // `/resume` asks whether the chosen session is free; a start never does.
    "../runtime/society-lease.js": { tryHoldSociety: () => { throw new Error("a start probed another session"); } },
    "../runtime/host-tenure.js": loadSource("apps/oma/src/runtime/host-tenure.ts", {
      "@oma/domain/errors": { StoreError, exceptionText: error => error instanceof Error ? error.message : String(error) },
      "./society-lease.js": {
        tryHoldSociety: stateRoot => {
          calls.push("tryHoldSociety");
          // The state tree, not the run directory: the tree is the thing that
          // must not have two writers, and a run directory is per-boot and
          // replaceable, so two run directories over one tree used to be two
          // societies as far as the lease could tell.
          assert.equal(stateRoot, `/state/oma/${expected}`, "the lease was not taken on this society's state tree");
          if (!lease.holds) return null;
          return { name: `\0oma.society.${"a".repeat(64)}`, fence: FENCE,
            release() { calls.push("lease.release"); lease.releases += 1; lease.holds = false; } };
        },
      },
    }),
    "../runtime/broker-supervisor.js": {
      brokerListening: async runRoot => {
        calls.push("brokerListening");
        if (startupFailure === "endpoint") throw new StoreError("BROKER_UNAVAILABLE", "endpoint could not be observed");
        assert.equal(runRoot, `/run/oma/${expected}`, "the standing broker was looked for somewhere else");
        return brokerAlreadyListening;
      },
      superviseBroker: async options => {
        calls.push("superviseBroker");
        onBrokerStart?.(handlers);
        assert.equal("sessionHandle" in options, false, "a session handle was put where the broker's environment could carry it");
        // A broker without the fence can outlive the lease it writes under.
        assert.equal(options.fence, FENCE, "the broker was started without the society lease descriptor");
        // D03: the broker is handed the host's whole location, not left to derive it.
        assert.deepEqual([options.stateRoot, options.runRoot, options.configPath],
          [`/state/oma/${expected}`, `/run/oma/${expected}`, `/state/oma/${expected}/config.json`]);
        return broker.handle;
      },
    },
    "../runtime/deployment-manifest.js": { deploymentDigest: () => "a".repeat(64) },
    // D23/TSP-005: the Principal's declared surface plan, produced by the
    // deployment -- the real encoder, not a stand-in.
    "@oma/domain/tool-surface": { encodedPrincipalToolSurface },
    // The one list of the signals that end a process with a drain (AV31).
    "@oma/broker/lifetime": { HOST_LOSS_SIGNALS },
    // `oma login` (DR18, D-9); a start never reaches it.
    "@oma/engine/login": { runEngineLogin: () => { throw new Error("a start ran the engine's login"); } },
    // DR18 (D-10): the environment names no egress socket here, as on Linux.
    "../runtime/egress-forwarder.js": { adoptPrincipalEgress: async () => {  return null; } },
    "@oma/config/generations": { collectManagedGenerations: () => { calls.push("collectManagedGenerations"); return []; } },
  };
  // Exercise the actual extracted settings owner with the same effect
  // boundaries as the entry, so write ownership and read-back still run.
  modules["../application/project-session-settings.js"] = loadSource("apps/oma/src/application/project-session-settings.ts", {
    "../runtime/user-files.js": { readUserFile: projectPointerRead },
    "@oma/config/operations": { CONFIGURATION_DOCUMENT_BYTES: 16777216 },
    "../runtime/deployment-manifest.js": modules["../runtime/deployment-manifest.js"],
    "../runtime/packages/index.js": modules["../runtime/packages/index.js"],
    "@oma/domain/errors": modules["@oma/domain/errors"],
    "./extensions.js": modules["../application/extensions.js"],
    "./settings.js": modules["../application/settings.js"],
    "./project-settings.js": modules["../application/project-settings.js"],
  });
  modules["@oma/tui/society-panel"] = loadSource("packages/tui/src/society-panel.ts", {
    "./dashboard.js": modules["@oma/tui/dashboard"],
    "@oma/domain/settings-policy": { ...settingsPolicy, ...modules["../application/settings.js"] },
    "./settings.js": modules["../application/settings.js"],
    "@oma/domain/mail-values": modules["@oma/domain/mail-values"],
  });
  modules["../application/society-panel.js"] = loadSource("apps/oma/src/application/society-panel.ts", {
    "@oma/tui/society-panel": modules["@oma/tui/society-panel"],
    "@oma/domain/mail-values": modules["@oma/domain/mail-values"],
    "./mail.js": modules["../application/mail.js"],
  });
  modules["../platform/package-files.js"] = { packageDirectories: {} };
  const process_ = {
    argv, env: { HOME: "/home/user", XDG_DATA_HOME: "/state", XDG_RUNTIME_DIR: "/run", ...env },
    execPath: "node", execArgv: [], execve(...args) { calls.push("execve"); restarts.push(args); },
    chdir(cwd) { calls.push(`chdir:${cwd}`); }, cwd: () => "/project", exitCode: 0,
    on(event, handler) { handlers[event] = handler; },
    exit(code) { calls.push(`exit:${code}`); },
    stdin: {}, stdout: {}, stderr: { write() {} },
  };
  if (tenureGraceMs !== undefined) {
    const actual = modules["../runtime/host-tenure.js"].HostTenure;
    modules["../runtime/host-tenure.js"] = { HostTenure: { take: root => actual.take(root, tenureGraceMs) } };
  }
  modules["node:buffer"] = { Buffer };
  const context = {
    exports: {}, module: { exports: {} }, process: process_, console: { error() {} },
    setInterval: run => { const timer = { run, unref() {} }; intervals.add(timer); return timer; },
    clearInterval: timer => { intervals.delete(timer); }, setTimeout, clearTimeout, Promise, Date, JSON, URL, Buffer,
  };
  // Run the real Application owners, retaining all prior controlled effect boundaries.
  const byFile = new Map(Object.entries(modules).map(([name, value]) =>
    [name.startsWith(".") ? path.posix.normalize(path.posix.join("apps/oma/src/entry", name)) : name, value]));
  const owners = new Set(["society-bootstrap", "society-runtime", "society-interaction", "society-transition"]
    .map(name => `apps/oma/src/application/${name}.js`));
  function dependency(from, name) {
    const file = name.startsWith(".") ? path.posix.normalize(path.posix.join(path.posix.dirname(from), name)) : name;
    if (byFile.has(file)) return byFile.get(file);
    assert.ok(owners.has(file), `uncontrolled dependency in ${from}: ${name}`);
    const source = readFileSync(file.replace(/\.js$/, ".ts"), "utf8");
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022 } }).outputText;
    const module_ = { exports: {} };
    new Script(code, { filename: file }).runInNewContext({ ...context,
      exports: module_.exports, module: module_, require: name => dependency(file, name) });
    byFile.set(file, module_.exports); return module_.exports;
  }
  const completion = new Script(compiled, { filename: "oma-composition.cjs" }).runInNewContext({
    ...context, require: name => dependency("apps/oma/src/entry/oma-society.js", name),
  });
  await completion;
  // Two turns, because a teardown now waits for the engine's exit before it
  // gives the society up: one turn would observe the middle of it.
  const settle = async () => {
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
  };
  // `started` is read through an accessor, not copied out here: what this
  // suite now asks is when the engine starts, and a value snapshotted at
  // return would answer "never" for every test that fires readiness later.
  /** Waits for something the entry does across several turns -- a teardown
   * that waits for the engine's exit takes more turns than a settle. Bounded,
   * so a claim that never becomes true fails as a test rather than a hang. */
  const until = async (done, ms = 10_000) => {
    const deadline = Date.now() + ms;
    while (!done() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    if (!done()) throw new Error(`waited ${ms}ms for something that never happened: ${calls.join(" ")}`);
  };
  return { calls, restarts, lines, grants, handlers, deliveries, intervals, broker: broker.record, settle, lease, until,
    env: process_.env,
    get started() { return started; },
    get ports() { return capturedPorts; },
    fireEvent: event => sessionListener?.(event) };
}

test("DR39 Society settings: pointer content change is followed even with unchanged stat metadata", async () => {
  let pointer = "generation-A";
  const society = await run({ projectPointerRead: () => pointer });
  const before = society.calls.filter(call => call.startsWith("deriveSessionSettings:")).length;
  pointer = "generation-B";
  for (const timer of society.intervals) timer.run();
  await society.settle();
  assert.equal(society.calls.filter(call => call.startsWith("deriveSessionSettings:")).length, before + 1);
  society.handlers.SIGTERM(); await society.settle();
});

test("DR39 Society settings: an unobservable project pointer is retried instead of cached as unchanged", async () => {
  let unavailable = false;
  const society = await run({ projectPointerRead: () => { if (unavailable) throw new Error("pointer unreadable"); return "generation-A"; } });
  const before = society.calls.filter(call => call.startsWith("deriveSessionSettings:")).length;
  unavailable = true;
  for (let count = 0; count < 2; count++) {
    for (const timer of society.intervals) timer.run();
    await society.settle();
  }
  assert.equal(society.calls.filter(call => call.startsWith("deriveSessionSettings:")).length, before + 2);
  society.handlers.SIGTERM(); await society.settle();
});

test("T119 / DR35: the lease permits private conversation while broker authority remains closed", async () => {
  const society = await run();
  assert.ok(society.calls.includes("PrincipalSession.start"));
  assert.ok(society.calls.indexOf("tryHoldSociety") < society.calls.indexOf("PrincipalSession.start"));
  assert.ok(society.started);
  assert.equal(society.broker.registrations.length, 0);
  assert.deepEqual(society.grants, []);
  assert.equal(society.calls.includes("PrincipalDelivery"), false,
    "a delivery owner was built before any broker granted authority");

  // Broker readiness and registration grant authority to the existing engine.
  society.broker.fireReady();
  await society.settle();
  const { calls, started, grants } = society;
  assert.ok(calls.includes("PrincipalSession.start"));
  // The environment is exactly what principalEnvironment returned -- three
  // arguments, no credential parameter to pass one through.
  assert.ok(calls.includes("principalEnvironment/3"));
  assert.deepEqual(started.environment, SESSION_ENVIRONMENT);
  // AV3: not the private space itself, which holds the Human's session history.
  assert.ok(calls.includes("principalWorkspace"), "the entry decided the model's workspace itself");
  assert.equal(started.paths.workspace, `/state/oma/fixture/${WORKSPACE_FROM_OWNER}`);
  // FS-003: the CLI's home, and its request cache, is that same private scratch.
  assert.equal(started.paths.home, started.paths.workspace);
  assert.ok(calls.includes("principalSessionDir"), "the entry decided the session directory itself");
  assert.equal(started.paths.sessionDir, `/state/oma/fixture/${SESSION_DIR_FROM_OWNER}`);
  // The credential travels only after the engine exists, and only into it.
  assert.deepEqual(grants, [{ credential: "1".repeat(64), sessionHandle: "h".repeat(32) }]);
  const order = name => calls.indexOf(name);
  assert.ok(order("provisionSociety") < order("superviseBroker"));
  assert.ok(order("superviseBroker") < order("PrincipalSession.start"));
  // D02/WP13: unused configuration generations are collected only while this
  // process owns the society and before the broker it starts can read them.
  assert.ok(order("provisionSociety") < order("collectManagedGenerations"));
  assert.ok(order("collectManagedGenerations") < order("superviseBroker"));
});

test("T119: however many brokers become ready, the society gets one engine", async () => {
  const society = await run();
  society.broker.fireReady();
  await society.settle();
  const first = society.started;
  assert.ok(first, "the engine was not started when the broker became ready");
  // A restarted broker becomes ready again. A second engine here would be a
  // second writer of the same private workspace and session history.
  society.broker.fireReady();
  society.broker.fireReady();
  await society.settle();
  assert.equal(society.calls.filter(name => name === "PrincipalSession.start").length, 1,
    "a restarted broker started a second engine");
  assert.equal(society.calls.filter(name => name === "PrincipalDelivery").length, 1);
  assert.equal(society.started, first, "the engine was replaced rather than kept");
  // Each readiness still registers the engine again: the credential is the new
  // broker's, and the engine that must be told is the one already running.
  assert.equal(society.broker.registrations.length, 3);
});

test("T119: each time a broker becomes ready the engine is registered and given its credential", async () => {
  const run1 = await run();
  assert.equal(run1.broker.registrations.length, 0, "an engine was registered before any broker was ready");
  run1.broker.fireReady();
  await run1.settle();
  assert.deepEqual(run1.broker.registrations, [{ sessionHandle: "h".repeat(32), pid: 777 }]);
  assert.deepEqual(run1.grants, [{ credential: "1".repeat(64), sessionHandle: "h".repeat(32) }]);
  // A restarted broker: the same engine, the same handle, a new credential that
  // replaces the old one. The Human does nothing.
  run1.broker.fireReady();
  await run1.settle();
  assert.deepEqual(run1.broker.registrations.map(entry => entry.pid), [777, 777]);
  assert.deepEqual(run1.grants.map(entry => entry.credential), ["1".repeat(64), "2".repeat(64)]);
  assert.ok(run1.grants.every(entry => entry.sessionHandle === "h".repeat(32)));
});

test("T119 / PR-002: a refused registration grants nothing and delivers nothing", async () => {
  // The refusal used to print a line and resolve like any other outcome, and
  // the delivery chained after the registration ran regardless -- so mail was
  // pushed into an engine the broker had just declined to accept as the
  // Principal. Saying it on the screen is not the fix; not being allowed to
  // deliver is.
  const society = await run({ credentials: [] });
  society.broker.fireReady();
  await society.settle();
  assert.equal(society.grants.length, 0);
  assert.ok(society.lines.some(line => /rejected the Principal session/.test(line)), society.lines.join(" | "));
  assert.deepEqual(society.deliveries, [], "mail was delivered into an engine no broker accepted");

  // And no later occasion re-opens it either: a settled turn and the product's
  // own poll both go through the same gate.
  society.fireEvent({ type: "agent_settled" });
  await society.settle();
  assert.deepEqual(society.deliveries, [], "a settled turn delivered without a registration");
});

test("T119 / PR-002: delivery closes when the broker that authorised it ends, and reopens only on a new registration", async () => {
  // The credential is minted by one broker and dies with it. Delivery used to
  // be gated on "a broker was ready once", which stayed true across the whole
  // restart -- back-off included -- so the product kept pushing work under
  // authority that no longer existed.
  const society = await run();
  society.broker.fireReady();
  await society.settle();
  assert.equal(society.deliveries.length, 1);

  society.broker.fireLost();
  society.fireEvent({ type: "agent_settled" });
  await society.settle();
  assert.equal(society.deliveries.length, 1, "delivery continued after the broker that authorised it ended");

  // A restarted broker is ready again -- and that alone is still not enough:
  // the window between readiness and the new credential is not deliverable.
  society.broker.fireReady();
  assert.equal(society.deliveries.length, 1, "delivery ran on readiness, before the new registration was answered");
  await society.settle();
  assert.deepEqual(society.grants.map(entry => entry.credential), ["1".repeat(64), "2".repeat(64)]);
  assert.equal(society.deliveries.length, 2, "delivery did not resume once the engine was registered again");
});

test("T119 / REC-007: a Control Panel over someone else's society cannot write to it", async () => {
  // The architecture calls a process without the lease a read-only Control
  // Panel, and startup enforced that -- but the panels themselves still called
  // the real write paths, so a second `oma` could edit a running society's
  // policy files while its owner was using them. The check belongs at the
  // write, because that is the only place that knows a write is about to
  // happen.
  const society = await run({ leased: false, argv: ["node", "oma", "--society", "fixture"] });
  const ports = society.ports;
  assert.ok(ports, "the product built no panels at all");
  assert.throws(() => ports.setField("limits.frameBytes", 1024), /another oma process owns/,
    "a non-owner changed the running owner's configuration");
  assert.throws(() => ports.setExtension("ext", "principal", true), /another oma process owns/,
    "a non-owner changed the running owner's extensions");
  assert.equal(society.calls.includes("writeSettings"), false);
  // Reading is exactly what it is for, and still works.
  assert.deepEqual(ports.configFields(), []);
  assert.deepEqual(ports.mail(), { rows: [], unreadable: null, omitted: 0 });
});

test("T119 / REC-007: an owner that has given the society back stops being able to write to it", async () => {
  // Read-only is not a fact about how this process started. It is a fact about
  // whether it owns the society right now, and it stops owning it the moment
  // the broker says so.
  const society = await run();
  society.broker.fireReady();
  await society.settle();
  society.ports.setField("limits.frameBytes", 1024);

  society.broker.fireDisowned("the broker could not stay running");
  await society.settle();
  assert.throws(() => society.ports.setField("limits.frameBytes", 2048), /another oma process owns/,
    "a process wrote to a society it had already given back");
  assert.throws(() => society.ports.setExtension("ext", "principal", true), /another oma process owns/);
});

test("T119 / REC-007: everything started on the strength of the lease inherits it", async () => {
  // A child that does not hold the lease's descriptor can outlive the lease,
  // and then the society changes hands while a process that can still write to
  // it is running. This is the only part of the fence that this process can be
  // held to; the kernel enforces the rest.
  const society = await run();
  society.broker.fireReady();
  await society.settle();
  assert.equal(society.started.paths.fence, FENCE,
    "the engine was started without the society lease descriptor");
});

test("T119: a society whose broker this host does not own gets a Control Panel, not a second engine", async () => {
  // This process has no principal host endpoint or credential from that
  // broker, whether its owner is another `oma` or a standalone service. A
  // second engine here would have no authority to reach the society and would
  // still be a second writer of the same private workspace and session history.
  const { lines, broker, calls, started, deliveries } = await run({
    brokerState: { kind: "already-running" }, disowned: "another oma already owns this society" });
  assert.equal(broker.registrations.length, 0);
  assert.equal(started, null, "a second Principal engine was started for a society this process does not own");
  assert.equal(calls.includes("PrincipalSession.start"), false);
  assert.equal(calls.includes("PrincipalDelivery"), false, "a delivery owner was built with no session to deliver into");
  assert.deepEqual(deliveries, []);
  assert.ok(lines.some(line => /does not own this society/.test(line)), lines.join(" | "));
  assert.ok(lines.some(line => /already owns this society/.test(line)), lines.join(" | "));
  assert.ok(lines.some(line => /Dashboard, Config, and Mail/.test(line)), lines.join(" | "));
});

test("T119: a broker that could not be started leaves a Control Panel, not an unauthorised engine", async () => {
  // The old wiring read "not already-running" as permission to start the
  // engine, so this state -- no broker at all -- started a Principal that
  // could reach no society and still owned the private workspace. The state is
  // not what decides it; being told this process does not own the society is.
  const { started, calls, lines, broker } = await run({
    brokerState: { kind: "unavailable", reason: "no entry" },
    disowned: "the broker could not be started: no entry" });
  assert.equal(started, null, "an engine was started for a society with no broker of this process's");
  assert.equal(calls.includes("PrincipalSession.start"), false);
  assert.equal(broker.registrations.length, 0);
  assert.ok(lines.some(line => /no entry/.test(line)), lines.join(" | "));
  assert.ok(lines.some(line => /Dashboard, Config, and Mail/.test(line)), lines.join(" | "));
});

test("T119: a society this process stops owning loses the engine that ownership paid for", async () => {
  // This used to say the opposite: disowning after readiness left the session
  // alone, so as not to interrupt the Human. That was the second-engine defect
  // in slow motion. The broker's lock dies with the broker, so restarts
  // running out means the society is free; the next `oma` takes it and starts
  // its own engine, and the one still running here becomes the second writer
  // of one private workspace and one session history. The lease is what the
  // engine exists for, so giving the lease up and ending the engine are one
  // act -- and the engine ends first.
  const society = await run();
  society.broker.fireReady();
  await society.settle();
  const live = society.started;
  assert.ok(live, "the engine was not started when the broker became ready");
  assert.equal(society.lease.releases, 0, "the society was given up while its engine was running");

  society.broker.fireDisowned("the broker could not stay running");
  await society.settle();
  assert.equal(society.calls.filter(name => name === "PrincipalSession.start").length, 1);
  assert.equal(live.closes, 1, "the engine outlived the ownership it was started for");
  assert.equal(society.lease.releases, 1, "the society was kept after this process stopped owning it");
  const closedAt = society.calls.indexOf("PrincipalSession.close");
  const releasedAt = society.calls.indexOf("lease.release");
  assert.ok(closedAt >= 0 && releasedAt >= 0 && closedAt < releasedAt,
    `the lease was released before the engine ended: ${society.calls.join(" ")}`);
  assert.ok(society.lines.some(line => /could not stay running/.test(line)), society.lines.join(" | "));
  assert.ok(society.lines.some(line => /the Pi session was closed/.test(line)), society.lines.join(" | "));

  // And nothing starts again behind it: a stray readiness after the society is
  // gone must not build a second engine on state this process no longer owns.
  society.broker.fireReady();
  await society.settle();
  assert.equal(society.calls.filter(name => name === "PrincipalSession.start").length, 1,
    "an engine was started after this process gave the society up");
});

test("T119 / REC-007: a process that cannot take the society lease writes nothing and starts no broker", async () => {
  // Ownership is decided before the first write, not after a broker is
  // spawned. A process that does not hold the lease provisions nothing,
  // repairs nothing, writes no configuration and spawns no broker: every one
  // of those is a write into, or a claim on, a society that is someone else's.
  const society = await run({ leased: false, argv: ["node", "oma", "--society", "fixture"] });
  const { calls, lines } = society;
  assert.ok(calls.includes("tryHoldSociety"), "the lease was never asked for");
  assert.equal(calls.includes("provisionSociety"), false, "a non-owner wrote into the society's state tree");
  assert.equal(calls.includes("repairSociety"), false, "a non-owner corrected state it does not own");
  assert.equal(calls.includes("writeSettings"), false, "a non-owner created the society's configuration");
  assert.equal(calls.includes("superviseBroker"), false, "a non-owner started a broker for a society it does not own");
  assert.equal(calls.includes("collectManagedGenerations"), false, "a non-owner collected configuration generations");
  assert.equal(calls.includes("PrincipalSession.start"), false);
  assert.equal(calls.includes("PrincipalDelivery"), false);
  assert.equal(society.started, null);
  assert.equal(society.broker.registrations.length, 0);
  assert.equal(society.lease.releases, 0, "a lease this process never held was released");
  assert.ok(lines.some(line => /does not own this society/.test(line)), lines.join(" | "));
  assert.ok(lines.some(line => /Dashboard, Config, and Mail/.test(line)), lines.join(" | "));
  // The lease is taken before anything is written, not after.
  assert.ok(calls.indexOf("tryHoldSociety") < calls.indexOf("readSettings"),
    `the configuration was read before ownership was decided: ${calls.join(" ")}`);
});

test("DR24: a start that names no society is a new session of the project, bound to it before anything of it is written", async () => {
  const society = await run({ argv: ["node", "oma"] });
  const { calls } = society;
  assert.ok(calls.includes("publishProjectBinding:/state/oma/fixture-new:fixture-new:/project"), calls.join(" "));
  assert.ok(calls.indexOf("tryHoldSociety") < calls.indexOf("publishProjectBinding:/state/oma/fixture-new:fixture-new:/project"));
  assert.ok(calls.includes("superviseBroker"), "the new session's broker was not started");
  society.broker.fireReady();
  await society.settle();
  assert.equal(society.started?.paths.sessionDir, `/state/oma/fixture-new/${SESSION_DIR_FROM_OWNER}`);
});

test("T119 / REC-007: a broker that is already listening is found before this process writes anything", async () => {
  // A standalone broker -- a systemd unit, an operator's own, or one outliving
  // the `oma` that started it -- owns the writing of this society, and it
  // takes no society lease to say so: it holds its own `broker.lock` and
  // nothing else. So a new `oma` could take a free lease and believe it owned
  // the society. That belief used to last until `superviseBroker` probed the
  // admin port, which happens after the configuration is written and after the
  // society has been provisioned and repaired -- a repair that rewrites
  // `/etc/passwd`, `/etc/group` and symlinks inside a rootfs the standing
  // broker may be building sandboxes from right now. The probe is the first
  // thing asked after ownership, so standing down costs nothing.
  const society = await run({ brokerAlreadyListening: true, argv: ["node", "oma", "--society", "fixture"] });
  const { calls, lines } = society;
  const order = name => calls.indexOf(name);
  assert.ok(calls.includes("brokerListening"), "the standing broker was never looked for");
  assert.ok(order("tryHoldSociety") < order("brokerListening"),
    `the probe ran before ownership was decided: ${calls.join(" ")}`);
  assert.equal(calls.includes("writeSettings"), false, "this process wrote configuration for a society another broker is serving");
  assert.equal(calls.includes("provisionSociety"), false, "this process wrote into a state tree another broker is serving");
  assert.equal(calls.includes("repairSociety"), false, "this process corrected a rootfs another broker is building sandboxes from");
  assert.equal(calls.includes("superviseBroker"), false, "a second broker was started for one society");
  assert.equal(calls.includes("PrincipalSession.start"), false);
  // Standing down gives the society back. Holding a lease over a society this
  // process has refused to act on would keep the next `oma` out for nothing.
  assert.equal(society.lease.releases, 1, "the society was refused and kept at the same time");
  assert.ok(lines.some(line => /broker is already running/.test(line)), lines.join(" | "));
});

test("T119 / REC-007 negative control: with no broker listening, the same run provisions and repairs", async () => {
  // Without this, the test above would pass for a build that never provisions
  // at all. The only difference between the two runs is the probe's answer.
  const society = await run({ brokerAlreadyListening: false });
  assert.ok(society.calls.includes("brokerListening"));
  assert.ok(society.calls.includes("provisionSociety"),
    "the control did not reproduce the ordinary path, so the refusal above proves nothing");
  assert.ok(society.calls.includes("superviseBroker"));
  assert.equal(society.lease.releases, 0);
});

test("VAL-002 / FS-005: the run root is judged before the society is taken, not after it is written", async () => {
  // `assertHostDirectoryLayout` used to run inside the lease, after the run
  // root had already been created with `mkdirSync`, so an `oma` pointed at a
  // symlinked or denormalized run root made the directory, took the society,
  // wrote its configuration and repaired its rootfs before the check it was
  // subject to ever ran. A path this process cannot vouch for now stops it
  // before it owns anything.
  const society = await run({ untrustedRunRoot: true });
  const { calls } = society;
  assert.ok(calls.some(name => name === "assertHostDirectoryLayout:/run/oma/fixture"),
    `the run root was never judged: ${calls.join(" ")}`);
  assert.equal(calls.includes("tryHoldSociety"), false,
    "the society was taken on the strength of a path this process cannot vouch for");
  assert.equal(calls.includes("readSettings"), false);
  assert.equal(calls.includes("provisionSociety"), false);
  assert.equal(calls.includes("superviseBroker"), false);
  assert.ok(calls.some(name => /^exit:/.test(name)), calls.join(" "));
});

test("VAL-002 negative control: a run root the product can vouch for is judged and then used", async () => {
  const society = await run();
  const order = name => society.calls.indexOf(name);
  assert.ok(order("assertHostDirectoryLayout:/run/oma/fixture") >= 0);
  assert.ok(order("assertHostDirectoryLayout:/run/oma/fixture") < order("tryHoldSociety"),
    `the control did not reproduce the ordering under test: ${society.calls.join(" ")}`);
  assert.ok(order("tryHoldSociety") >= 0,
    "the control did not reproduce the ordinary path, so the refusal above proves nothing");
});

test("P0V-58 / DR16 / DR35: the host prepares private paths and broker startup owns rootfs repair", async () => {
  // The rootfs used to be repaired here, before the broker existed -- and so
  // before anything had proven that the Residents an earlier broker failed to
  // stop had ended: one could still be running, or restarting and building its
  // sandbox, on the entries being rewritten. The repair now runs in the
  // broker, right after its startup quiescence and before it can wake a
  // Resident (broker-composition-policy); a repair that fails ends the
  // broker's startup, so no broker becomes ready or grants Society authority.
  const society = await run();
  const order = name => society.calls.indexOf(name);
  assert.equal(society.calls.includes("repairSociety"), false, "the host repaired the rootfs before any quiescence");
  assert.ok(order("tryHoldSociety") < order("provisionSociety"));
  assert.ok(order("provisionSociety") < order("superviseBroker"));
  assert.ok(society.calls.includes("PrincipalSession.start"));
  assert.equal(society.grants.length, 0);
  assert.equal(society.deliveries.length, 0);
  society.broker.fireReady();
  await society.settle();
  assert.ok(society.calls.includes("PrincipalSession.start"));
});

test("T119: quitting gives the society back, and only once the engine is really gone", async () => {
  const society = await run();
  society.broker.fireReady();
  await society.settle();
  assert.equal(society.lease.releases, 0);
  society.handlers.SIGTERM();
  await society.until(() => society.calls.includes("exit:0"));
  assert.equal(society.lease.releases, 1, "the society lease outlived the process that held it");
  // Not "close was called first" -- that was the old, weaker claim. The engine
  // reported its exit, and the lease was given up after that report.
  const order = name => society.calls.indexOf(name);
  assert.ok(order("PrincipalSession.exited") >= 0 && order("PrincipalSession.exited") < order("lease.release"),
    `the society was given up before the engine's exit was observed: ${society.calls.join(" ")}`);
  assert.ok(society.calls.includes("exit:0"));
  assert.ok(order("app.close") >= 0 && order("app.close") < order("PrincipalSession.exited"));
});

test("T119 / P0V-81, AV31: every signal that asks this process to end takes the same quitting path", async () => {
  assert.deepEqual([...HOST_LOSS_SIGNALS].sort(), ["SIGHUP", "SIGINT", "SIGQUIT", "SIGTERM"]);
  for (const signal of HOST_LOSS_SIGNALS) {
    const society = await run();
    society.broker.fireReady();
    await society.settle();
    assert.equal(typeof society.handlers[signal], "function", `${signal} ends the product by its default action`);
    society.handlers[signal]();
    await society.until(() => society.calls.includes("exit:0"));
    const order = name => society.calls.indexOf(name);
    assert.ok(order("PrincipalSession.exited") >= 0 && order("PrincipalSession.exited") < order("lease.release"),
      `${signal}: the society was given up before the engine's exit was observed: ${society.calls.join(" ")}`);
    assert.equal(society.lease.releases, 1, `${signal}: the society lease outlived the process that held it`);
  }
});

test("T119: an engine that will not die does not keep the product from quitting", async () => {
  // Waiting is bounded because quitting has to finish. Bounding it is only
  // safe because the engine inherited the lease's descriptor: the release
  // below hands the society to nobody until the engine is actually gone, so
  // the bound decides how long quitting takes and not how long the invariant
  // holds.
  const society = await run({ engineExits: false });
  society.broker.fireReady();
  await society.settle();
  assert.ok(society.started);
  society.handlers.SIGTERM();
  const deadline = Date.now() + 30000;
  while (!society.calls.includes("exit:0") && Date.now() < deadline)
    await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(society.calls.includes("exit:0"), `quitting never finished: ${society.calls.join(" ")}`);
  assert.equal(society.started.closes, 1, "the engine was not asked to stop");
  assert.equal(society.lease.releases, 1);
});

test("T119: a crash stops the broker and the engine this process started", async () => {
  // The crash path used to skip the engine entirely: it stopped the broker,
  // released the lease and exited, leaving a Principal engine running on a
  // society the next `oma` was now free to take. It cannot wait for the engine
  // here -- the next statement is the exit -- so it ends it and lets the
  // kernel hold the society until the engine is gone.
  const society = await run();
  society.broker.fireReady();
  await society.settle();
  assert.ok(society.started);
  society.handlers.uncaughtException(new Error("boom"));
  // Synchronous on purpose: the crash path's next statement is the exit, so
  // anything it deferred would never run.
  assert.equal(society.broker.stops, 1, "the broker was left running when the product crashed");
  assert.equal(society.started.closes, 1, "the engine outlived the process that owned it");
  assert.equal(society.lease.releases, 1);
  assert.ok(society.calls.includes("exit:3"));
  assert.ok(society.calls.indexOf("app.close") < society.calls.indexOf("restore"));
});

test("T119 / PR-002: delivery runs only once a broker is ready, and again as each turn settles", async () => {
  const { calls, deliveries, broker, settle, fireEvent } = await run();
  // A private conversation exists, but there is no Society delivery authority.
  assert.equal(calls.includes("PrincipalDelivery"), false);
  fireEvent({ type: "agent_settled" });
  await settle();
  assert.equal(deliveries.length, 0, "delivery was attempted with no broker ready");
  broker.fireReady();
  await settle();
  await settle();
  assert.ok(calls.includes("PrincipalDelivery"));
  assert.equal(deliveries.length, 1, "delivery did not run when the broker became ready");
  fireEvent({ type: "agent_settled" });
  await settle();
  assert.equal(deliveries.length, 2, "delivery did not run when a turn settled");
  fireEvent({ type: "turn_start" });
  await settle();
  assert.equal(deliveries.length, 2, "delivery ran on an event that does not free the session");
});

test("D05/WP16: the project is observed once and bound before this process writes anything of the society", async () => {
  const society = await run();
  const { calls } = society;
  const order = name => calls.findIndex(call => call === name || call.startsWith(`${name}:`));
  assert.equal(calls.filter(call => call.startsWith("realpath:")).length, 1);
  assert.ok(calls.includes("defaultSocietyFor:/project:64"), "the default society is derived from the canonical path and its digest");
  assert.ok(order("tryHoldSociety") < order("observeProjectBinding"));
  assert.ok(calls.includes("publishProjectBinding:/state/oma/fixture:fixture:/project"));
  assert.ok(order("publishProjectBinding") < order("readSettings"), "configuration was read or written before the binding");
  assert.ok(order("publishProjectBinding") < order("provisionSociety"));
});

test("D05/WP16: a society bound to another project is refused before any write, and the lease is given back", async () => {
  const society = await run({ binding: "mismatch" }).catch(error => ({ error }));
  const calls = society.calls ?? [];
  assert.ok(society.error ? /another project/.test(String(society.error)) : calls.some(call => /^exit:/.test(call)));
  for (const effect of ["readSettings", "writeSettings", "provisionSociety", "repairSociety", "superviseBroker", "collectManagedGenerations"])
    assert.equal(calls.includes(effect), false, `${effect} ran for a society bound elsewhere`);
  assert.equal(calls.some(call => call.startsWith("publishProjectBinding")), false);
});

test("WP15.03: a save whose configuration cannot be read back is reported as saved-unread, and no stale value is shown as current", async () => {
  const society = await run({ rereadFails: true });
  const ports = society.ports;
  assert.ok(ports, "the product built no screen ports");
  const outcome = ports.setField("worker-limit", 9);
  assert.equal(society.calls.some(call => call.startsWith("commitField:worker-limit")), true);
  assert.equal(outcome.kind, "saved-unread");
  assert.match(outcome.reason, /manifest unreadable/);
  const fields = ports.configFields();
  const limit = fields.find(field => field.id === "worker-limit");
  assert.equal(limit.value, "?", "the old value was still shown as the configuration");
  assert.match(limit.blocked, /Could not read settings back/);
});

test("WP15.03, P0: a save refused because the file changed since it was read shows what the file holds, and the next edit is made from it", async () => {
  const society = await run({ commitRefused: true });
  const ports = society.ports;
  assert.equal(ports.configFields().find(field => field.id === "worker-limit").value, 6);
  assert.throws(() => ports.setField("worker-limit", 7), /changed since it was read/);
  assert.equal(ports.configFields().find(field => field.id === "worker-limit").value, 5,
    "the screen kept showing the snapshot the refused edit was made from");
  assert.equal(ports.setField("worker-limit", 7).kind, "saved", "the next edit was still made from the stale snapshot");
  assert.deepEqual(society.calls.filter(call => call.startsWith("commitField:")), ["commitField:worker-limit:6", "commitField:worker-limit:5"]);
});

test("V10C: a registration answered after its broker was lost or replaced grants nothing to the new one", async () => {
  let answerA;
  const late = new Promise(resolve => { answerA = resolve; });
  const society = await run({ credentials: [late, "2".repeat(64)] });
  society.broker.fireReady();            // generation A asks
  await society.settle();
  society.broker.fireLost();             // A ends before answering
  society.broker.fireReady();            // generation B asks and is answered
  await society.until(() => society.grants.length === 1);
  answerA("1".repeat(64));               // A's answer arrives late
  await society.settle();
  await society.settle();
  assert.deepEqual(society.grants.map(grant => grant.credential), ["2".repeat(64)],
    "a credential from a lost broker generation reached the engine");
  // And a late refusal from A would not have revoked B's registration either.
  let refuseA;
  const lateRefusal = new Promise(resolve => { refuseA = resolve; });
  const other = await run({ credentials: [lateRefusal, "3".repeat(64)] });
  other.broker.fireReady();
  await other.settle();
  other.broker.fireLost();
  other.broker.fireReady();
  await other.until(() => other.grants.length === 1);
  refuseA(null);
  await other.settle();
  assert.equal(other.lines.some(line => /rejected the Principal session/.test(line)), false, "a late refusal from a lost broker was reported as current");
});


test("DR27: engine start failure is retryable from the fallback without restarting the broker", async () => {
  const society = await run({ startFailures: 1 });
  society.broker.fireReady(); await society.settle();
  assert.equal(society.started, null);
  assert.match(society.lines.join("\n"), /Enter \/restart/);
  assert.equal(society.ports.submitPrompt("/restart").kind, "accepted");
  await society.settle();
  assert.ok(society.started); assert.equal(society.broker.registrations.length, 1);
  assert.equal(society.calls.filter(call => call === "PrincipalSession.start").length, 2);
  assert.equal(society.calls.filter(call => call === "superviseBroker").length, 1);
});

test("DR27/P0: an RPC end waits for OS death; stale engine registration cannot grant its successor", async () => {
  let answerOld;
  const delayed = new Promise(resolve => { answerOld = resolve; });
  const society = await run({ credentials: [delayed, "2".repeat(64)] });
  society.broker.fireReady(); await society.settle();
  const old = society.started;
  old.running = false; old.sink.onEnd("RPC ended");
  await society.settle();
  society.ports.submitPrompt("/restart");
  assert.equal(society.started, old, "RPC termination is not child death");
  old.confirmDeath(); await society.settle();
  assert.equal(society.calls.filter(call => call === "PrincipalSession.start").length, 1, "no automatic crash loop");
  society.broker.fireLost();
  assert.equal(society.ports.submitPrompt("/restart").kind, "refused");
  society.broker.fireReady(); await society.settle();
  const next = society.started; assert.notEqual(next, old);
  assert.equal(society.grants.length, 1); assert.equal(society.grants[0].credential, "2".repeat(64));
  answerOld("1".repeat(64)); await society.settle();
  assert.equal(society.grants.length, 1);
  const lines = society.lines.length;
  old.sink.onEnd("late end"); old.sink.onLine("late line"); await society.settle();
  assert.equal(society.lines.length, lines); assert.equal(society.started, next);
  next.running = false; next.confirmDeath(); next.sink.onEnd("OS ended"); await society.settle();
  assert.equal(society.ports.submitPrompt("/restart").kind, "accepted"); await society.settle();
  assert.notEqual(society.started, next);
});

test("DR27: malformed host arguments perform no filesystem, lease, broker or engine work", async () => {
  for (const args of [["--unknown"], ["--config"], ["--society", "a", "--society", "b"],
    ["--bind-project", "--bind-project"], ["login", "--society", "ignored"], ["--config", "--help", "--unknown"]]) {
    const society = await run({ argv: ["node", "oma", ...args] });
    assert.deepEqual(society.calls, ["exit:2"], args.join(" "));
  }
});

for (const startupFailure of ["endpoint", "binding", "settings", "provision", "extensions"]) {
  test(`DR27/P0-4: startup ${startupFailure} failure returns its tenure before any terminal or broker exists`, async () => {
    const society = await run({ startupFailure });
    assert.equal(society.lease.holds, false);
    assert.equal(society.lease.releases, 1, "a taken lease has one return even if failure reporting also unwinds");
    for (const absent of ["superviseBroker", "PrincipalSession.start", "TuiApp", "restore", "holdsAtFail:true"])
      assert.equal(society.calls.includes(absent), false, absent);
    assert.equal(society.calls.filter(call => call.startsWith("exit:")).length, 1);
    if (["settings", "provision"].includes(startupFailure))
      assert.ok(society.calls.indexOf("lease.release") < society.calls.indexOf("fail:3"), "release precedes immediate process exit");
    else assert.ok(society.calls.indexOf("lease.release") < society.calls.indexOf("exit:3"));
  });
}

test("DR27/P0-4: an inconclusive startup observation never returns another host's tenure", async () => {
  const society = await run({ startupFailure: "endpoint", leased: false });
  assert.equal(society.lease.releases, 0);
  assert.equal(society.calls.includes("superviseBroker"), false);
  assert.equal(society.calls.includes("exit:3"), true);
});


test("DR27/P0-4: failed acquired engine keeps the terminal and restart slot until actual exit", async () => {
  const society = await run({ acquiredFailures: 1, engineExits: false });
  society.broker.fireReady(); await society.settle();
  const failed = society.started;
  assert.ok(failed); assert.equal(failed.closes, 1);
  assert.equal(society.calls.includes("reclaim"), false, "setup failure is not terminal ownership release");
  assert.equal(society.lines.some(line => /Enter \/restart/.test(line)), false);
  assert.equal(society.broker.registrations.length, 0, "failed setup cannot register");
  society.ports.submitPrompt("/restart"); await society.settle();
  assert.equal(society.calls.filter(call => call === "PrincipalSession.start").length, 1);
  society.broker.fireLost(); society.broker.fireReady(); await society.settle();
  assert.equal(society.calls.filter(call => call === "PrincipalSession.start").length, 1,
    "broker readiness cannot release a failed engine");
  failed.confirmDeath(); await society.settle();
  assert.equal(society.calls.filter(call => call === "reclaim").length, 1);
  assert.match(society.lines.join("\n"), /Enter \/restart/);
  assert.equal(society.ports.submitPrompt("/restart").kind, "accepted"); await society.settle();
  assert.notEqual(society.started, failed);
  assert.equal(society.broker.registrations.length, 1);
  assert.equal(society.calls.filter(call => call === "superviseBroker").length, 1);
  society.started.confirmDeath(); await society.settle();
});


test("DR27: project session directories echo the requesting UI observation id", async () => {
  const society = await run(); society.broker.fireReady(); await society.settle();
  const started = society.started;
  for (const id of ["sessions-1", "sessions-2"]) {
    started.sink.onUi({ type: "sessions_request", id });
    await society.settle();
    const reply = started.uiEvents.at(-1);
    assert.equal(reply.type, "session_dirs"); assert.equal(reply.id, id);
    assert.ok(Array.isArray(reply.dirs)); assert.equal(typeof reply.current, "string");
  }
  const before = started.uiEvents.length;
  started.sink.onUi({ type: "sessions_request" });
  assert.equal(started.uiEvents.length, before, "an uncorrelated query must not produce an uncorrelated answer");
  society.handlers.SIGINT(); await society.settle();
});

for (const ending of ["SIGTERM", "uncaughtException"]) {
  test(`DR27/P0-4: ${ending} returns the display poll and fences its late callback`, async () => {
    const society = await run(); const old = [...society.intervals][0];
    assert.ok(old); assert.equal(society.intervals.size, 1);
    society.handlers[ending](new Error("injected end"));
    assert.equal(society.intervals.size, 0, "display poll outlived host shutdown");
    const calls = society.calls.filter(name => name === "status").length;
    old.run(); await society.settle();
    assert.equal(society.calls.filter(name => name === "status").length, calls);
  });
}

for (const ending of ["SIGTERM", "uncaughtException"]) {
  test(`DR27/P0-4: ${ending} fences an in-flight display status response`, async () => {
    let resolveStatus, reads = 0;
    const society = await run({ statusReply: () => ++reads === 1 ? { kind: "unknown", reason: "probe", observedAtMs: 1 }
      : new Promise(resolve => { resolveStatus = resolve; }) });
    const timer = [...society.intervals][0]; timer.run(); assert.equal(reads, 2);
    society.handlers[ending](new Error("injected end"));
    const before = society.calls.filter(name => name === "app.draw" || name === "app.refresh").length;
    resolveStatus({ kind: "unknown", reason: "late", observedAtMs: 2 }); await society.settle();
    assert.equal(society.calls.filter(name => name === "app.draw" || name === "app.refresh").length, before);
    assert.equal(society.intervals.size, 0);
  });
  test(`DR27/P0-4: ${ending} during initial status cannot restore the closed display`, async () => {
    const society = await run({ statusReply: handlers => {
      handlers[ending](new Error("injected initial end"));
      return { kind: "unknown", reason: "late initial", observedAtMs: 1 };
    } });
    const closed = society.calls.indexOf("app.close"); assert.ok(closed >= 0);
    assert.equal(society.calls.slice(closed + 1).some(name => name === "app.draw" || name === "app.refresh"), false);
    assert.equal(society.intervals.size, 0);
  });
}
test("DR27/P0-4: a disowned host keeps its observation-only display until the Human quits", async () => {
  const society = await run({ disowned: "fixture disowned" }); await society.settle();
  assert.equal(society.intervals.size, 1);
  assert.equal(society.started, null);
  society.ports.quit(); await society.settle(); assert.equal(society.intervals.size, 0);
});
test("DR27/P0-4: shutdown during startup cannot acquire a later display poll", async () => {
  const society = await run({ onBrokerStart: handlers => handlers.SIGTERM() });
  assert.equal(society.intervals.size, 0);
  assert.equal(society.calls.includes("status"), false);
});
test("Session mode: Society switches to a fresh Personal session only after actual engine exit", async () => {
  const society = await run({ engineExits: false }); society.broker.fireReady(); await society.settle();
  const live = society.started;
  live.sink.onUi({ type: "switch", mode: "personal" }); await society.settle();
  assert.equal(society.restarts.length, 0);
  live.confirmDeath(); await society.until(() => society.restarts.length === 1);
  const [, argv, env] = society.restarts[0];
  assert.deepEqual(Array.from(argv), ["node", "/lib/apps/oma/dist/entry/oma.js", "--mode", "personal"]);
  assert.equal(env.OMA_RESUME_SESSION, undefined);
});
test("DR27/P0-4: relaunch returns the display poll before waiting for the engine", async () => {
  const society = await run({ engineExits: false }); society.broker.fireReady(); await society.settle();
  const old = [...society.intervals][0]; const live = society.started; assert.ok(live);
  live.sink.onUi({ type: "switch" });
  assert.equal(society.intervals.size, 0); assert.equal(society.calls.includes("execve"), false);
  const reads = society.calls.filter(name => name === "status").length;
  old.run(); await society.settle(); assert.equal(society.calls.filter(name => name === "status").length, reads);
  live.confirmDeath(); await society.settle(); assert.equal(society.calls.includes("execve"), true);
});

const PERSONAL_BIRTH = { id: "personal-fixture", mode: "personal", cwd: "/saved-personal" };
const PERSONAL_HISTORY = "/state/oma/.personal/personal-fixture/history/fixture.jsonl";

test("MODE-005: Society resumes Personal in its saved cwd only after the outgoing writer dies", async () => {
  const society = await run({ engineExits: false, resumeBirth: PERSONAL_BIRTH, argv: ["node", "oma", "--society", "fixture", "--bind-project"] });
  society.broker.fireReady(); await society.settle(); const live = society.started;
  live.sink.onUi({ type: "switch", session: PERSONAL_HISTORY }); await society.settle();
  assert.equal(live.closes, 1); assert.equal(society.restarts.length, 0); assert.equal(society.broker.stops, 0);
  live.confirmDeath(); await society.until(() => society.restarts.length === 1);
  const [node, argv, env] = society.restarts[0];
  assert.equal(node, "node"); assert.deepEqual(Array.from(argv), ["node", "/lib/apps/oma/dist/entry/oma.js"]);
  assert.equal(env.OMA_RESUME_SESSION, PERSONAL_HISTORY);
  assert.ok(society.calls.indexOf("chdir:/saved-personal") < society.calls.indexOf("execve"));
  assert.equal(society.broker.stops, 1); assert.equal(society.lease.releases, 1);
});

test("MODE-005: /new removes stale resume and binding intent instead of changing the old birth", async () => {
  const society = await run({ argv: ["node", "oma", "--society", "fixture", "--bind-project"] });
  society.broker.fireReady(); await society.settle();
  society.env.OMA_RESUME_SESSION = PERSONAL_HISTORY;
  society.started.sink.onUi({ type: "switch" }); await society.until(() => society.restarts.length === 1);
  const [, argv, env] = society.restarts[0];
  assert.equal(Object.hasOwn(env, "OMA_RESUME_SESSION"), false);
  assert.deepEqual(Array.from(argv), ["node", "/lib/apps/oma/dist/entry/oma.js"]);
  assert.equal(society.calls.filter(call => call.startsWith("publishSessionBirth:")).length, 1);
});

test("MODE-005: failed resume admission leaves the current Society and its display alive", async () => {
  const society = await run({ resumeError: new StoreError("STORE_CORRUPT", "fixture history is corrupt") });
  society.broker.fireReady(); await society.settle(); const live = society.started;
  live.sink.onUi({ type: "switch", session: PERSONAL_HISTORY }); await society.settle();
  assert.equal(society.started, live); assert.equal(live.closes, 0); assert.equal(society.broker.stops, 0);
  assert.equal(society.intervals.size, 1); assert.equal(society.restarts.length, 0); assert.equal(society.lease.holds, true);
  assert.match(live.uiEvents.at(-1).text, /fixture history is corrupt/);
  society.handlers.SIGTERM(); await society.settle();
});

for (const admission of ["corrupt", "personal"]) test(`MODE-005: direct Society ${admission} resume refuses before ownership or provisioning`, async () => {
  const society = await run({ argv: ["node", "oma", "--resume", PERSONAL_HISTORY], resumeBirth: PERSONAL_BIRTH,
    ...(admission === "corrupt" ? { resumeError: new StoreError("STORE_CORRUPT", "fixture history is corrupt") } : {}) });
  assert.equal(society.calls.filter(call => call === "sessionBirthForHistory").length, 1);
  for (const absent of ["tryHoldSociety", "readSettings", "writeSettings", "provisionSociety", "superviseBroker", "PrincipalSession.start", "TuiApp"])
    assert.equal(society.calls.includes(absent), false, absent);
  assert.equal(society.calls.filter(call => call.startsWith("exit:")).length, 1);
});

for (const failure of [false, true]) test(`MODE-005/P0-4: shutdown fences a late resume ${failure ? "failure" : "success"}`, async () => {
  let resolve, reject;
  const society = await run({ resumeReply: () => new Promise((yes, no) => { resolve = yes; reject = no; }) });
  society.broker.fireReady(); await society.settle(); const live = society.started;
  live.sink.onUi({ type: "switch", session: PERSONAL_HISTORY });
  society.handlers.SIGTERM(); await society.settle(); const notices = live.uiEvents.length;
  if (failure) reject(new StoreError("STORE_CORRUPT", "late admission failure")); else resolve(PERSONAL_BIRTH);
  await society.settle();
  assert.equal(society.restarts.length, 0); assert.equal(live.uiEvents.length, notices);
  assert.equal(society.calls.filter(call => call === "app.close").length, 1);
  assert.equal(society.lease.releases, 1); assert.equal(society.broker.stops, 1);
});

test("MODE-005/P0-4: one pending resume owns admission; duplicate switch cannot start a second teardown", async () => {
  let resolve;
  const society = await run({ resumeReply: () => new Promise(yes => { resolve = yes; }) });
  society.broker.fireReady(); await society.settle(); const live = society.started;
  live.sink.onUi({ type: "switch", session: PERSONAL_HISTORY });
  live.sink.onUi({ type: "switch" });
  live.sink.onUi({ type: "switch", session: PERSONAL_HISTORY }); await society.settle();
  assert.equal(live.closes, 0); assert.equal(society.restarts.length, 0);
  assert.equal(society.calls.filter(call => call === "sessionBirthForHistory").length, 1);
  resolve(PERSONAL_BIRTH); await society.until(() => society.restarts.length === 1);
  assert.equal(live.closes, 1); assert.equal(society.broker.stops, 1);
  assert.equal(society.restarts[0][2].OMA_RESUME_SESSION, PERSONAL_HISTORY);
});
