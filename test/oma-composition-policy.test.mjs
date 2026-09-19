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

/** A supervised broker the test drives: it becomes ready when told, answers
 * registrations with the next credential in `credentials`, and records every
 * call. */
function brokerStandIn(state, credentials) {
  const readyListeners = [];
  const record = { registrations: [], stops: 0, fireReady: () => { for (const listener of readyListeners) listener(); } };
  return {
    record,
    handle: {
      state,
      onReady(listener) { readyListeners.push(listener); },
      async register(sessionHandle, pid) {
        record.registrations.push({ sessionHandle, pid });
        return credentials.shift() ?? null;
      },
      stop() { record.stops += 1; },
    },
  };
}

async function run({ brokerState = { kind: "started", pid: 1 }, credentials = ["1".repeat(64), "2".repeat(64)] } = {}) {
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
  let started = null;
  let sessionListener = null;
  const broker = brokerStandIn(brokerState, credentials);
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
      principalSessionDir: root => `${root}/agents/principal/runner/sessions`,
      principalEnvironment: (...args) => {
        calls.push(`principalEnvironment/${args.length}`);
        return { ...SESSION_ENVIRONMENT };
      },
      principalSessionProfile: () => ({ society: "fixture", provider: "pi", model: "current", workspaceBytes: 4096, extensions: [] }),
      PrincipalSession: class {
        static start(paths, profile, limits, environment) {
          calls.push("PrincipalSession.start");
          started = { paths, profile, limits, environment };
          return {
            pid: 777, busy: false, running: true,
            grant(credential, sessionHandle) { grants.push({ credential, sessionHandle }); },
            onEvent(listener) { sessionListener = listener; return () => {}; },
            deliver: async () => {}, close() {}, submit: async () => {},
          };
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
    "../tui/sources/settings.js": { commitField() {}, readSettings: () => settings, writeSettings() {} },
    "../config/defaults.js": { defaultHostConfig: () => ({}), societyFromDirectory: () => "fixture" },
    "../runtime/provision.js": {
      provisionSociety: () => { calls.push("provisionSociety"); return { created: [], seeded: false, seedSource: null, seedNote: null }; },
      residentRootfsPath: () => "/state/rootfs",
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
  return { calls, lines, grants, handlers, deliveries, broker: broker.record, started, settle,
    fireEvent: event => sessionListener?.(event) };
}

test("T119: the engine starts at once, with the environment its owner builds and no secret in it", async () => {
  const { calls, started, grants } = await run();
  // The engine does not wait for the broker: a slow broker delays the
  // Principal's society requests, not the Principal.
  assert.ok(calls.includes("PrincipalSession.start"));
  assert.equal(grants.length, 0, "a credential was handed over before any broker was ready");
  // The environment is exactly what principalEnvironment returned -- three
  // arguments, no credential parameter to pass one through.
  assert.ok(calls.includes("principalEnvironment/3"));
  assert.deepEqual(started.environment, SESSION_ENVIRONMENT);
  assert.match(started.paths.workspace, /principal\/private$/);
  assert.match(started.paths.sessionDir, /agents\/principal\/runner\/sessions$/);
  const order = name => calls.indexOf(name);
  assert.ok(order("provisionSociety") < order("superviseBroker"));
});

test("T119: each time a broker becomes ready the engine is registered and given its credential", async () => {
  const run1 = await run();
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

test("T119: a society whose broker this host does not own is said on the screen", async () => {
  const { lines, broker } = await run({ brokerState: { kind: "already-running" } });
  assert.equal(broker.registrations.length, 0);
  assert.ok(lines.some(line => /다른 프로세스가 소유/.test(line)), lines.join(" | "));
});

test("T119: a broker that fails to start does not stop the product or hide why", async () => {
  const { started, lines } = await run({ brokerState: { kind: "unavailable", reason: "no entry" } });
  assert.ok(started, "the engine was not started");
  assert.ok(lines.some(line => /no entry/.test(line)), lines.join(" | "));
});

test("T119: a crash stops the broker this process started", async () => {
  const { handlers, broker, calls } = await run();
  handlers.uncaughtException(new Error("boom"));
  assert.equal(broker.stops, 1, "the broker was left running when the product crashed");
  assert.ok(calls.includes("exit:3"));
});

test("T119 / PR-002: delivery runs only once a broker is ready, and again as each turn settles", async () => {
  const { calls, deliveries, broker, settle, fireEvent } = await run();
  assert.ok(calls.includes("PrincipalDelivery"));
  // Before the broker is ready there is nothing to prepare from.
  fireEvent({ type: "agent_settled" });
  await settle();
  assert.equal(deliveries.length, 0, "delivery was attempted with no broker ready");
  broker.fireReady();
  await settle();
  await settle();
  assert.equal(deliveries.length, 1, "delivery did not run when the broker became ready");
  fireEvent({ type: "agent_settled" });
  await settle();
  assert.equal(deliveries.length, 2, "delivery did not run when a turn settled");
  fireEvent({ type: "turn_start" });
  await settle();
  assert.equal(deliveries.length, 2, "delivery ran on an event that does not free the session");
});
