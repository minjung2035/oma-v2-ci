import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { Script } from "node:vm";
import ts from "typescript";

/** Run the actual entrypoint with controlled module boundaries, without host I/O.
 * This checks composition and phase wiring, not real systemd/recovery behavior.
 */
async function compose() {
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
    "node:fs": { mkdirSync() {} },
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
      constructor(_store, _mail, _units, _views, _lifecycle, _git, _reconcile, options) { calls.push("Broker"); paths.push(options); }
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
  };
  const process = { argv: ["node", "broker", "--society", "fixture"], env: {}, exitCode: 0, once() {},
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
