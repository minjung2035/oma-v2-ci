import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { EXPLORATION_PARAMETERS, extractExplorationParameters } from "../scripts/exploration-parameters.mjs";
import { lanes, evaluateExecution } from "../scripts/verification-lanes.mjs";

test("R36 exploration parameters are finite, explicit, reproducible and separate from production configuration", () => {
  assert.deepEqual(extractExplorationParameters(["--out", "result", "--seed", "0", "--actions", "64", "--baseline", "prior.json"]), {
    remaining: ["--out", "result", "--baseline", "prior.json"], env: { OMA_TEST_SEED: "0", OMA_TEST_ACTIONS: "64" }, parameters: { "--seed": 0, "--actions": 64 },
  });
  assert.equal(extractExplorationParameters(["--seed", "4294967295"]).env.OMA_TEST_SEED, "4294967295");
  for (const args of [["--seed"], ["--seed", "-1"], ["--seed", "4294967296"], ["--seed", "1.5"], ["--seed", "NaN"],
    ["--seed", "01"], ["--actions", "0"], ["--stress-seconds", "0"], ["--rss-bytes", "Infinity"], ["--seed", "1", "--seed", "2"]])
    assert.throws(() => extractExplorationParameters(args));
  for (const [flag, definition] of Object.entries(EXPLORATION_PARAMETERS)) {
    const parsed = extractExplorationParameters([flag, String(definition.max)]);
    assert.equal(parsed.env[definition.env], String(definition.max));
    assert.ok(definition.env.startsWith("OMA_TEST_"));
    assert.equal(Object.keys(parsed.env).length, 1, "no unrequested environment inheritance");
  }
});

test("R36 all registered exploration entries exist and old kernel/crash/property/stress gates remain", () => {
  const required = {
    property: ["verification-property.test.js", "r36-model.test.js", "r36-model-mutations.test.js", "r36-parser-fuzz.test.js"],
    stress: ["verification-stress.test.js", "r36-resource-stress.test.js"],
    crash: ["crash-boundaries.test.js", "global-invariants.test.js"],
    kernel: ["peer-pid.test.js", "native-leaf.test.js", "runner-channel.test.js", "audit.test.js", "audit2.test.js"],
  };
  for (const [name, files] of Object.entries(required)) for (const file of files) {
    assert.ok(lanes[name].files.includes(file), `${name} omitted an existing or newly registered oracle: ${file}`);
    assert.ok(existsSync(new URL(file.replace(/\.js$/, ".ts"), import.meta.url)), `source entry is missing: ${file}`);
  }
  for (const lane of Object.values(lanes)) for (const file of lane.sourceFiles)
    assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), `source-only verification entry missing: ${file}`);
  assert.ok(lanes.crash.requiredNames.includes("R33 existing SIGKILL"));
  assert.ok(lanes.kernel.requiredNames.includes("AUTH-003 native"));
});

test("R36 zero failures or a recorded seed cannot replace actual oracle execution", () => {
  const tap = "TAP version 13\nok 1 - unrelated\n1..1\n# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n";
  const result = evaluateExecution({ exitCode: 0, tap, requiredNames: ["R36 model seed=", "R36 parser corpus"] });
  assert.equal(result.status, "FAIL");
  assert.ok(result.errors.includes("critical-oracle-not-executed:R36 model seed="));
  assert.equal(evaluateExecution({ exitCode: 0, tap: "", requiredNames: [] }).status, "FAIL");
});
