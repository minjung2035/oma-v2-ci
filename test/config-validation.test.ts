import test from "node:test";
import assert from "node:assert/strict";
import type { HostConfigV1 } from "../implementation/contracts.js";
import { createCompleteConfigurationFixture } from "./fixtures/configuration.js";

test("V11C: the pure validator returns a deep immutable snapshot with own-key maps", async () => {
  const fixture = createCompleteConfigurationFixture();
  try {
    const raw = structuredClone(fixture.config) as HostConfigV1;
    raw.modelProfiles["toString"] = {
      ...raw.modelProfiles.standard!,
      model: "prototype-sensitive",
    };
    raw.agentProfiles.resident!.modelProfile = "toString";
    const module = (await import("../src/config.js")) as typeof import("../src/config.js") & {
      validateConfig?: (value: unknown) => HostConfigV1;
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
      (validated.initialResidents as HostConfigV1["initialResidents"]).push({
        name: "later",
        profile: "resident",
        brief: "later",
      });
    }, TypeError);
  } finally {
    fixture.close();
  }
});
