/** CFG-001/CFG-005/TUI-007: one owner for "what is inside this configuration
 * bundle", and the screens that write must ask it.
 *
 * `src/config/operations.ts` decides what a bundle contains. Its rule is strict:
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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEPLOYMENT_LAYOUT } from "../dist/src/domain/deployment.js";
import { configurationLayout, readConfigurationSource } from "../dist/src/config/operations.js";
import { readExtensions, toggleExtension } from "../dist/src/tui/sources/extensions.js";
import { StoreError } from "../dist/src/domain/errors.js";

// `toolSurface` is the field this screen does not model: the loader accepts it,
// the Extensions screen never reads it, and an edit that rewrote the role file
// from what the screen understands would drop it.
const ROLE = {
  agentProfile: { modelProfile: "m" },
  extensions: [DEPLOYMENT_LAYOUT.extension],
  promptFile: "prompt.md",
  toolSurface: { defaultMode: "DIRECT" },
};

/** A bundle plus a file outside it that nothing in the bundle may reach. */
function fixture(roles) {
  const base = mkdtempSync(join(tmpdir(), "oma-bundle-"));
  const root = join(base, "bundle");
  const libdir = join(root, "lib");
  mkdirSync(join(libdir, "extensions"), { recursive: true });
  mkdirSync(join(libdir, "dist", "src"), { recursive: true });
  writeFileSync(join(libdir, DEPLOYMENT_LAYOUT.extension), "export {};\n");
  writeFileSync(join(libdir, "extensions", "x.js"), "export {};\n");
  writeFileSync(join(root, "prompt.md"), "");
  writeFileSync(join(root, "host.json"), JSON.stringify({ installation: { libdir } }));
  writeFileSync(join(root, "models.json"), JSON.stringify({ m: { provider: "p", model: "m" } }));
  writeFileSync(join(root, "role.json"), JSON.stringify(ROLE));
  const outside = join(base, "OUTSIDE.json");
  writeFileSync(outside, JSON.stringify(ROLE));
  const index = join(root, "index.json");
  writeFileSync(index, JSON.stringify({ kind: "oma-operations-v1", host: "host.json", models: "models.json", roles }));
  return { base, root, index, outside, cleanup: () => rmSync(base, { recursive: true, force: true }) };
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
    const layout = configurationLayout(f.index);
    assert.equal(layout.kind, "operations");
    assert.deepEqual(Object.keys(layout.roles), ["resident"]);
    assert.ok(readConfigurationSource(f.index).roles["resident"], "the loader did not accept its own bundle");

    const context = readExtensions(f.index, "principal", "resident");
    assert.equal(context.editable, true, `a valid bundle was not editable: ${context.reason}`);
    assert.deepEqual(context.roles.map(role => role.path), [layout.roles["resident"]],
      "the screen edits a path the owner did not resolve");

    toggleExtension(context, "extensions/x.js", "workers", true);
    const written = JSON.parse(readFileSync(join(f.root, "role.json"), "utf8"));
    assert.deepEqual(written.extensions, [DEPLOYMENT_LAYOUT.extension, "extensions/x.js"]);
    assert.deepEqual(written.toolSurface, { defaultMode: "DIRECT" },
      "a field the screen does not model was lost");
    assert.equal(readFileSync(f.outside, "utf8"), JSON.stringify(ROLE), "the outside file was touched");
  } finally { f.cleanup(); }
});

test("CFG-005: the screens do not carry a second reading of the bundle format", () => {
  // Read off the source, not off one run. The composition above would still
  // pass if a screen merely happened to agree with the owner today; what broke
  // was a screen that had its own rule and drifted from it. A screen that
  // cannot name the format cannot re-derive what is inside it.
  for (const file of ["src/tui/sources/settings.ts", "src/tui/sources/extensions.ts"]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.equal(source.includes("oma-operations-v1"), false,
      `${file} recognises the bundle format itself: what a bundle contains is the loader's answer`);
  }
});
