import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { loadConfiguration, loadConfigurationSnapshot } from "../src/config.js";
import { configurationLayout } from "../src/config/operations.js";
import { readExtensions } from "../src/tui/sources/extensions.js";
import { createCompleteConfigurationFixture } from "./fixtures/configuration.js";

function readJson(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;
}

test("V12A: one snapshot uses one manifest even when the pointer is replaced after its read", () => {
  const fixture = createCompleteConfigurationFixture();
  try {
    const layout = configurationLayout(fixture.path);
    assert.equal(layout.kind, "operations");
    if (layout.kind !== "operations") return;
    const next = join(fixture.output, "next");
    mkdirSync(join(next, "roles"), { recursive: true });
    const nextHost = join(next, "host.json");
    const nextModels = join(next, "models.json");
    const host = readJson(layout.host);
    host.society = "next";
    writeFileSync(nextHost, JSON.stringify(host));
    copyFileSync(layout.models, nextModels);
    const nextRoles: Record<string, string> = {};
    for (const [name, oldPath] of Object.entries(layout.roles)) {
      const nextPath = join(next, "roles", `${name}.json`);
      copyFileSync(oldPath, nextPath);
      nextRoles[name] = relative(fixture.output, nextPath);
    }
    const nextManifest = {
      kind: "oma-operations-v1",
      host: relative(fixture.output, nextHost),
      models: relative(fixture.output, nextModels),
      roles: nextRoles,
    };
    let swaps = 0;
    const snapshot = loadConfigurationSnapshot(fixture.path, event => {
      assert.equal(event.phase, "manifest-read");
      swaps += 1;
      writeFileSync(fixture.path, JSON.stringify(nextManifest));
    });
    assert.equal(swaps, 1);
    assert.equal(snapshot.config.society, "demo");
    assert.equal(snapshot.layout.kind, "operations");
    assert.equal(snapshot.layout.kind === "operations" && snapshot.layout.host, layout.host);
    const extensions = readExtensions(snapshot, snapshot.config.principalProfile, "resident");
    assert.ok(extensions.roles.every(role => !role.path.includes(`${join("next", "roles")}`)));
    assert.equal(loadConfiguration(fixture.path).config.society, "next");
  } finally { fixture.close(); }
});

test("V12B: prompt references remain index-root relative and enter the bounded source closure", () => {
  const fixture = createCompleteConfigurationFixture();
  try {
    const snapshot = loadConfigurationSnapshot(fixture.path);
    assert.equal(snapshot.layout.kind, "operations");
    const principal = snapshot.authoredRoles.principal!;
    const promptFile = String(principal.value.promptFile);
    const expected = join(dirname(fixture.path), promptFile);
    assert.ok(snapshot.sourceFiles.some(file => file.path === expected));
    assert.equal(snapshot.roles.principal!.prompt, readFileSync(expected, "utf8"));
  } finally { fixture.close(); }
});

test("V12B: aggregate source bytes are bounded even when each referenced file is individually valid", () => {
  const fixture = createCompleteConfigurationFixture();
  try {
    const layout = configurationLayout(fixture.path);
    assert.equal(layout.kind, "operations");
    if (layout.kind !== "operations") return;
    const rolePath = layout.roles.resident!;
    const role = readJson(rolePath);
    const entries = [role.extensions[0] as string];
    const extensionDir = join(fixture.installation, "extensions");
    mkdirSync(extensionDir, { recursive: true });
    for (let index = 0; index < 9; index++) {
      const name = `large-${index}.js`;
      writeFileSync(join(extensionDir, name), Buffer.alloc(1024 * 1024, 0x61));
      entries.push(`extensions/${name}`);
    }
    role.extensions = entries;
    writeFileSync(rolePath, JSON.stringify(role));
    assert.throws(() => loadConfigurationSnapshot(fixture.path), { code: "LIMIT_EXCEEDED" });
  } finally { fixture.close(); }
});
