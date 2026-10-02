/** Personal choices share extension validation, never the Principal/Worker writer. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { updatePersonalSettings, updatePersonalSettingsAsync, readPersonalSettings, personalExtensions, reconcilePersonalSettings } from "../src/runtime/personal-settings.js";
import { assertExtensionIntegrity } from "../src/runtime/extension-integrity.js";
import { ProcessLock } from "../src/runtime/process-lock.js";
import { DEPLOYMENT_LAYOUT } from "../src/domain/deployment.js";
import { PACKAGE_INDEX } from "../src/runtime/pi-packages.js";

function fixture(t: { after(run: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), "oma-personal-settings-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const location = { dataRoot: join(root, "data"), libdir: join(root, "lib"), packages: join(root, "packages") };
  mkdirSync(join(location.libdir, "extensions"), { recursive: true }); mkdirSync(location.packages);
  writeFileSync(join(location.libdir, "extensions", "user.js"), "export default () => {};\n");
  const packageEntry = "packages:extension.js";
  writeFileSync(join(location.packages, "extension.js"), "export default () => {};\n");
  const index = (entries: readonly string[]) => writeFileSync(join(location.packages, PACKAGE_INDEX), JSON.stringify([
    { source: "npm:fixture", entries },
  ]));
  index([packageEntry]);
  return { ...location, root, packageEntry, index };
}

test("DR29/P0-4: an async first-choice observation keeps the settings writer and commits once", async t => {
  const location = fixture(t);
  let finish!: (entries: readonly string[]) => void;
  const pending = updatePersonalSettingsAsync(location, () => new Promise(resolve => { finish = resolve; }));
  assert.equal(readPersonalSettings(location.dataRoot), null);
  assert.throws(() => updatePersonalSettings(location, ["extensions/other.js"]), { code: "BROKER_UNAVAILABLE" });
  await assert.rejects(updatePersonalSettingsAsync(location, async () => []), { code: "BROKER_UNAVAILABLE" });
  finish(["extensions/a.js"]);
  assert.deepEqual((await pending).extensions, ["extensions/a.js"]);
  const next = await updatePersonalSettingsAsync(location, async () => { throw new Error("must not observe old project"); });
  assert.deepEqual(next.extensions, ["extensions/a.js"]);
});

test("DR29/P0-5: a failed async project observation consumes no first choice and returns its writer", async t => {
  const location = fixture(t);
  const problem = new Error("project unobserved");
  await assert.rejects(updatePersonalSettingsAsync(location, async () => { throw problem; }), value => value === problem);
  assert.equal(readPersonalSettings(location.dataRoot), null);
  assert.deepEqual((await updatePersonalSettingsAsync(location, async () => ["extensions/a.js"])).extensions, ["extensions/a.js"]);
});
test("Personal settings: explicit user extensions seed once and the Society core never follows", t => {
  const w = fixture(t);
  const path = join(w.dataRoot, ".projects", "demo"); mkdirSync(path, { recursive: true });
  const roles = join(path, "role.json"); writeFileSync(roles, "unaltered Principal and Worker settings\n");
  assert.doesNotThrow(() => updatePersonalSettings(w, [DEPLOYMENT_LAYOUT.extension, "extensions/user.js", w.packageEntry]));
  const first = readPersonalSettings(w.dataRoot); assert.ok(first, "initial choices are saved");
  assert.deepEqual(first.extensions, ["extensions/user.js", w.packageEntry]);
  const second = updatePersonalSettings(w, ["extensions/different.js"]);
  assert.deepEqual(second, first); assert.deepEqual(readPersonalSettings(w.dataRoot), first);
  const off = updatePersonalSettings(w, [], { entry: w.packageEntry, enabled: false });
  assert.equal(off.revision, first.revision + 1); assert.deepEqual(off.extensions, ["extensions/user.js"]);
  assert.equal(readFileSync(roles, "utf8"), "unaltered Principal and Worker settings\n");
});
test("Personal settings: a package command preserves the first-project seed and reconciles only existing choices", t => {
  const w = fixture(t);
  assert.equal(reconcilePersonalSettings(w), null);
  assert.equal(readPersonalSettings(w.dataRoot), null);
  const seeded = updatePersonalSettings(w, [w.packageEntry]);
  assert.deepEqual(seeded.extensions, [w.packageEntry]);
  writeFileSync(join(w.packages, "next.js"), "export default () => {};\n");
  w.index(["packages:next.js"]);
  assert.deepEqual(reconcilePersonalSettings(w)?.extensions, ["packages:next.js"]);
  writeFileSync(join(w.packages, PACKAGE_INDEX), "[]");
  assert.deepEqual(reconcilePersonalSettings(w)?.extensions, []);
  assert.deepEqual(readPersonalSettings(w.dataRoot)?.extensions, []);
});
test("Personal settings: first project choice is observed inside the one writer lock", t => {
  const w = fixture(t); let observations = 0;
  const first = updatePersonalSettings(w, () => {
    observations++;
    const contender = ProcessLock.tryAcquire(join(w.dataRoot, ".personal/settings.lock"));
    try { assert.equal(contender, null, "the first seed must belong to the committing writer"); }
    finally { contender?.close(); }
    assert.equal(readPersonalSettings(w.dataRoot), null);
    return [DEPLOYMENT_LAYOUT.extension, w.packageEntry];
  });
  assert.equal(observations, 1); assert.deepEqual(first.extensions, [w.packageEntry]);
  let laterObservations = 0;
  const next = updatePersonalSettings(w, () => { laterObservations++; return []; });
  assert.equal(laterObservations, 0, "the old project must not be read");
  assert.deepEqual(next, first);
});
test("Personal settings: failed first project observation consumes no choice and returns the writer", t => {
  const w = fixture(t), problem = new Error("project selection is unobserved");
  assert.throws(() => updatePersonalSettings(w, () => { throw problem; }), error => error === problem);
  assert.equal(readPersonalSettings(w.dataRoot), null);
  const retry = updatePersonalSettings(w, () => [w.packageEntry]);
  assert.equal(retry.revision, 1); assert.deepEqual(retry.extensions, [w.packageEntry]);
});
test("Personal settings: contention and malformed saved choices do not observe a first seed", t => {
  const w = fixture(t); updatePersonalSettings(w);
  const lock = ProcessLock.tryAcquire(join(w.dataRoot, ".personal/settings.lock")); assert.ok(lock);
  let observations = 0;
  const seed = () => { observations++; return [w.packageEntry]; };
  try { assert.throws(() => updatePersonalSettings(w, seed), { code: "BROKER_UNAVAILABLE" }); }
  finally { lock.close(); }
  const file = join(w.dataRoot, ".personal/settings.json"); writeFileSync(file, "broken");
  assert.throws(() => updatePersonalSettings(w, seed), { code: "STORE_CORRUPT" });
  assert.equal(observations, 0); assert.equal(readFileSync(file, "utf8"), "broken");
});
test("Personal settings: separate edits read current choices instead of overwriting a stale screen", t => {
  const w = fixture(t); updatePersonalSettings(w);
  const a = updatePersonalSettings(w, [], { entry: w.packageEntry, enabled: true });
  const b = updatePersonalSettings(w, [], { entry: "extensions/user.js", enabled: true });
  assert.equal(b.revision, a.revision + 1); assert.deepEqual(b.extensions, [w.packageEntry, "extensions/user.js"]);
  assert.deepEqual(updatePersonalSettings(w, [], { entry: "extensions/user.js", enabled: true }), b);
});
test("Personal settings: update preserves disabled entries and removal cannot resurrect them on restart", t => {
  const w = fixture(t); updatePersonalSettings(w, [w.packageEntry]);
  writeFileSync(join(w.packages, "next.js"), "export default () => {};\n");
  w.index(["packages:next.js"]);
  assert.deepEqual(updatePersonalSettings(w).extensions, ["packages:next.js"]);
  updatePersonalSettings(w, [], { entry: "packages:next.js", enabled: false });
  w.index([w.packageEntry]); assert.deepEqual(updatePersonalSettings(w).extensions, []);
  updatePersonalSettings(w, [], { entry: w.packageEntry, enabled: true });
  writeFileSync(join(w.packages, PACKAGE_INDEX), "[]");
  assert.deepEqual(updatePersonalSettings(w).extensions, []);
  assert.deepEqual(readPersonalSettings(w.dataRoot)?.extensions, []);
});
test("Personal settings: missing assets are reported; changed pinned code is refused before loading", t => {
  const w = fixture(t), settings = updatePersonalSettings(w, ["extensions/user.js", "extensions/missing.js"]);
  const selected = personalExtensions(w, settings);
  assert.deepEqual(selected.missing, ["extensions/missing.js"]); assert.equal(selected.extensions.length, 1);
  assertExtensionIntegrity(selected.extensions);
  writeFileSync(join(w.libdir, "extensions/user.js"), "export default () => { throw 1 };\n");
  assert.throws(() => assertExtensionIntegrity(selected.extensions), { code: "UNSUPPORTED_PROFILE" });
  assert.throws(() => updatePersonalSettings(w, [], { entry: "extensions/missing.js", enabled: true }), { code: "UNSUPPORTED_PROFILE" });
  assert.ok(readPersonalSettings(w.dataRoot)?.extensions.includes("extensions/missing.js"));
});
test("Personal settings: linked, escaping and Society assets are not alternative selections", t => {
  const w = fixture(t); updatePersonalSettings(w);
  symlinkSync(join(w.libdir, "extensions/user.js"), join(w.libdir, "extensions/linked.js"));
  for (const entry of ["../user.js", "extensions/linked.js", DEPLOYMENT_LAYOUT.extension])
    assert.throws(() => updatePersonalSettings(w, [], { entry, enabled: true }));
  assert.deepEqual(readPersonalSettings(w.dataRoot)?.extensions, []);
});
test("Personal settings: an unreadable index does not mean every package was removed", t => {
  const w = fixture(t), before = updatePersonalSettings(w, [w.packageEntry]);
  writeFileSync(join(w.packages, PACKAGE_INDEX), "broken");
  assert.throws(() => updatePersonalSettings(w), { code: "STORE_CORRUPT" });
  assert.deepEqual(readPersonalSettings(w.dataRoot), before);
});
test("Personal settings: corrupt preference bytes are retained, never reset to defaults", t => {
  const w = fixture(t); updatePersonalSettings(w); const path = join(w.dataRoot, ".personal/settings.json");
  for (const value of [null, [], {}, { kind: "oma-personal-settings-v1", revision: 1, extensions: [DEPLOYMENT_LAYOUT.extension], packages: [] }]) {
    const bytes = JSON.stringify(value); writeFileSync(path, bytes);
    assert.throws(() => updatePersonalSettings(w), { code: "STORE_CORRUPT" }); assert.equal(readFileSync(path, "utf8"), bytes);
  }
});
test("Personal settings: a contended writer changes nothing and releases after an exception", t => {
  const w = fixture(t), before = updatePersonalSettings(w), lock = ProcessLock.tryAcquire(join(w.dataRoot, ".personal/settings.lock"));
  assert.ok(lock);
  try { assert.throws(() => updatePersonalSettings(w, [], { entry: w.packageEntry, enabled: true }), { code: "BROKER_UNAVAILABLE" }); }
  finally { lock.close(); }
  assert.deepEqual(readPersonalSettings(w.dataRoot), before);
  assert.throws(() => updatePersonalSettings(w, [], { entry: "../no.js", enabled: true }));
  assert.deepEqual(updatePersonalSettings(w, [], { entry: w.packageEntry, enabled: true }).extensions, [w.packageEntry]);
});
