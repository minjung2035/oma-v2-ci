import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { copyWorkspaceAssets, workspaceAssetSnapshot } from "../scripts/workspace-assets.mjs";
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oma-assets-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const name of ["src", "dist", "outside"]) mkdirSync(join(root, name));
  return root;
}
test("DR46: directory assets include exact payload bytes and empty directories", t => {
  const root = fixture(t);
  mkdirSync(join(root, "src/vendor/pi-lsp/empty"), { recursive: true });
  const bytes = Buffer.from([0, 255, 10, 0]);
  writeFileSync(join(root, "src/vendor/pi-lsp/data"), bytes);
  copyWorkspaceAssets(root, ["vendor/pi-lsp"]);
  assert.deepEqual(readFileSync(join(root, "dist/vendor/pi-lsp/data")), bytes);
  assert.equal(existsSync(join(root, "dist/vendor/pi-lsp/empty")), true);
  assert.deepEqual(workspaceAssetSnapshot(root, "src", ["vendor/pi-lsp"]), workspaceAssetSnapshot(root, "dist", ["vendor/pi-lsp"]));
  writeFileSync(join(root, "dist/vendor/pi-lsp/extra"), "unlisted");
  assert.notDeepEqual(workspaceAssetSnapshot(root, "src", ["vendor/pi-lsp"]), workspaceAssetSnapshot(root, "dist", ["vendor/pi-lsp"]));
});
test("DR46: asset copy refuses linked sources and destinations, traversal and compiler output collisions", t => {
  const root = fixture(t);
  writeFileSync(join(root, "outside/sentinel"), "unchanged");
  symlinkSync(join(root, "outside"), join(root, "src/linked"));
  symlinkSync(join(root, "outside"), join(root, "dist/linked"));
  mkdirSync(join(root, "src/real"));
  writeFileSync(join(root, "src/real/value"), "asset");
  mkdirSync(join(root, "src/linked-target"));
  writeFileSync(join(root, "src/linked-target/value"), "asset");
  symlinkSync(join(root, "outside"), join(root, "dist/linked-target"));
  for (const value of ["linked", "linked/sentinel", "linked-target/value", "../outside/sentinel", "/outside", "real/../value"])
    assert.throws(() => copyWorkspaceAssets(root, [value]), undefined, value);
  writeFileSync(join(root, "src/output.js"), "asset");
  writeFileSync(join(root, "dist/output.js"), "compiler");
  assert.throws(() => copyWorkspaceAssets(root, ["output.js"]), { code: "EEXIST" });
  assert.equal(readFileSync(join(root, "dist/output.js"), "utf8"), "compiler");
  assert.equal(readFileSync(join(root, "outside/sentinel"), "utf8"), "unchanged");
  assert.equal(existsSync(join(root, "outside/value")), false);
});
