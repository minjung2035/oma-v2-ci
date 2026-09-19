/** T119 / TUI-002, PR-001: the product entrypoint's own wiring.
 *
 * Every part of the Principal's path had a test and the path was still broken,
 * twice, because nothing ran the file that wires the parts together. This runs
 * the real `src/entry/oma.ts` with controlled module boundaries and no host
 * I/O, and asserts the order and the values it passes between them: a broker
 * registered with a session before it starts, a credential waited for rather
 * than read past, and the engine given the environment its owner built.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { Script } from "node:vm";
import ts from "typescript";

const SESSION_ENVIRONMENT = { OMA_MARKER: "built by principalEnvironment" };

/** Runs the entrypoint. `credential` is what the supervised broker publishes;
 * `delayMs` is how long it takes to publish, so a run that read the value
 * instead of awaiting it would see nothing. */
async function run({ credential = "c".repeat(64), delayMs = 0, brokerState = { kind: "started", pid: 1 } } = {}) {
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
  let supervised = null;
  let started = null;
  const settings = {
    config: {
      society: "fixture",
      installation: { node: "node", libdir: "/lib", rootfs: "/rootfs", deploymentDigest: "a".repeat(64) },
      limits: { frameBytes: 262144, mailBodyBytes: 262144, idleStreamSeconds: 30, receiptWaitSeconds: 30 },
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
    "../tui/screen.js": { openTerminal: () => ({ restore() {}, onResize() {}, onKeys() {} }) },
    "../tui/dashboard.js": { dashboardData: () => ({}) },
    "../tui/session.js": {
      newSessionHandle: () => "h".repeat(32),
      principalEnvironment: (paths, profile, limits, session) => {
        calls.push("principalEnvironment");
        return { ...SESSION_ENVIRONMENT, credential: session.credential, sessionHandle: session.sessionHandle };
      },
      principalSessionProfile: () => ({ society: "fixture", provider: "pi", model: "current", workspaceBytes: 4096, extensions: [] }),
      PrincipalSession: class {
        static start(paths, profile, limits, environment) {
          calls.push("PrincipalSession.start");
          started = { paths, profile, limits, environment };
          return { close() {}, submit: async () => {} };
        }
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
        supervised = options;
        return {
          state: brokerState,
          credential: new Promise(resolve => {
            // Resolved later than the turn the supervisor returns on, so a run
            // that read the value instead of awaiting it sees nothing.
            setTimeout(() => { calls.push("credential published"); resolve(credential); }, delayMs);
          }),
          stop() {},
        };
      },
    },
    "../runtime/deployment-manifest.js": { deploymentDigest: () => "a".repeat(64) },
  };
  const process_ = {
    argv: ["node", "oma"], env: { HOME: "/home/user", XDG_DATA_HOME: "/state", XDG_RUNTIME_DIR: "/run" },
    execPath: "node", cwd: () => "/project", exitCode: 0,
    on() {}, exit(code) { throw new Error(`unexpected process.exit(${code})`); },
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
  return { calls, lines, supervised, started };
}

test("T119: the broker is registered with this session before it starts, and its credential is waited for", async () => {
  const { calls, supervised, started } = await run({ delayMs: 25 });
  // The handle exists before the broker does: who the Principal is cannot be
  // decided by whoever connects first.
  assert.equal(supervised.sessionHandle, "h".repeat(32));
  const order = name => calls.indexOf(name);
  assert.ok(order("provisionSociety") < order("superviseBroker"), "the society was not provisioned first");
  assert.ok(order("superviseBroker") < order("credential published"));
  // The engine starts only after the credential arrives. Reading past a
  // starting broker would put this before the publication, and an environment
  // cannot be given to a process that already exists.
  assert.ok(order("credential published") < order("PrincipalSession.start"),
    "the engine was started before the broker published its credential");
  assert.equal(started.environment.credential, "c".repeat(64));
  assert.equal(started.environment.sessionHandle, "h".repeat(32));
});

test("T119: the engine is given the environment its owner builds, not one assembled here", async () => {
  const { calls, started } = await run();
  assert.ok(calls.includes("principalEnvironment"), "the entry built the environment itself");
  // Every entry the owner produced reaches the engine unchanged.
  for (const [name, value] of Object.entries(SESSION_ENVIRONMENT))
    assert.equal(started.environment[name], value, `${name} did not reach the engine`);
  // The session is started in the Principal's own private space, which
  // provisioning creates.
  assert.match(started.paths.workspace, /principal\/private$/);
  assert.match(started.paths.sessionDir, /principal\/private\/sessions$/);
});

test("T119: a society whose broker this host does not own starts an engine with no authority, and says so", async () => {
  const { started, lines } = await run({ credential: null, brokerState: { kind: "already-running" } });
  assert.equal(started.environment.credential, null);
  // The Control Panel still works, and the reason is on the screen rather than
  // showing as an unexplained authentication failure later.
  assert.ok(lines.some(line => /broker/.test(line) && /소유/.test(line)),
    `the reason was never shown: ${lines.join(" | ")}`);
});

test("T119: a broker that fails to start does not stop the product or hide why", async () => {
  const { started, lines } = await run({ credential: null, brokerState: { kind: "unavailable", reason: "no entry" } });
  assert.ok(started, "the Control Panel was not started");
  assert.ok(lines.some(line => /no entry/.test(line)), `the failure was never reported: ${lines.join(" | ")}`);
});
