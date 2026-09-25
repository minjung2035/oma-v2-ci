/** T119 / TUI-002, PR-001, PR-002, LIFE-006: the product entrypoint's wiring.
 *
 * Every part of the Principal's path had a test and the path was still broken,
 * twice, because nothing ran the file that wires the parts together. This runs
 * the real `src/entry/oma.ts` with controlled module boundaries and no host
 * I/O, and asserts the order and the values it passes between them.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { Script } from "node:vm";
import ts from "typescript";

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
  disowned = null, leased = true, repairFails = false, engineExits = true,
  brokerAlreadyListening = false, untrustedRunRoot = false, binding = "fresh", rereadFails = false } = {}) {
  const source = readFileSync(new URL("../src/entry/oma.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText
    // The entry resolves its installation directory from its own module URL,
    // which CommonJS has no equivalent for. Only that one expression is
    // substituted; nothing else about the file is rewritten.
    .replaceAll("import.meta.url", JSON.stringify("file:///lib/dist/src/entry/oma.js"));
  const calls = [];
  const lines = [];
  const grants = [];
  const handlers = {};
  const deliveries = [];
  const lease = { holds: leased, releases: 0 };
  let started = null;
  let capturedPorts = null;
  let sessionListener = null;
  const broker = brokerStandIn(brokerState, credentials, disowned);
  const settings = {
    config: {
      society: "fixture",
      installation: { node: "node", libdir: "/lib", rootfs: "/rootfs", deploymentDigest: "a".repeat(64) },
      limits: { frameBytes: 262144, mailBodyBytes: 262144, batchMaxMessages: 24, idleStreamSeconds: 30, receiptWaitSeconds: 30 },
      principalProfile: "principal",
      agentProfiles: { principal: { modelProfile: "m", resources: { workspaceBytes: 4096 } } },
      modelProfiles: { m: { provider: "pi", model: "current" } },
    },
    fields: [],
    workerProfile: "worker",
  };
  const modules = {
    "node:path": path,
    "node:fs": { existsSync: () => true, mkdirSync() {}, realpathSync: path => { calls.push(`realpath:${path}`); return "/project"; } },
    "node:url": { fileURLToPath: () => "/lib/" },
    "../ids.js": { isValidSocietyName: () => true },
    // The path checks are the product's own; what this harness controls is
    // only whether they pass, because what is under test here is when the
    // entry asks -- before it takes the society, and before it writes.
    "../runtime/assets.js": {
      // The host decides the location once, from its own environment.
      hostLaunchLocation: (society, env, configPath) => {
        calls.push("hostLaunchLocation");
        return { society, stateRoot: path.join(env.XDG_DATA_HOME, "oma", society), runRoot: path.join(env.XDG_RUNTIME_DIR, "oma", society),
          configPath: configPath ?? path.join(env.XDG_DATA_HOME, "oma", society, "config.json") };
      },
      assertHostDirectoryLayout: (root, allowMissing) => {
        calls.push(`assertHostDirectoryLayout:${root}`);
        assert.equal(allowMissing, true, "the run root was required to exist before it had been made");
        if (untrustedRunRoot) throw new StoreError("INVALID_ARGUMENT", "host directory ancestors must be real directories, not symlinks");
      },
    },
    "../domain/deployment.js": { DEPLOYMENT_LAYOUT: { extension: "dist/src/pi-extension.js", cli: "dist/src/cli.js" } },
    "../runtime/pi-runtime.js": { resolvePiRuntime: () => ({ executable: "node", args: [], agentDir: "/state/pi" }) },
    "../storage/directory.js": { ensureDirectory() {} },
    "../tui/app.js": { TuiApp: class {
      constructor(ports) { calls.push("TuiApp"); capturedPorts = ports; }
      refresh() {} draw() {} line(text) { lines.push(text); } setBusy() {} note() {}
    } },
    "../tui/exit.js": { codeFor: () => 1, fail: reason => { throw new Error(`fail: ${reason}`); } },
    "../tui/screen.js": { openTerminal: () => ({ restore() { calls.push("restore"); }, onResize() {}, onKeys() {} }) },
    "../tui/dashboard.js": { dashboardData: () => ({}) },
    "../tui/session.js": {
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
      principalSessionProfile: () => ({ society: "fixture", provider: "pi", model: "current", workspaceBytes: 4096, extensions: [] }),
      PrincipalSession: class {
        static start(paths, profile, limits, environment) {
          calls.push("PrincipalSession.start");
          // The engine the entry is holding, not a snapshot of its arguments:
          // whether it is still running when ownership ends is the whole
          // question TUI-004 asks here.
          let confirmDeath = () => {};
          started = {
            paths, profile, limits, environment, closes: 0,
            pid: 777, busy: false, running: true,
            // The operating system's answer, not this process's request. A
            // teardown that treated `close()` as the death could give the
            // society away while the engine it paid for was still running.
            exited: new Promise(resolve => { confirmDeath = resolve; }),
            confirmDeath: () => { confirmDeath(); },
            grant(credential, sessionHandle) { grants.push({ credential, sessionHandle }); },
            onEvent(listener) { sessionListener = listener; return () => {}; },
            deliver: async () => {}, submit: async () => {},
            close() {
              calls.push("PrincipalSession.close"); started.closes += 1; started.running = false;
              // A real engine's exit is reported by the operating system on a
              // later turn, never inside the call that asked it to stop.
              // Resolving it here would make a teardown that never waited
              // indistinguishable from one that did.
              if (engineExits) setImmediate(() => { calls.push("PrincipalSession.exited"); confirmDeath(); });
            },
          };
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
    "../tui/transport.js": {
      limitsOf: value => value,
      TuiTransport: class { async status() { return { kind: "unknown", reason: "probe", observedAtMs: 1 }; } },
    },
    "../tui/sources/mail.js": { principalMailbox: () => ({}), readBody: () => null, readMailbox: () => [], unreadCount: () => 0 },
    "../tui/sources/extensions.js": { readExtensions: () => ({ rows: [] }), toggleExtension() {} },
    "../tui/sources/settings.js": {
      commitField: (_settings, field) => { calls.push(`commitField:${field}`); return { kind: "saved" }; },
      bootstrapStateOf: () => "unknown",
      fieldsOf: () => rereadFails ? [{ kind: "number", id: "worker-limit", label: "Worker limit", value: 8, min: 1, max: 64, apply: "restart", blocked: null },
        { kind: "link", id: "extensions", label: "Extensions" }] : settings.fields,
      readSettings: () => {
        calls.push("readSettings");
        if (rereadFails && calls.filter(call => call === "readSettings").length > 1) throw new Error("manifest unreadable");
        return settings;
      },
      writeSettings() { calls.push("writeSettings"); },
    },
    "../hash.js": { sha256Hex: bytes => { calls.push("sha256Hex"); return "f".repeat(64); } },
    "../config/defaults.js": { defaultHostConfig: () => ({}), defaultSocietyFor: (path, digest) => { calls.push(`defaultSocietyFor:${path}:${digest.length}`); return "fixture"; },
      societyFromDirectory: () => "old-slug" },
    "../runtime/provision.js": {
      // D05: the binding scenario is controlled; the decision itself is the
      // product's pure rule, exercised against real files in project-binding.test.
      observeProjectBinding: root => {
        calls.push(`observeProjectBinding:${root}`);
        if (binding === "bound") return { kind: "bound", binding: { kind: "oma-project-binding-v1", society: "fixture", canonicalProjectPath: "/project" } };
        if (binding === "mismatch") return { kind: "bound", binding: { kind: "oma-project-binding-v1", society: "fixture", canonicalProjectPath: "/elsewhere" } };
        return { kind: "absent" };
      },
      stateRootHasSociety: root => root === "/state/oma/fixture" ? binding === "bound" || binding === "mismatch" : binding === "legacy" && root === "/state/oma/old-slug",
      projectBindingDecision: input => {
        calls.push("projectBindingDecision");
        if (input.observation.kind === "bound")
          return input.observation.binding.canonicalProjectPath === input.canonicalProjectPath ? { kind: "proceed" } : { kind: "refuse", reason: "another project" };
        return { kind: "publish" };
      },
      publishProjectBinding: (root, value) => { calls.push(`publishProjectBinding:${root}:${value.society}:${value.canonicalProjectPath}`); },
      provisionSociety: () => {
        calls.push("provisionSociety");
        return { created: [], seeded: false, seedSource: null, seedNote: null, pendingRepairs: ["/state/rootfs/etc/passwd"] };
      },
      repairSociety: () => {
        calls.push("repairSociety");
        if (repairFails) throw new Error("rootfs entry could not be corrected");
        return ["/state/rootfs/etc/passwd"];
      },
      residentRootfsPath: () => "/state/rootfs",
    },
    "../domain/errors.js": { StoreError },
    // The real tenure over a controlled lease: what the entry may do, and when,
    // is the thing under test here.
    "../runtime/host-tenure.js": loadSource("src/runtime/host-tenure.ts", {
      "../domain/errors.js": { StoreError },
      "./society-lease.js": {
        tryHoldSociety: stateRoot => {
          calls.push("tryHoldSociety");
          // The state tree, not the run directory: the tree is the thing that
          // must not have two writers, and a run directory is per-boot and
          // replaceable, so two run directories over one tree used to be two
          // societies as far as the lease could tell.
          assert.equal(stateRoot, "/state/oma/fixture", "the lease was not taken on this society's state tree");
          if (!lease.holds) return null;
          return { name: `\0oma.society.${"a".repeat(64)}`, fence: FENCE,
            release() { calls.push("lease.release"); lease.releases += 1; lease.holds = false; } };
        },
      },
    }),
    "../runtime/broker-supervisor.js": {
      brokerListening: async runRoot => {
        calls.push("brokerListening");
        assert.equal(runRoot, "/run/oma/fixture", "the standing broker was looked for somewhere else");
        return brokerAlreadyListening;
      },
      superviseBroker: async options => {
        calls.push("superviseBroker");
        assert.equal("sessionHandle" in options, false, "a session handle was put where the broker's environment could carry it");
        // A broker without the fence can outlive the lease it writes under.
        assert.equal(options.fence, FENCE, "the broker was started without the society lease descriptor");
        // D03: the broker is handed the host's whole location, not left to derive it.
        assert.deepEqual([options.stateRoot, options.runRoot, options.configPath],
          ["/state/oma/fixture", "/run/oma/fixture", "/state/oma/fixture/config.json"]);
        return broker.handle;
      },
    },
    "../runtime/deployment-manifest.js": { deploymentDigest: () => "a".repeat(64) },
    "../config/generations.js": { collectManagedGenerations: () => { calls.push("collectManagedGenerations"); return []; } },
  };
  const process_ = {
    argv: ["node", "oma"], env: { HOME: "/home/user", XDG_DATA_HOME: "/state", XDG_RUNTIME_DIR: "/run" },
    execPath: "node", cwd: () => "/project", exitCode: 0,
    on(event, handler) { handlers[event] = handler; },
    exit(code) { calls.push(`exit:${code}`); },
    stdin: {}, stdout: {}, stderr: { write() {} },
  };
  const completion = new Script(compiled, { filename: "oma-composition.cjs" }).runInNewContext({
    exports: {}, module: { exports: {} }, process: process_, console: { error() {} },
    setInterval: () => ({ unref() {} }), clearInterval() {}, setTimeout, clearTimeout, Promise, Date, JSON,
    require(name) {
      assert.ok(Object.hasOwn(modules, name), `uncontrolled dependency: ${name}`);
      return modules[name];
    },
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
  return { calls, lines, grants, handlers, deliveries, broker: broker.record, settle, lease, until,
    get started() { return started; },
    get ports() { return capturedPorts; },
    fireEvent: event => sessionListener?.(event) };
}

test("T119: the engine starts when this process is proved to own the society, not when a broker is spawned", async () => {
  const society = await run();
  // A spawned broker is a pid, not an owned society: between the supervisor's
  // probe and the lock the child takes, another `oma` can take it. Starting the
  // engine here is starting a second Principal on one society.
  assert.equal(society.calls.includes("PrincipalSession.start"), false,
    "an engine was started on a spawn, before any broker said it holds the society");
  assert.equal(society.started, null);
  assert.equal(society.calls.includes("PrincipalDelivery"), false,
    "a delivery owner was built with no session to deliver into");

  // Readiness is the broker saying it holds the society lock, and it is the
  // only thing the engine waits for.
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
  assert.ok(order("repairSociety") < order("collectManagedGenerations"));
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
  assert.ok(society.lines.some(line => /받아들이지 않았습니다/.test(line)), society.lines.join(" | "));
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
  const society = await run({ leased: false });
  const ports = society.ports;
  assert.ok(ports, "the product built no panels at all");
  assert.throws(() => ports.setField("limits.frameBytes", 1024), /소유/,
    "a non-owner changed the running owner's configuration");
  assert.throws(() => ports.setExtension("ext", "principal", true), /소유/,
    "a non-owner changed the running owner's extensions");
  assert.equal(society.calls.includes("writeSettings"), false);
  // Reading is exactly what it is for, and still works.
  assert.deepEqual(ports.configFields(), []);
  assert.deepEqual(ports.mail(), []);
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
  assert.throws(() => society.ports.setField("limits.frameBytes", 2048), /소유/,
    "a process wrote to a society it had already given back");
  assert.throws(() => society.ports.setExtension("ext", "principal", true), /소유/);
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
  assert.ok(lines.some(line => /소유하지 않습니다/.test(line)), lines.join(" | "));
  assert.ok(lines.some(line => /already owns this society/.test(line)), lines.join(" | "));
  assert.ok(lines.some(line => /Dashboard, Config, Mail/.test(line)), lines.join(" | "));
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
  assert.ok(lines.some(line => /Dashboard, Config, Mail/.test(line)), lines.join(" | "));
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
  assert.ok(society.lines.some(line => /Pi 세션을 닫았습니다/.test(line)), society.lines.join(" | "));

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
  const society = await run({ leased: false });
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
  assert.ok(lines.some(line => /소유하지 않습니다/.test(line)), lines.join(" | "));
  assert.ok(lines.some(line => /Dashboard, Config, Mail/.test(line)), lines.join(" | "));
  // The lease is taken before anything is written, not after.
  assert.ok(calls.indexOf("tryHoldSociety") < calls.indexOf("readSettings"),
    `the configuration was read before ownership was decided: ${calls.join(" ")}`);
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
  const society = await run({ brokerAlreadyListening: true });
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
  assert.ok(lines.some(line => /broker가 이미 실행 중입니다/.test(line)), lines.join(" | "));
});

test("T119 / REC-007 negative control: with no broker listening, the same run provisions and repairs", async () => {
  // Without this, the test above would pass for a build that never provisions
  // at all. The only difference between the two runs is the probe's answer.
  const society = await run({ brokerAlreadyListening: false });
  assert.ok(society.calls.includes("brokerListening"));
  assert.ok(society.calls.includes("provisionSociety"),
    "the control did not reproduce the ordinary path, so the refusal above proves nothing");
  assert.ok(society.calls.includes("repairSociety"));
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

test("T119 / REC-007: the rootfs is put right before anything can run on it", async () => {
  // Provisioning creates what is absent; correcting an entry that exists and
  // is wrong is a write over live state, so it waits for ownership. It used to
  // wait for the broker's readiness as well, which put it in a race it could
  // only lose: the broker reconciles as soon as it is listening and starts
  // enabled Residents with pending work, in another process, with nothing
  // acknowledging between the two. A sandbox could therefore be built on the
  // very entry this repair was about to correct. Nothing the broker does can
  // be ordered against this from here, so the repair finishes before the
  // broker exists.
  const society = await run();
  const order = name => society.calls.indexOf(name);
  assert.equal(society.calls.filter(name => name === "repairSociety").length, 1);
  assert.ok(order("tryHoldSociety") < order("provisionSociety"));
  assert.ok(order("provisionSociety") < order("repairSociety"));
  assert.ok(order("repairSociety") < order("superviseBroker"),
    `a broker was started before the rootfs it activates residents on was put right: ${society.calls.join(" ")}`);
  assert.ok(society.lines.some(line => /etc\/passwd/.test(line)), society.lines.join(" | "));

  // Only once, however many times a restarted broker becomes ready.
  society.broker.fireReady();
  await society.settle();
  society.broker.fireReady();
  await society.settle();
  assert.equal(society.calls.filter(name => name === "repairSociety").length, 1);
});

test("T119 / REC-007: a rootfs that could not be put right starts no broker and no engine", async () => {
  // The previous behaviour wrote the failure to the screen and carried on, so
  // "the rootfs is as the product intends" and "the product could not tell"
  // looked the same from the outside -- and Residents ran either way.
  const society = await run({ repairFails: true });
  assert.ok(society.calls.includes("repairSociety"));
  assert.equal(society.calls.includes("superviseBroker"), false,
    "a broker was started over a rootfs the product could not vouch for");
  assert.equal(society.calls.includes("PrincipalSession.start"), false);
  assert.equal(society.started, null);
  assert.ok(society.calls.some(name => /^exit:/.test(name)), society.calls.join(" "));
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
});

test("T119 / PR-002: delivery runs only once a broker is ready, and again as each turn settles", async () => {
  const { calls, deliveries, broker, settle, fireEvent } = await run();
  // Before the broker is ready there is no session, so there is nothing to
  // deliver into and nothing to prepare from.
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

test("D05/WP16: an earlier default-name society of this project is pointed out, not silently replaced by a new one", async () => {
  const society = await run({ binding: "legacy" }).catch(error => ({ error }));
  const calls = society.calls ?? [];
  assert.ok(society.error ? /old-slug/.test(String(society.error)) : calls.some(call => /^exit:/.test(call)), calls.join(" "));
  for (const effect of ["readSettings", "writeSettings", "provisionSociety", "superviseBroker"])
    assert.equal(calls.includes(effect), false, `${effect} ran instead of pointing at the earlier society`);
  assert.equal(calls.some(call => call.startsWith("publishProjectBinding")), false);
});

test("WP15.03: a save whose configuration cannot be read back is reported as saved-unread, and no stale value is shown as current", async () => {
  const society = await run({ rereadFails: true });
  const ports = society.ports;
  assert.ok(ports, "the product built no screen ports");
  const outcome = ports.setField("worker-limit", 9);
  assert.equal(society.calls.includes("commitField:worker-limit"), true);
  assert.equal(outcome.kind, "saved-unread");
  assert.match(outcome.reason, /manifest unreadable/);
  const fields = ports.configFields();
  const limit = fields.find(field => field.id === "worker-limit");
  assert.equal(limit.value, "?", "the old value was still shown as the configuration");
  assert.match(limit.blocked, /다시 읽지 못함/);
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
  assert.equal(other.lines.some(line => /받아들이지 않았습니다/.test(line)), false, "a late refusal from a lost broker was reported as current");
});
