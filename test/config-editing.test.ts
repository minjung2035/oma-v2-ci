import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfiguration } from "../src/config.js";
import { observeFile } from "./fixtures/effect-observation.js";
import { createCompleteConfigurationFixture } from "./fixtures/configuration.js";
import {
  INITIAL_WORKERS,
  WORKER_LIMIT,
  commitField,
  readSettings,
  writeSettings,
} from "../src/application/settings.js";

function filesBelow(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? filesBelow(join(root, entry.name))
        : [join(root, entry.name)],
    )
    .sort();
}

function snapshot(paths: readonly string[]) {
  return Object.fromEntries(paths.map((path) => [path, observeFile(path)]));
}


test("V11A: the inline compatibility writer validates before replacement", () => {
  const fixture = createCompleteConfigurationFixture();
  try {
    const before = observeFile(fixture.input);
    const invalid = {
      ...fixture.config,
      quota: { ...fixture.config.quota, societyAgents: -1 },
    };
    assert.throws(() => writeSettings(fixture.input, invalid), /quota\.societyAgents/);
    assert.deepEqual(observeFile(fixture.input), before);
    assert.doesNotThrow(() => loadConfiguration(fixture.input));
  } finally {
    fixture.close();
  }
});

for (const mode of ["inline", "split"] as const) {
  for (const [field, value, message] of [
    [WORKER_LIMIT, 3, /not editable|Unknown|unknown|unsupported/i],
    [INITIAL_WORKERS, -1, /non-negative|Invalid|invalid|integer/i],
  ] as const) {
    test(`V11A: invalid ${mode} ${field} edit is rejected before every authored file`, () => {
      const fixture = createCompleteConfigurationFixture();
      try {
        const path = mode === "inline" ? fixture.input : fixture.path;
        const files = mode === "inline" ? [fixture.input] : filesBelow(fixture.output);
        const before = snapshot(files);
        assert.throws(() => commitField(readSettings(path), field, value), message);
        assert.deepEqual(snapshot(files), before);
        assert.doesNotThrow(() => loadConfiguration(path));
      } finally {
        fixture.close();
      }
    });
  }
}
