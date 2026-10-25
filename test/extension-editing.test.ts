// V14A/V14B (WP14): one extension-reference rule for the loader and the editor,
// and a limited repair for a declared optional extension whose file is gone.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfiguration, loadConfigurationSnapshot } from "@oma/config";
import { observeExtensionAsset } from "@oma/config/operations";
import { CORE_EXTENSION, readExtensions, toggleExtension } from "#oma-test/app/application/extensions";
import { StoreError } from "@oma/domain/errors";
import { createCompleteConfigurationFixture } from "./fixtures/configuration.js";

const code = (value: string) => (error: unknown) => error instanceof StoreError && error.code === value;

function placed() {
  const f = createCompleteConfigurationFixture();
  const dir = join(f.installation, "extensions");
  mkdirSync(join(dir, "nested"), { recursive: true });
  writeFileSync(join(dir, "ok.js"), "export {};\n");
  writeFileSync(join(dir, "nested", "deep.mjs"), "export {};\n");
  symlinkSync("ok.js", join(dir, "link.js"));               // internal symlink
  writeFileSync(join(dir, "big.js"), Buffer.alloc(1024 * 1024 + 1)); // executable assets are not configuration documents
  writeFileSync(join(dir, "notes.txt"), "not code\n");
  mkdirSync(join(dir, "folder.js"));                         // a directory with a code suffix
  return f;
}

test("V14A: the editor offers exactly the files the loader accepts, and an enabled one loads", () => {
  const f = placed();
  try {
    const context = readExtensions(f.path, "principal", "resident");
    const offered = context.rows.map(row => row.id).filter(id => id !== CORE_EXTENSION).sort();
    assert.deepEqual(offered, ["extensions/big.js", "extensions/nested/deep.mjs", "extensions/ok.js"]);
    // The negative control: the loader's own verdict over the same candidates
    // (including ones the editor must not offer) agrees entry by entry.
    for (const entry of ["extensions/ok.js", "extensions/nested/deep.mjs", "extensions/link.js", "extensions/big.js",
      "extensions/notes.txt", "extensions/folder.js", "extensions/absent.js", "../escape.js", "extensions/./ok.js"]) {
      f.edit("roles/resident.json", role => { role.extensions = [CORE_EXTENSION, entry]; });
      let loads = true;
      try { loadConfiguration(f.path); } catch { loads = false; }
      assert.equal(observeExtensionAsset({ libdir: f.installation }, entry).kind === "present", loads, entry);
      assert.equal(offered.includes(entry), loads, `editor and loader disagree on ${entry}`);
    }
    f.edit("roles/resident.json", role => { role.extensions = [CORE_EXTENSION]; });
    const fresh = readExtensions(f.path, "principal", "resident");
    toggleExtension(fresh, "extensions/ok.js", "workers", true);
    const loaded = loadConfigurationSnapshot(f.path);
    assert.deepEqual(loaded.authoredRoles.resident!.value.extensions, [CORE_EXTENSION, "extensions/ok.js"]);
    assert.equal(loaded.roles.resident!.extensions[0]!.path, join(f.installation, CORE_EXTENSION));
    // A refused enable changes nothing.
    const after = readExtensions(f.path, "principal", "resident");
    const manifest = readFileSync(f.path);
    for (const entry of ["extensions/link.js", "../escape.js", "/etc/passwd.js", "extensions/absent.js"])
      assert.throws(() => toggleExtension(after, entry, "principal", true), code("INVALID_REQUEST"), entry);
    assert.deepEqual(readFileSync(f.path), manifest);
    // The core stays first and cannot be removed.
    toggleExtension(after, CORE_EXTENSION, "principal", false);
    assert.deepEqual(readFileSync(f.path), manifest);
  } finally { f.close(); }
});

test("V14A: the scan is bounded, follows no symlink and reports a partial list", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const dir = join(f.installation, "extensions");
    mkdirSync(dir, { recursive: true });
    for (let index = 0; index < 1100; index++) writeFileSync(join(dir, `e${String(index).padStart(4, "0")}.js`), "export {};\n");
    const outside = join(f.root, "outside");
    mkdirSync(outside); writeFileSync(join(outside, "x.js"), "export {};\n");
    symlinkSync(outside, join(dir, "aaa-linked-dir"));
    const context = readExtensions(f.path, "principal", "resident");
    assert.equal(context.scan, "partial");
    assert.match(context.reason ?? "", /partial list/);
    assert.ok(!context.rows.some(row => row.id.includes("aaa-linked-dir")), "a symlinked directory was traversed");
    assert.ok(context.rows.length <= 1025);
  } finally { f.close(); }
});

test("V14B: a declared optional extension whose file is gone can be removed, and only that declaration", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const dir = join(f.installation, "extensions");
    mkdirSync(dir, { recursive: true });
    for (const name of ["keep-z.js", "gone.js", "keep-a.js"]) writeFileSync(join(dir, name), "export {};\n");
    f.edit("roles/resident.json", role => {
      role.extensions = [CORE_EXTENSION, "extensions/keep-z.js", "extensions/gone.js", "extensions/keep-a.js"];
    });
    const profileBefore = loadConfigurationSnapshot(f.path).authoredRoles.resident!.value.agentProfile;
    loadConfiguration(f.path);
    rmSync(join(dir, "gone.js"));
    assert.throws(() => loadConfiguration(f.path), "the bundle no longer loads");
    const context = readExtensions(f.path, "principal", "resident");
    assert.equal(context.mode, "repair");
    assert.ok(context.rows.find(row => row.id === "extensions/gone.js")!.missing);
    // Nothing else may be changed while the configuration cannot run.
    assert.throws(() => toggleExtension(context, "extensions/keep-a.js", "principal", true), code("UNSUPPORTED_PROFILE"));
    assert.throws(() => toggleExtension(context, "extensions/keep-a.js", "workers", false), code("UNSUPPORTED_PROFILE"));
    toggleExtension(context, CORE_EXTENSION, "workers", false);
    toggleExtension(context, "extensions/gone.js", "workers", false);
    const repaired = loadConfigurationSnapshot(f.path);
    assert.deepEqual(repaired.authoredRoles.resident!.value.extensions,
      [CORE_EXTENSION, "extensions/keep-z.js", "extensions/keep-a.js"], "order and the other declarations are kept");
    assert.deepEqual(repaired.authoredRoles.resident!.value.agentProfile,
      profileBefore);
    assert.equal(readExtensions(f.path, "principal", "resident").mode, "full");
  } finally { f.close(); }
});

test("V14B: the repair does not loosen the loader: another invalid field keeps the configuration uneditable", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const dir = join(f.installation, "extensions");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "gone.js"), "export {};\n");
    f.edit("roles/resident.json", role => { role.extensions = [CORE_EXTENSION, "extensions/gone.js"]; });
    rmSync(join(dir, "gone.js"));
    f.edit("host.json", host => { host.limits.logBytes = -1; });
    const context = readExtensions(f.path, "principal", "resident");
    assert.equal(context.editable, false);
    assert.equal(context.mode, "full");
    // A present-but-invalid reference is not "missing" and is not repaired either.
    const g = createCompleteConfigurationFixture();
    try {
      mkdirSync(join(g.installation, "extensions"), { recursive: true });
      mkdirSync(join(g.installation, "extensions", "big.js"));
      g.edit("roles/resident.json", role => { role.extensions = [CORE_EXTENSION, "extensions/big.js"]; });
      assert.equal(readExtensions(g.path, "principal", "resident").editable, false);
    } finally { g.close(); }
  } finally { f.close(); }
});

test("V14A: a symlink loop under the extension directory is not walked, so a small scan stays complete", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const dir = join(f.installation, "extensions");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "ok.js"), "export {};\n");
    symlinkSync(".", join(dir, "loop"));
    const context = readExtensions(f.path, "principal", "resident");
    assert.equal(context.scan, "complete", "the loop was followed until the depth bound");
    assert.deepEqual(context.rows.map(row => row.id), [CORE_EXTENSION, "extensions/ok.js"]);
  } finally { f.close(); }
});

test("P0-5: a directory the scan cannot list makes the list partial, and what it can see is still offered", { skip: process.getuid?.() === 0 }, () => {
  const f = placed();
  const closed = join(f.installation, "extensions", "aaa-closed");
  mkdirSync(closed);
  writeFileSync(join(closed, "hidden.js"), "export {};\n");
  chmodSync(closed, 0o000);
  try {
    const context = readExtensions(f.path, "principal", "resident");
    assert.equal(context.scan, "partial", "an unlisted directory is not an empty one");
    assert.ok(context.rows.some(row => row.id === "extensions/ok.js"), "the rest of the scan still ran");
  } finally { chmodSync(closed, 0o700); f.close(); }
});
