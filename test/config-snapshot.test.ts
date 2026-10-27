import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { loadConfiguration, loadConfigurationSnapshot } from "@oma/config";
import { configurationLayout } from "@oma/config/operations";
import { readExtensions } from "#oma-test/app/application/extensions";
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
      if (event.phase !== "manifest-read") return;
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
    const manifest = readJson(fixture.path);
    const role = readJson(layout.roles.resident!);
    const add = (name: string, size: number): void => {
      const prompt = `prompts/${name}.md`;
      writeFileSync(join(fixture.output, prompt), Buffer.alloc(size, 0x61));
      writeFileSync(join(fixture.output, `roles/${name}.json`), JSON.stringify({ ...role, promptFile: prompt }));
      manifest.roles[name] = `roles/${name}.json`;
    };
    // The old aggregate bound was 8 MiB of documents; nine MiB-sized prompts
    // used to refuse. The closure's working bound is generous now -- the
    // same source loads.
    for (let index = 0; index < 9; index++) add(`extra-${index}`, 1024 * 1024);
    writeFileSync(fixture.path, JSON.stringify(manifest));
    assert.equal(loadConfigurationSnapshot(fixture.path).config.society, "demo",
      "fail-before: the 8 MiB aggregate refused this source outright");
    // And the bound that remains still binds: over 64 MiB of whole-read
    // documents is refused, whatever each file's own validity.
    for (let index = 0; index < 5; index++) add(`large-${index}`, 13 * 1024 * 1024);
    writeFileSync(fixture.path, JSON.stringify(manifest));
    assert.throws(() => loadConfigurationSnapshot(fixture.path), { code: "LIMIT_EXCEEDED" });
  } finally { fixture.close(); }
});

test("V12B: one configuration file over the document bound is refused even though the whole source would fit", () => {
  const fixture = createCompleteConfigurationFixture();
  try {
    const layout = configurationLayout(fixture.path);
    assert.equal(layout.kind, "operations");
    if (layout.kind !== "operations") return;
    // Valid JSON, 1.5 MiB of it: the old 1 MiB per-file bound refused this;
    // a whole-read document is bounded generously instead.
    const host = readJson(layout.host);
    writeFileSync(layout.host, `${JSON.stringify(host)}${" ".repeat(1536 * 1024)}`);
    assert.equal(loadConfigurationSnapshot(fixture.path).config.society, "demo",
      "fail-before: the 1 MiB per-file bound refused this document");
    writeFileSync(layout.host, `${JSON.stringify(host)}${" ".repeat(17 * 1024 * 1024)}`);
    assert.throws(() => loadConfigurationSnapshot(fixture.path), { code: "INVALID_REQUEST", message: /at most 16 MiB/ });
  } finally { fixture.close(); }
});

test("V12A: a file changed after the snapshot read it, before the snapshot completes, fails the snapshot", () => {
  const fixture = createCompleteConfigurationFixture();
  try {
    const layout = configurationLayout(fixture.path);
    assert.equal(layout.kind, "operations");
    if (layout.kind !== "operations") return;
    const roles = new Set(Object.values(layout.roles));
    let changed = false;
    // When a role file is read, the host file -- read earlier -- changes.
    assert.throws(() => loadConfigurationSnapshot(fixture.path, event => {
      if (changed || event.phase !== "source-read" || !roles.has(event.path)) return;
      changed = true;
      writeFileSync(layout.host, `${readFileSync(layout.host, "utf8")} `);
    }), { code: "INVALID_REQUEST", message: /changed before snapshot completion/ });
    assert.equal(changed, true, "the snapshot never read a role file after the host file");
    // Without interference the same source reads cleanly.
    assert.equal(loadConfigurationSnapshot(fixture.path).config.society, "demo");
  } finally { fixture.close(); }
});
