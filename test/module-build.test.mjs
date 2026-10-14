import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
    assert.deepEqual(manifest.pi.extensions, ["./src/pi-extension.js"]);
    assert.equal(typeof (await import(pathToFileURL(join(output, manifest.exports["."])).href)).default, "function");
    const { verifyVendorBundle } = await import(pathToFileURL(join(output, "src/extension/vendor-bundle.js")).href);
    const vendorRoot = join(output, "src/extension/vendor"), bundles = readdirSync(vendorRoot);
    assert.ok(bundles.length > 0);
    for (const bundle of bundles) assert.ok(verifyVendorBundle(join(vendorRoot, bundle)).files > 0);
    const first = join(vendorRoot, bundles[0]);
    writeFileSync(join(first, "unlisted.js"), "throw new Error('must never load');\n");
    assert.throws(() => verifyVendorBundle(first), /unlisted/);
  }
  assert.throws(() => execFileSync(process.execPath, ["scripts/build-module.mjs", name, "--out", output], { stdio: "pipe" }),
    error => /output already exists/.test(error.stderr.toString()));
  assert.deepEqual(readFileSync(join(output, "package.json")), manifestBytes);
});
