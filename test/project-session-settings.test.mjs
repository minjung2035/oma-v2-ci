import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import ts from "typescript";

function fixture() {
  let current = { config: { principalProfile: "one" }, workerProfile: "one" };
  let project = { snapshot: "one" }, failed = false;
  const notices = [];
  const deps = {
    "../runtime/deployment-manifest.js": { deploymentDigest: () => "digest" },
    "../runtime/packages/index.js": { readPackageIndex: () => [] },
    "../runtime/user-files.js": { readUserFile: () => project.snapshot },
    "@oma/config/operations": { CONFIGURATION_DOCUMENT_BYTES: 1024 },
    "@oma/domain/errors": { exceptionText: error => error.message },
    "./extensions.js": { readExtensions: source => { if (failed) throw new Error("extensions unreadable"); return { source }; } },
    "./settings.js": { projectSettingsPath: () => "/project/settings", readSettings: () => current,
      readSettingsForEditing: () => project, deriveSessionSettings: () => ({ settings: current, missing: [] }) },
    "./project-settings.js": { ensureProjectSettings: () => project },
  };
  const output = { exports: {} };
  const code = ts.transpileModule(readFileSync("apps/oma/src/application/project-session-settings.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Script(code).runInNewContext({ module: output, exports: output.exports, Object,
    require(name) { assert.ok(Object.hasOwn(deps, name)); return deps[name]; } });
  const view = new output.exports.ProjectSessionSettings({ dataRoot: "/state", project: "p", libdir: "/lib", configPath: "/config",
    packageStore: "/packages", externalConfig: false, own: () => ({}), owns: () => true, assertWritable() {}, notice: text => notices.push(text) });
  return { view, notices, next() { current = { config: { principalProfile: "two" }, workerProfile: "two" }; project = { snapshot: "two" }; },
    fail(value) { failed = value; } };
}
test("DR40: Settings read-back publishes the complete view only after extensions were observed", () => {
  const f = fixture(), before = [f.view.settings, f.view.projectSettings, f.view.extensions, f.view.leftOut];
  f.next(); f.fail(true);
  assert.equal(f.view.readBack(), false);
  assert.equal(f.view.unread, "extensions unreadable");
  assert.deepEqual([f.view.settings, f.view.projectSettings, f.view.extensions, f.view.leftOut], before);
  f.fail(false);
  assert.equal(f.view.readBack(), true);
  assert.equal(f.view.settings.config.principalProfile, "two");
  assert.equal(f.view.projectSettings.snapshot, "two");
  assert.equal(f.view.extensions.source, "two");
  assert.equal(f.view.unread, null);
});
test("DR40: Failed derivation keeps the prior snapshot and reports the saved-next-start meaning once", () => {
  const f = fixture(), before = f.view.settings;
  f.next(); f.fail(true);
  assert.equal(f.view.rederive(), false); assert.equal(f.view.rederive(), false);
  assert.equal(f.view.settings, before); assert.equal(f.view.changed(), true);
  assert.equal(f.notices.length, 1); assert.match(f.notices[0], /Saved for the project/);
  f.fail(false); assert.equal(f.view.rederive(), true); assert.equal(f.view.changed(), false);
});
