/** CFG-001/CFG-005/TUI-007: one owner for "what is inside this configuration
 * bundle", and the screens that write must ask it.
 *
 * `apps/oma/src/config/operations.ts` decides what a bundle contains. Its rule is strict:
 * a reference must be a normalized relative path, must resolve inside the
 * bundle root, and must not be reached through a symlink. The broker refuses to
 * load anything else.
 *
 * The Config screen had a second, weaker answer to the same question, and the
 * Extensions screen had a third with no containment rule at all -- it composed
 * `join(root, String(file))` and then *wrote* there. So a bundle the product
 * would never load could still make the TUI write a role file outside the
 * bundle it was editing. Two owners of one fact, with the weaker one holding
 * the write; the tests below fix the rule at the owner and prove the screens
 * consume it rather than re-deriving it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
import { configurationLayout, readConfigurationSource } from "@oma/config/operations";
import { loadConfiguration } from "@oma/config";
import { readExtensions, toggleExtension } from "#oma-test/app/application/extensions";
import { StoreError } from "@oma/domain/errors";
import { createCompleteConfigurationFixture } from "../dist/test/fixtures/configuration.js";

/** Start from a validated control; only then deliberately alter the referenced
 * resident path for containment tests. This does not bless a corrupt candidate. */
function fixture(roles) {
  const complete = createCompleteConfigurationFixture();
  try {
    const root = complete.output;
    mkdirSync(join(complete.installation, "extensions"), { recursive: true });
    writeFileSync(join(complete.installation, "extensions/x.js"), "export {};\n");
    const role = JSON.parse(readFileSync(join(root, "roles/resident.json"), "utf8"));
    const outsideBytes = JSON.stringify(role);
    writeFileSync(join(root, "role.json"), outsideBytes);
    const outside = join(complete.root, "OUTSIDE.json");
    writeFileSync(outside, outsideBytes);
    complete.edit("config.json", value => Object.assign(value.roles, roles));
    return { root, index: complete.path, outside, outsideBytes, cleanup: complete.close };
  } catch (error) { complete.close(); throw error; }
}

test("CFG-005: a role reference that leaves the bundle is refused before anything is written", () => {
  for (const escape of ["../OUTSIDE.json", "sub/../../OUTSIDE.json"]) {
    const f = fixture({ resident: escape });
    try {
      assert.throws(() => configurationLayout(f.index), (error) =>
        error instanceof StoreError && /normalized relative file path|escapes its root/.test(error.message),
        `the owner accepted ${escape}`);

      // The screen that writes must reach the same verdict. It reports the
      // refusal rather than throwing, because an unreadable config is a thing
      // the Config screen shows; what it must never do is edit anyway.
      const context = readExtensions(f.index, "principal", "resident");
      assert.equal(context.editable, false, `${escape} was offered as editable`);
      for (const role of context.roles)
        assert.ok(role.path.startsWith(`${f.root}/`), `a role path left the bundle: ${role.path}`);

      const before = readFileSync(f.outside, "utf8");
      assert.throws(() => toggleExtension(context, "extensions/x.js", "workers", true),
        (error) => error instanceof StoreError);
      assert.equal(readFileSync(f.outside, "utf8"), before,
        `a file outside the bundle was rewritten through ${escape}`);
    } finally { f.cleanup(); }
  }
});

test("CFG-005: a role file reached through a symlink is not inside the bundle", () => {
  const f = fixture({ resident: "link.json" });
  try {
    symlinkSync(f.outside, join(f.root, "link.json"));
    // The broker refuses this bundle. A screen that edited it would be offering
    // to change a configuration that can never start.
    assert.throws(() => readConfigurationSource(f.index), (error) =>
      error instanceof StoreError && /escapes its root or uses a symlink/.test(error.message));
    assert.throws(() => configurationLayout(f.index), (error) =>
      error instanceof StoreError && /escapes its root or uses a symlink/.test(error.message));
    assert.equal(readExtensions(f.index, "principal", "resident").editable, false,
      "a bundle the product refuses to load was offered for editing");
  } finally { f.cleanup(); }
});

test("CFG-005: a bundle the loader accepts is the bundle the screen edits", () => {
  // The control for the controls above: a rule that refused everything would
  // pass them all. A genuine bundle must still be readable, editable, and
  // written in place.
  const f = fixture({ resident: "role.json" });
  try {
    // V02A: source assembly alone is not the closed HostConfig boundary.
    assert.doesNotThrow(() => loadConfiguration(f.index));
    const layout = configurationLayout(f.index);
    assert.equal(layout.kind, "operations");
    assert.deepEqual(Object.keys(layout.roles), ["principal", "resident", "verifier"]);
    assert.ok(readConfigurationSource(f.index).roles["resident"], "the loader did not accept its own bundle");

    const context = readExtensions(f.index, "principal", "resident");
    assert.equal(context.editable, true, `a valid bundle was not editable: ${context.reason}`);
    assert.deepEqual(context.roles.map(role => role.path), Object.values(layout.roles),
      "the screen edits a path the owner did not resolve");

    const authored = readFileSync(join(f.root, "role.json"), "utf8");
    const profile = JSON.parse(authored).agentProfile;
    toggleExtension(context, "extensions/x.js", "workers", true);
    // D02/WP13: published as a managed generation; the authored file is kept.
    const written = readConfigurationSource(f.index).authoredRoles["resident"].value;
    assert.deepEqual(written.extensions, [DEPLOYMENT_LAYOUT.extension, "extensions/x.js"]);
    assert.deepEqual(written.agentProfile, profile, "editing extensions changed the validated agent profile");
    assert.equal(readFileSync(join(f.root, "role.json"), "utf8"), authored, "the authored role file was edited in place");
    assert.equal(readFileSync(f.outside, "utf8"), f.outsideBytes, "the outside file was touched");
    assert.doesNotThrow(() => loadConfiguration(f.index), "the edited candidate must remain loadable");
  } finally { f.cleanup(); }
});

test("CFG-005: the screens do not carry a second reading of the bundle format", () => {
  // Read off the source, not off one run. The composition above would still
  // pass if a screen merely happened to agree with the owner today; what broke
  // was a screen that had its own rule and drifted from it. A screen that
  // cannot name the format cannot re-derive what is inside it.
  for (const file of ["apps/oma/src/application/settings.ts", "apps/oma/src/application/extensions.ts"]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.equal(source.includes("oma-operations-v1"), false,
      `${file} recognises the bundle format itself: what a bundle contains is the loader's answer`);
  }
});
