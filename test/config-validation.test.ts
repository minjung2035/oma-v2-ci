import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { existsSync, writeFileSync } from "node:fs";
import type { HostConfig } from "@oma/contracts";
import { StoreError } from "@oma/domain/errors";
import { Store } from "@oma/storage";
import { makeValidAgent } from "./fixtures/spec.js";
import { makeValidOperation } from "./fixtures/valid.js";
import { createCompleteConfigurationFixture } from "./fixtures/configuration.js";
import { runtimeAssets } from "#oma-test/app/runtime/assets";
import {
  WORKER_MODEL,
  WORKER_PROFILE,
  applyField,
  commitField,
  readSettings,
  settingsOf,
  writeSettings,
} from "#oma-test/app/application/settings";

test("001. The pure validator returns a deep immutable snapshot with own-key maps", async () => {
  const fixture = createCompleteConfigurationFixture();
  try {
    const raw = structuredClone(fixture.config) as HostConfig;
    raw.modelProfiles["toString"] = {
      ...raw.modelProfiles.standard!,
      model: "prototype-sensitive",
    };
    raw.agentProfiles.resident!.modelProfile = "toString";
    const module = (await import("@oma/config")) as typeof import("@oma/config") & {
      validateConfig?: (value: unknown) => HostConfig;
    };
    assert.equal(typeof module.validateConfig, "function", "pure config validator is not exported");
    const validated = module.validateConfig!(raw);

    assert.equal(Object.getPrototypeOf(validated.modelProfiles), null);
    assert.equal(Object.getPrototypeOf(validated.agentProfiles), null);
    assert.equal(validated.agentProfiles.resident!.modelProfile, "toString");
    assert.equal(validated.modelProfiles["toString"]!.model, "prototype-sensitive");
    assert.ok(Object.isFrozen(validated));
    assert.ok(Object.isFrozen(validated.initialResidents));
    assert.ok(Object.isFrozen(validated.initialResidents[0]!));
    assert.ok(Object.isFrozen(validated.agentProfiles.resident!.capabilities));
    assert.ok(Object.isFrozen(validated.integration.checks));

    raw.initialResidents[0]!.name = "mutated";
    raw.agentProfiles.resident!.capabilities.push("git.submit");
    raw.modelProfiles["toString"]!.model = "mutated";
    assert.equal(validated.initialResidents[0]!.name, "worker");
    assert.deepEqual(validated.agentProfiles.resident!.capabilities, []);
    assert.equal(validated.modelProfiles["toString"]!.model, "prototype-sensitive");
    assert.throws(() => {
      (validated.initialResidents as HostConfig["initialResidents"]).push({
        name: "later",
        profile: "resident",
        brief: "later",
      });
    }, TypeError);
  } finally {
    fixture.close();
  }
});

test("002. Zero bootstrap seeds expose no editable profile target", () => {
  const fixture = createCompleteConfigurationFixture();
  try {
    const config = { ...fixture.config, initialResidents: [] };
    const settings = settingsOf(fixture.input, config);
    // D05/WP15: the field is shown blocked with its reason, never offered as a target.
    const field = settings.fields.find(entry => entry.id === WORKER_PROFILE);
    assert.ok(field && field.kind !== "link" && typeof field.blocked === "string" && field.blocked.length > 0);
    assert.throws(() => applyField(settings, WORKER_PROFILE, "resident"), /no bootstrap workers/);
    assert.throws(() => applyField(settings, "toString", 1), /unknown settings field/);
  } finally {
    fixture.close();
  }
});

test("003. Config edits do not rewrite accepted Store identities or frozen specs", () => {
  const fixture = createCompleteConfigurationFixture();
  // This is a Worker-only edit: use a reference not shared with Principal.
  const config = structuredClone(fixture.config);
  config.modelProfiles["principal-only"] = { ...config.modelProfiles.standard! };
  config.agentProfiles.principal!.modelProfile = "principal-only";
  writeFileSync(fixture.input, JSON.stringify(config));
  const store = new Store(join(fixture.root, "runtime.sqlite"));
  try {
    const agent = makeValidAgent("alice");
    const operation = makeValidOperation({
      stateRoot: fixture.root,
      actor: "alice",
      requestKey: "v11-frozen",
    });
    store.transaction(() => {
      store.insertAgent(agent);
      store.insertOperation(operation);
    });
    const beforeAgent = store.getAgent("alice")!;
    const beforeOperation = store.getOperationById(operation.id)!;
    commitField(readSettings(fixture.input), WORKER_MODEL, "review");
    const afterAgent = store.getAgent("alice")!;
    const afterOperation = store.getOperationById(operation.id)!;
    assert.equal(afterAgent.specHash, beforeAgent.specHash);
    assert.equal(afterAgent.specJson, beforeAgent.specJson);
    assert.equal(afterOperation.requestHash, beforeOperation.requestHash);
    assert.equal(afterOperation.planJson, beforeOperation.planJson);
  } finally {
    store.close();
    fixture.close();
  }
});


test("004. Storage config v5 preserves explicit on-close and freezes the validated value",async()=>{
  const f=createCompleteConfigurationFixture();try{
    const {validateConfig}=await import("@oma/config");
    const raw={...structuredClone(f.config),schemaVersion:5,storage:{closeMode:"on-close"}};
    const config=validateConfig(raw);assert.equal(config.storage?.closeMode,"on-close");assert.equal(Object.isFrozen(config.storage),true);
    assert.equal(validateConfig({...raw,storage:{closeMode:"keep-hot"}}).storage?.closeMode,"keep-hot");
    assert.throws(()=>validateConfig({...raw,storage:{closeMode:"silent-eviction"}}));
    assert.throws(()=>validateConfig({...raw,storage:{closeMode:"keep-hot",background:true}}));
    assert.throws(()=>validateConfig({...raw,schemaVersion:4}));
  }finally{f.close();}
});

test("005. The configuration owner never writes an installation root its consumers refuse", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const relative = { ...f.config, installation: { ...f.config.installation, libdir: "opt/oma" } };
    // runtime/assets.ts is the consumer of this field on the runtime side
    // (assertRuntimeAssets runs before the broker opens its Store): the root it
    // refuses must not be committed into a settings file by the config owner.
    assert.throws(() => runtimeAssets(relative.installation.libdir), { code: "UNSUPPORTED_PROFILE" });
    assert.throws(() => runtimeAssets("/"), { code: "UNSUPPORTED_PROFILE" });
    const target = join(f.root, "refused.json");
    assert.throws(() => writeSettings(target, relative),
      (error: unknown) => error instanceof StoreError && error.code === "INVALID_REQUEST" &&
        error.message.includes("installation.libdir"));
    assert.equal(existsSync(target), false, "a refused installation root still created a configuration file");
  } finally {
    f.close();
  }
});

test("006. The installation's own spelling is written and read back unchanged", () => {
  const f = createCompleteConfigurationFixture();
  try {
    // The product writes a session's own installation as `${libdir}/`
    // (application/society-bootstrap.ts SessionOwn): that spelling must stay a
    // valid, preserved configuration value.
    const libdir = `${f.config.installation.libdir}/`;
    const target = join(f.root, "own-installation.json");
    const written = writeSettings(target, { ...f.config, installation: { ...f.config.installation, libdir } });
    assert.equal(written.installation.libdir, libdir);
    assert.equal(readSettings(target).config.installation.libdir, libdir);
  } finally {
    f.close();
  }
});

test("007. Config policy revisions obey the durable identity byte and control-character grammar", async () => {
  const f = createCompleteConfigurationFixture();
  try {
    const { validateConfig } = await import("@oma/config");
    for (const revision of ["a".repeat(128), "한".repeat(42)])
      assert.equal(validateConfig({ ...f.config, integration: { ...f.config.integration, policyRevision: revision } }).integration.policyRevision, revision);
    for (const revision of ["a".repeat(129), "한".repeat(43), "revision\n", "revision\u200b", "revision\ud800"])
      assert.throws(() => writeSettings(join(f.root, "invalid-revision.json"), {
        ...f.config, integration: { ...f.config.integration, policyRevision: revision },
      }), { code: "INVALID_REQUEST" });
    assert.equal(existsSync(join(f.root, "invalid-revision.json")), false);
  } finally { f.close(); }
});

test("008. Config recovery keys include the host prefix in the operation-key bound", async () => {
  const f = createCompleteConfigurationFixture();
  try {
    const { validateConfig } = await import("@oma/config");
    const recovery = { version: 1 as const, key: "r".repeat(82), name: "recovered", profile: "resident", brief: "recover the first Worker" };
    const config = { ...f.config, schemaVersion: 5 as const, firstWorkerRecovery: recovery };
    assert.equal(validateConfig(config).firstWorkerRecovery?.key, recovery.key);
    for (const size of [83, 96]) assert.throws(() => writeSettings(join(f.root, "invalid-recovery.json"), {
      ...config, firstWorkerRecovery: { ...recovery, key: "r".repeat(size) },
    }), { code: "INVALID_REQUEST" });
    assert.equal(existsSync(join(f.root, "invalid-recovery.json")), false);
  } finally { f.close(); }
});

test("009. Config bootstrap and recovery briefs fit their actual creation payload", async () => {
  const f = createCompleteConfigurationFixture();
  try {
    const { validateConfig } = await import("@oma/config");
    const seed = f.config.initialResidents[0]!;
    assert.equal(validateConfig({ ...f.config, initialResidents: [{ ...seed, brief: "x".repeat(8192) }] }).initialResidents[0]!.brief.length, 8192);
    for (const brief of ["x".repeat(8193), "한".repeat(2731)]) {
      assert.throws(() => writeSettings(join(f.root, "invalid-brief.json"), { ...f.config, initialResidents: [{ ...seed, brief }] }), { code: "INVALID_REQUEST" });
      assert.throws(() => writeSettings(join(f.root, "invalid-recovery-brief.json"), { ...f.config, schemaVersion: 5,
        firstWorkerRecovery: { version: 1, key: "recovery", name: "recovered", profile: "resident", brief } }), { code: "INVALID_REQUEST" });
    }
    assert.equal(existsSync(join(f.root, "invalid-brief.json")), false);
    assert.equal(existsSync(join(f.root, "invalid-recovery-brief.json")), false);
  } finally { f.close(); }
});

test("010. Config role names use the operations-loader grammar before publication", () => {
  const f = createCompleteConfigurationFixture();
  try {
    for (const name of ["Principal", "worker two", "2worker", "a".repeat(33), "principal!"])
      assert.throws(() => writeSettings(join(f.root, "invalid-role.json"), { ...f.config,
        agentProfiles: { ...f.config.agentProfiles, [name]: f.config.agentProfiles.resident! },
      }), { code: "INVALID_REQUEST" });
    assert.equal(existsSync(join(f.root, "invalid-role.json")), false);
  } finally { f.close(); }
});

test("011. Config checks reject commands and environments the executor cannot serve", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const invalid = [
      [{ id: "check", argv: [], env: {} }], [{ id: "check", argv: [""], env: {} }],
      [{ id: "check", argv: ["/usr/bin/true", "\0"], env: {} }],
      [{ id: "check", argv: ["/usr/bin/true"], env: { "bad=key": "value" } }],
      [{ id: "check", argv: ["/usr/bin/true"], env: { "bad-key": "value" } }],
      [{ id: "check", argv: ["/usr/bin/true"], env: { KEY: "\0" } }],
      [{ id: "same", argv: ["/usr/bin/true"], env: {} }, { id: "same", argv: ["/usr/bin/false"], env: {} }],
    ];
    for (const checks of invalid) assert.throws(() => writeSettings(join(f.root, "invalid-check.json"), {
      ...f.config, integration: { ...f.config.integration, checks },
    }), { code: "INVALID_REQUEST" });
    assert.equal(existsSync(join(f.root, "invalid-check.json")), false);
  } finally { f.close(); }
});
