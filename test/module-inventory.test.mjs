/** Complete installed payload selection and contained runtime link metadata;
 * these do not qualify immutable execution or a native scope. */
import test from "node:test";
import assert from "node:assert/strict";
import { closeSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openDirectory, openRegularBeneath } from "@oma/native/files";
import { productionModuleRoots, inventoryRuntimeModules } from "#oma-test/app/runtime/module-inventory";
import { deploymentManifest } from "#oma-test/app/runtime/deployment-manifest";
import { fileURLToPath } from "node:url";

test("001. Non-development closure includes nested dependencies and distinguishes absence from an unreadable optional package", () => {
  const lock = { lockfileVersion: 3, packages: {
    "": {}, "packages/app": {}, "node_modules/runtime": {}, "node_modules/runtime/node_modules/nested": {},
    "node_modules/@scope/peer": { peer: true }, "node_modules/dev": { dev: true },
    "node_modules/optional": { optional: true },
  } };
  assert.deepEqual(productionModuleRoots(lock, () => false), ["node_modules/@scope/peer", "node_modules/runtime"]);
  assert.deepEqual(productionModuleRoots(lock, () => true), ["node_modules/@scope/peer", "node_modules/optional", "node_modules/runtime"]);
  const denied = Object.assign(new Error("unreadable"), { code: "EACCES" });
  assert.throws(() => productionModuleRoots(lock, () => { throw denied; }), error => error === denied);
  for (const value of [{}, { lockfileVersion: 3, packages: [] }, { lockfileVersion: 3, packages: { "node_modules/../outside": {} } },
    { lockfileVersion: 3, packages: { "node_modules/pkg": { dev: "true" } } }])
    assert.throws(() => productionModuleRoots(value, () => true), { code: "UNSUPPORTED_PROFILE" });
});
test("003. Actual built installation inventories the external runtime and native loader payload", t => {
  const manifest = deploymentManifest(fileURLToPath(new URL("../", import.meta.url)));
  assert.equal(manifest.version, 2);
  assert.ok(manifest.files.some(file => file.path.startsWith("node_modules/koffi/") && file.path.endsWith(".js")));
  assert.ok(manifest.files.some(file => file.path.startsWith("node_modules/") && /\.(node|so|dylib)$/.test(file.path)));
  assert.ok(manifest.links.some(link => link.path.includes("/node_modules/.bin/")));
  t.diagnostic(JSON.stringify({ files: manifest.files.length, directories: manifest.directories.length,
    links: manifest.links.length, bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0) }));
});
test("002. Actual contained traversal pins nested code, native bytes, direct bin links and empty directories", t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oma-module-inventory-")));
  t.after(() => rmSync(root, { recursive: true }));
  const content = { "node_modules/pkg/package.json": "{}", "node_modules/pkg/index.js": "code",
    "node_modules/pkg/binding.node": Buffer.from([0, 255, 1]), "node_modules/pkg/node_modules/helper/bin.js": "bin" };
  for (const [path, bytes] of Object.entries(content)) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), bytes); }
  mkdirSync(join(root, "node_modules/pkg/empty")); mkdirSync(join(root, "node_modules/pkg/node_modules/.bin"));
  symlinkSync("../helper/bin.js", join(root, "node_modules/pkg/node_modules/.bin/helper"));
  const held = openDirectory(root); t.after(() => closeSync(held));
  const files = new Map(), namespaces = [], lock = { lockfileVersion: 3, packages: { "node_modules/pkg": {} } };
  const callbacks = { entry() {}, bound: () => false, directory: path => namespaces.push(path), file(parent, name, path) {
    const fd = openRegularBeneath(parent, name); try { files.set(path, readFileSync(fd)); } finally { closeSync(fd); }
  } };
  const result = inventoryRuntimeModules(root, held, lock, callbacks);
  assert.deepEqual([...files.keys()].sort(), Object.keys(content).sort());
  for (const [path, bytes] of Object.entries(content)) assert.deepEqual(files.get(path), Buffer.from(bytes));
  assert.deepEqual(result.links, [{ path: "node_modules/pkg/node_modules/.bin/helper", target: "node_modules/pkg/node_modules/helper/bin.js" }]);
  assert.ok(result.directories.includes("node_modules/pkg/empty")); assert.deepEqual(namespaces, ["node_modules/pkg/node_modules"]);
  symlinkSync("../../../../../outside", join(root, "node_modules/pkg/node_modules/.bin/escape"));
  assert.throws(() => inventoryRuntimeModules(root, held, lock, callbacks), { code: "UNSUPPORTED_PROFILE" });
});
