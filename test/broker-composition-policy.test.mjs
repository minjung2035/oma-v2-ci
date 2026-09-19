import test from "node:test";
import assert from "node:assert/strict";
import { fstatSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { Script } from "node:vm";
import { spawn } from "node:child_process";
import { once } from "node:events";
import ts from "typescript";

/** Run the actual entrypoint with controlled module boundaries, without host I/O.
 * This checks composition and phase wiring, not real systemd/recovery behavior.
 */
async function compose(environment) {
  const source = readFileSync(new URL("../src/entry/broker.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  assert.equal(compiled.split("void main().catch").length, 2, "retain the single main invocation");
  // Retain the already-existing main promise instead of discarding it with void.
  const executable = compiled.replace("void main().catch", "main().catch");
  const calls = [], paths = [], observation = { value: true, error: null };
  let constructorGoal;
  const config = { society: "fixture", installation: { node: "node", libdir: "/lib", rootfs: "/rootfs", deploymentDigest: "a".repeat(64) },
    quota: { storageBytes: 1024 }, integration: { checks: [] }, limits: { receiptWaitSeconds: 1 }, agentProfiles: {}, modelProfiles: {} };
  const modules = {
    "node:path": path,
    // The real fstatSync: the entry asks what descriptor 3 actually is before
    // it will register a session, and a stub that simply lacked the function
    // would make this pass for the wrong reason.
    "node:fs": { mkdirSync() {}, fstatSync, writeSync() {} },
    "../store.js": { SCHEMA_PATH: "schema", Store: class {
      constructor() { calls.push("Store"); } close() {} listAgents() { return []; } getAgent() { return null; }
    } },
    "../mail.js": { MailModule: class { constructor() { calls.push("Mail"); } } },
    "../units.js": { UNIT_TPL_DIR: "units", UnitsModule: class { constructor() { calls.push("Units"); } } },
    "../views.js": { ViewsModule: class {
      constructor() { calls.push("Views"); } refreshWorld() { calls.push("refresh"); }
    } },
    "../git.js": { GitModule: class {
      constructor() { calls.push("Git"); }
      hasCommittedContext() { if (observation.error) throw observation.error; return observation.value; }
    } },
    "../lifecycle.js": { LifecycleModule: class {
      constructor(_store, _units, options) { calls.push("Lifecycle"); paths.push(options); constructorGoal = options.hasGoal(); }
      async bootstrap() { calls.push("bootstrap"); }
    } },
    "../reconcile.js": { ReconcileModule: class {
      constructor(_store, _mail, _git, _units, _lifecycle, options) { calls.push("Reconcile"); paths.push(options); }
      async startup(activation, bootstrap) { assert.equal(activation, false); calls.push("recover"); await bootstrap(); }
      async sweep() { calls.push("activate"); }
    } },
    "../broker.js": { Broker: class {
      constructor(_store, _mail, _units, _views, _lifecycle, _git, _reconcile, options, _limits, _lock, principalSession) {
        calls.push("Broker"); paths.push({ ...options, principalSession });
      }
      async start() { calls.push("listen"); } notifyReady() { calls.push("notify"); return true; }
    } },
    "../git/integration-policy.js": { integrationPolicyFromConfig: value => value, snapshotIntegrationPolicy: value => value, assertSupportedIntegration() {} },
    "../config.js": { loadConfig: () => config },
    "../config/policy.js": { createChildSpecResolver: () => () => ({}) },
    "../runtime/process-lock.js": { ProcessLock: { acquire: () => ({}) } },
    "../runtime/broker-lifetime.js": { BrokerLifetime: class {
      permitsActivation = true;
      retainStore() {} attach() {}
      async shutdown() { calls.push("shutdown"); }
      async start(phases) { await phases.recover(); await phases.listen(); await phases.notify(); await phases.activate(); }
    } },
    // Deliberately controlled qualification gates: this is wiring proof, not a supported deployment profile.
    "../runtime/assets.js": { assertHostDirectoryLayout() {}, assertRuntimeAssets() {}, runtimeAssets: () => ({}) },
    "../runtime/deployment-manifest.js": { assertDeploymentDigest() { calls.push("digest"); } },
    "../storage/quota.js": { assertStorageQuotaAdmission() { calls.push("storage-quota"); } },
    "../authority.js": { resolvedSpecOf: value => value },
    "../domain/errors.js": { StoreError: class extends Error {} },
    "../ids.js": { isValidSocietyName: value => value === "fixture" },
    "../protocol/principal-credential.js": {
      PRINCIPAL_SESSION_ENV: "OMA_PRINCIPAL_SESSION",
      isPrincipalSessionHandle: value => typeof value === "string" && /^[0-9a-f]{32}$/.test(value),
    },
  };
  const process = { argv: ["node", "broker", "--society", "fixture"], env: { ...(environment ?? {}) }, exitCode: 0, once() {},
    exit(code) { throw new Error(`unexpected process.exit(${code})`); } };
  await new Script(executable, { filename: "broker-composition.cjs" }).runInNewContext({
    exports: {}, process, console: { error() {} }, require(name) {
      assert.ok(Object.hasOwn(modules, name), `uncontrolled dependency: ${name}`);
      return modules[name];
    },
  });
  assert.equal(process.exitCode, 0, "entrypoint must complete without the startup failure path");
  return { calls, paths, observation, constructorGoal };
}

test("P1 composition root: Git exists when Lifecycle receives its context reader", async () => {
  const result = await compose();
  assert.equal(result.constructorGoal, true);
  assert.ok(result.calls.indexOf("Git") < result.calls.indexOf("Lifecycle"));
  assert.ok(result.calls.indexOf("Lifecycle") < result.calls.indexOf("Reconcile"));
});

test("P1 composition root: all consumers share a live reader that preserves observation failure", async () => {
  const { paths, observation } = await compose();
  assert.equal(paths.length, 3);
  assert.ok(paths.every(options => options.hasGoal === paths[0].hasGoal));
  for (const value of [false, true]) {
    observation.value = value;
    assert.ok(paths.every(options => options.hasGoal() === value));
  }
  const error = new Error("unobservable context"); observation.error = error;
  for (const options of paths) assert.throws(() => options.hasGoal(), caught => caught === error);
});

test("P1 composition root: startup still wires recovery before listen, notify and activation", async () => {
  const { calls } = await compose();
  assert.deepEqual(calls.slice(calls.indexOf("recover")), ["recover", "bootstrap", "listen", "notify", "activate", "refresh"]);
  assert.equal(calls.filter(value => value === "Store").length, 1);
  assert.ok(calls.indexOf("digest") < calls.indexOf("storage-quota"));
  assert.ok(calls.indexOf("storage-quota") < calls.indexOf("Store"));
});

test("P1 composition root: a Principal endpoint exists only for a host that registered a session", async () => {
  // PR-001. The registration is what the broker is given, so this is the one
  // place that decides whether an endpoint exists at all -- a broker started by
  // systemd or by hand has no host to hand a credential to, and opening an
  // endpoint for nobody would be a surface with no legitimate caller.
  const unregistered = await compose();
  assert.equal(unregistered.paths.at(-1).principalSession, undefined);

  // A handle that is not one is not a registration: a malformed value must not
  // become an endpoint that accepts whatever spelling arrives.
  for (const bad of ["", "nothex", "a".repeat(31), "A".repeat(32), "a".repeat(64)])
    assert.equal((await compose({ OMA_PRINCIPAL_SESSION: bad })).paths.at(-1).principalSession, undefined);

  // A well-formed handle with no host channel attached is refused too. This
  // process is that case: its descriptor 3 is not a pipe a supervising host
  // opened. A registration inherited by a broker started another way would
  // otherwise write a credential into whatever that descriptor happens to be.
  assert.equal((await compose({ OMA_PRINCIPAL_SESSION: "a".repeat(32) })).paths.at(-1).principalSession, undefined);
  // The positive branch needs a real supervising parent, so it is proved where
  // one exists: society-bringup spawns a child over that channel and reads the
  // credential back, and principal-endpoint drives the registration directly.
});

test("P1 composition root: the host's credential channel is the kind of descriptor the broker requires", async () => {
  // The guard above admits a pipe. This asserts the supervisor actually opens
  // one, so the two halves cannot drift into a broker that always refuses.
  const probe = "const s = require('node:fs').fstatSync(3);" +
    "process.stdout.write(JSON.stringify({ pipe: s.isFIFO() || s.isSocket(), file: s.isFile(), tty: s.isCharacterDevice() }))";
  const child = spawn(process.execPath, ["-e", probe], { stdio: ["ignore", "pipe", "ignore", "pipe"] });
  let answer = "";
  child.stdout.on("data", chunk => { answer += String(chunk); });
  await once(child, "close");
  // Node gives a "pipe" child a socketpair rather than a FIFO, so the guard
  // accepts either. What it must never accept is a regular file or a terminal:
  // those are where an inherited registration would spill a credential.
  assert.deepEqual(JSON.parse(answer), { pipe: true, file: false, tty: false });
});
