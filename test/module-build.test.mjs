import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { TUI_PUBLIC_SUBPATHS } from "../scripts/architecture/rules/surface-rules.mjs";

for (const name of ["tui", "extension"]) test(`DR41: independent ${name} artifact loads with its declared dependencies and public API`, async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-module-build-")), output = join(root, name);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync(process.execPath, ["scripts/build-module.mjs", name, "--out", output], { encoding: "utf8" });
  const manifestBytes = readFileSync(join(output, "package.json")), manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.name, `@oma/${name}`);
  for (const owner of ["application", "runtime", "storage", "broker", "store"])
    assert.equal(existsSync(join(output, "src", owner)) || existsSync(join(output, "src", `${owner}.js`)), false, owner);
  // Supply the real installed external packages; there is no OMA Runtime or
  // Application available in this output. This is a load test, not a provider run.
  symlinkSync(resolve("node_modules"), join(output, "node_modules"), "dir");
  if (name === "tui") {
    assert.deepEqual(Object.keys(manifest.exports), TUI_PUBLIC_SUBPATHS.map(path => `./${path}`));
    for (const entry of Object.values(manifest.exports)) {
      assert.ok(existsSync(join(output, entry.types)), entry.types);
      await import(pathToFileURL(join(output, entry.default)).href);
    }
  } else {
    assert.deepEqual(manifest.pi.extensions, ["./dist/index.js"]);
    assert.equal(typeof (await import(pathToFileURL(join(output, manifest.exports["."].default)).href)).default, "function");
    const { verifyVendorBundle } = await import(import.meta.resolve("@oma/tool-runtime/vendor-bundle"));
    // Each actual tool dependency owns its payload. The extension artifact
    // composes them without shipping a parallel vendor tree.
    assert.equal(existsSync(join(output, "dist/vendor")), false);
    const require = createRequire(join(output, "package.json"));
    for (const [tool, bundle] of [["lsp", "pi-lsp"], ["hashline", "pi-hashline-edit-pro"],
      ["web", "pi-web-access"], ["mcp", "pi-mcp-adapter"]]) {
      const name = `@oma/tool-${tool}`;
      assert.equal(manifest.dependencies[name], "0.1.0");
      const owned = join(dirname(require.resolve(name)), "vendor", bundle);
      assert.ok(verifyVendorBundle(owned).files > 0);
    }
    // Corruption of an actual owned payload is checked by vendor-owner-binding.

  }
  assert.throws(() => execFileSync(process.execPath, ["scripts/build-module.mjs", name, "--out", output], { stdio: "pipe" }),
    error => /output already exists/.test(error.stderr.toString()));
  assert.deepEqual(readFileSync(join(output, "package.json")), manifestBytes);
});
