import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import type { HostConfig } from "@oma/contracts";
import { Store } from "@oma/storage";
import { makeValidAgent } from "./fixtures/spec.js";
import { makeValidOperation } from "./fixtures/valid.js";
import { createCompleteConfigurationFixture } from "./fixtures/configuration.js";
import {
  WORKER_MODEL,
  WORKER_PROFILE,
  applyField,
  commitField,
  readSettings,
  settingsOf,
} from "#oma-test/app/application/settings";

test("V11C: the pure validator returns a deep immutable snapshot with own-key maps", async () => {
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

test("V11C: zero bootstrap seeds expose no editable profile target", () => {
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

test("V11C: config edits do not rewrite accepted Store identities or frozen specs", () => {
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
