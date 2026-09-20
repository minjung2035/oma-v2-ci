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

const SESSION_ENVIRONMENT = { OMA_MARKER: "built by principalEnvironment" };
const SESSION_DIR_FROM_OWNER = "answered-by-principalSessionDir";

/** A supervised broker the test drives: it becomes ready when told, answers
 * registrations with the next credential in `credentials`, and records every
 * call. */
function brokerStandIn(state, credentials, disownedReason = null) {
  const readyListeners = [];
  const disownedListeners = [];
  const record = {
    registrations: [], stops: 0,
    fireReady: () => { for (const listener of readyListeners) listener(); },
    fireDisowned: reason => { for (const listener of disownedListeners) listener(reason); },
  };
  return {
    record,
    handle: {
      state,
      onReady(listener) { readyListeners.push(listener); },
      // The real handle calls a listener at once when ownership is already
      // settled against this process, so a listener added later cannot miss it.
      onDisowned(listener) {
        disownedListeners.push(listener);
        if (disownedReason !== null) listener(disownedReason);
      },
      async register(sessionHandle, pid) {
        record.registrations.push({ sessionHandle, pid });
        return credentials.shift() ?? null;
      },
      stop() { record.stops += 1; },
    },
  };
}

async function run({ brokerState = { kind: "started", pid: 1 }, credentials = ["1".repeat(64), "2".repeat(64)],
  disowned = null, leased = true } = {}) {
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
    "node:fs": { existsSync: () => true, mkdirSync() {} },
    "node:url": { fileURLToPath: () => "/lib/" },
    "../ids.js": { isValidSocietyName: () => true },
    "../domain/deployment.js": { DEPLOYMENT_LAYOUT: { extension: "dist/src/pi-extension.js", cli: "dist/src/cli.js" } },
    "../runtime/pi-runtime.js": { resolvePiRuntime: () => ({ executable: "node", args: [], agentDir: "/state/pi" }) },
    "../storage/directory.js": { ensureDirectory() {} },
    "../tui/app.js": { TuiApp: class {
      constructor() { calls.push("TuiApp"); }
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
          started = {
            paths, profile, limits, environment, closes: 0,
            pid: 777, busy: false, running: true,
            grant(credential, sessionHandle) { grants.push({ credential, sessionHandle }); },
            onEvent(listener) { sessionListener = listener; return () => {}; },
            deliver: async () => {}, submit: async () => {},
            close() { calls.push("PrincipalSession.close"); started.closes += 1; started.running = false; },
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
      commitField() {},
      readSettings: () => { calls.push("readSettings"); return settings; },
      writeSettings() { calls.push("writeSettings"); },
    },
    "../config/defaults.js": { defaultHostConfig: () => ({}), societyFromDirectory: () => "fixture" },
    "../runtime/provision.js": {
      provisionSociety: () => {
        calls.push("provisionSociety");
        return { created: [], seeded: false, seedSource: null, seedNote: null, pendingRepairs: ["/state/rootfs/etc/passwd"] };
      },
      repairSociety: () => { calls.push("repairSociety"); return ["/state/rootfs/etc/passwd"]; },
      residentRootfsPath: () => "/state/rootfs",
    },
    "../runtime/society-lease.js": {
      tryHoldSociety: runRoot => {
        calls.push("tryHoldSociety");
        assert.equal(runRoot, "/run/oma/fixture", "the lease was not taken on this society's run root");
        if (!lease.holds) return null;
        return { path: `${runRoot}/society.lease`,
          release() { calls.push("lease.release"); lease.releases += 1; lease.holds = false; } };
      },
    },
    "../runtime/broker-supervisor.js": {
      superviseBroker: async options => {
        calls.push("superviseBroker");
        assert.equal("sessionHandle" in options, false, "a session handle was put where the broker's environment could carry it");
        return broker.handle;
      },
    },
    "../runtime/deployment-manifest.js": { deploymentDigest: () => "a".repeat(64) },
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
  const settle = () => new Promise(resolve => setImmediate(resolve));
  // `started` is read through an accessor, not copied out here: what this
  // suite now asks is when the engine starts, and a value snapshotted at
  // return would answer "never" for every test that fires readiness later.
  return { calls, lines, grants, handlers, deliveries, broker: broker.record, settle, lease,
    get started() { return started; },
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
  assert.match(started.paths.workspace, /principal\/private$/);
  assert.ok(calls.includes("principalSessionDir"), "the entry decided the session directory itself");
  assert.equal(started.paths.sessionDir, `/state/oma/fixture/${SESSION_DIR_FROM_OWNER}`);
  // The credential travels only after the engine exists, and only into it.
  assert.deepEqual(grants, [{ credential: "1".repeat(64), sessionHandle: "h".repeat(32) }]);
  const order = name => calls.indexOf(name);
  assert.ok(order("provisionSociety") < order("superviseBroker"));
  assert.ok(order("superviseBroker") < order("PrincipalSession.start"));
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

test("T119: a refused registration is said on the screen and grants nothing", async () => {
  const { broker, grants, lines, settle } = await run({ credentials: [] });
  broker.fireReady();
  await settle();
  assert.equal(grants.length, 0);
  assert.ok(lines.some(line => /받아들이지 않았습니다/.test(line)), lines.join(" | "));
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

test("T119 / REC-007: the rootfs is put right only once this process owns the society", async () => {
  // Provisioning creates what is absent, which is safe for anyone. Correcting
  // an entry that exists and is wrong is a write over live state, so it waits
  // for ownership -- the lease, and this process's own broker holding the
  // society lock.
  const society = await run();
  assert.ok(society.calls.includes("provisionSociety"));
  assert.equal(society.calls.includes("repairSociety"), false,
    "existing rootfs state was rewritten before this process was proved to own the society");
  society.broker.fireReady();
  await society.settle();
  assert.equal(society.calls.filter(name => name === "repairSociety").length, 1);
  const order = name => society.calls.indexOf(name);
  assert.ok(order("tryHoldSociety") < order("provisionSociety"));
  assert.ok(order("provisionSociety") < order("repairSociety"));
  assert.ok(order("repairSociety") < order("PrincipalSession.start"),
    "the engine started before the rootfs it runs residents on was put right");
  assert.ok(society.lines.some(line => /etc\/passwd/.test(line)), society.lines.join(" | "));

  // Only once, however many times a restarted broker becomes ready.
  society.broker.fireReady();
  await society.settle();
  assert.equal(society.calls.filter(name => name === "repairSociety").length, 1);
});

test("T119: quitting gives the society back", async () => {
  const society = await run();
  society.broker.fireReady();
  await society.settle();
  assert.equal(society.lease.releases, 0);
  society.handlers.SIGTERM();
  assert.equal(society.lease.releases, 1, "the society lease outlived the process that held it");
  assert.ok(society.calls.includes("exit:0"));
});

test("T119: a crash stops the broker this process started", async () => {
  const { handlers, broker, calls } = await run();
  handlers.uncaughtException(new Error("boom"));
  assert.equal(broker.stops, 1, "the broker was left running when the product crashed");
  assert.ok(calls.includes("exit:3"));
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
