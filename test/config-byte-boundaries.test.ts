/** Config publication and reopening, with independent UTF-8 boundary values. */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HostConfig } from "@oma/contracts";
import { parseRequestKey } from "@oma/domain/identifiers";
import { readSettings, writeSettings } from "#oma-test/app/application/settings";
import { createCompleteConfigurationFixture } from "./fixtures/configuration.js";

function payload(unit: string, bytes: number): string {
  const prefix = unit.repeat(Math.floor((bytes - 1) / Buffer.byteLength(unit)));
  const value = prefix + "x".repeat(bytes - Buffer.byteLength(prefix));
  assert.equal(Buffer.byteLength(value), bytes);
  return value;
}
function recovery(key: string, brief: string) {
  return { version: 1 as const, key, name: "recovered", profile: "resident", brief };
}
function publication(t: TestContext, value: string, allowed: boolean,
  change: (config: HostConfig) => void, read: (config: HostConfig) => string, policyOnly = false): void {
  const f = createCompleteConfigurationFixture();
  t.after(() => f.close());
  const candidate = structuredClone(f.config), before = readFileSync(f.input), names = readdirSync(f.root).sort();
  change(candidate);
  if (allowed) {
    if (policyOnly) {
      const authored = join(f.root, "authored-policy.json");
      writeFileSync(authored, JSON.stringify(candidate));
      assert.equal(read(readSettings(authored).config), value, "an imported revision retains its exact Unicode spelling");
      // The settings editor derives revisions from meaning. Changing only an
      // imported revision is a no-op, not permission to rewrite the old fact.
      writeSettings(f.input, candidate);
      assert.deepEqual(readFileSync(f.input), before);
    } else {
      writeSettings(f.input, candidate);
      assert.equal(read(readSettings(f.input).config), value, "a committed setting must reopen with its exact Unicode spelling");
    }
  } else {
    assert.throws(() => writeSettings(f.input, candidate), { code: "INVALID_REQUEST" });
    assert.deepEqual(readFileSync(f.input), before, "a refused setting cannot replace the committed bytes");
    assert.deepEqual(readdirSync(f.root).sort(), names, "validation must not leave a generation, staging file or lock");
    assert.doesNotThrow(() => readSettings(f.input), "the previous configuration must remain runnable");
  }
}

for (const [encoding, unit] of [["ASCII", "a"], ["Hangul", "한"], ["emoji", "😀"], ["combining", "e\u0301"]] as const) {
  for (const delta of [-1, 0, 1]) test(`001. Policy revision ${encoding}: 128-byte bound ${delta >= 0 ? "+" : ""}${delta} survives or preserves publication`, t => {
    const value = payload(unit, 128 + delta);
    publication(t, value, delta <= 0, config => { config.integration.policyRevision = value; }, config => config.integration.policyRevision, true);
  });
}
for (const scope of ["bootstrap", "recovery"] as const) {
  for (const [encoding, unit] of [["emoji", "😀"], ["combining", "e\u0301"]] as const) {
    for (const delta of [-1, 0, 1]) test(`002. ${scope} brief ${encoding}: 8192-byte bound ${delta >= 0 ? "+" : ""}${delta}`, t => {
      const value = payload(unit, 8192 + delta);
      publication(t, value, delta <= 0, config => {
        if (scope === "bootstrap") config.initialResidents[0]!.brief = value;
        else { config.schemaVersion = 5; config.firstWorkerRecovery = recovery("recover", value); }
      }, config => scope === "bootstrap" ? config.initialResidents[0]!.brief : config.firstWorkerRecovery!.brief);
    });
  }
}
for (const length of [0, 1, 81, 82, 83, 96]) test(`003. Recovery key length ${length} counts the actual operation prefix before publication`, t => {
  const value = "r".repeat(length), allowed = length >= 1 && length <= 82;
  publication(t, value, allowed, config => {
    config.schemaVersion = 5; config.firstWorkerRecovery = recovery(value, "recover");
  }, config => config.firstWorkerRecovery!.key);
  if (allowed) assert.notEqual(parseRequestKey(`recover-first-${value}`), null);
});
