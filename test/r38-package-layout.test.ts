import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
import { runtimeAssets, assertRuntimeAssets } from "#oma-test/app/runtime/assets";
import { SCHEMA_PATH } from "@oma/storage";

const project = fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/, "");
test("R38: module-relative schema and native targets match the non-flattened build", () => {
  const assets = runtimeAssets(project);
  assert.doesNotThrow(() => assertRuntimeAssets(assets, { schema: SCHEMA_PATH }));
  const config = JSON.parse(readFileSync(join(project, "tsconfig.build.json"), "utf8"));
  assert.equal(config.compilerOptions.rootDir, "."); assert.equal(config.compilerOptions.outDir, "dist");
  const typecheck = JSON.parse(readFileSync(join(project, "tsconfig.json"), "utf8"));
  assert.ok(typecheck.include.includes("test/**/*.ts")); assert.ok(JSON.parse(readFileSync(join(project, "packages/contracts/tsconfig.json"), "utf8")).include.includes("src/**/*.ts"));
  assert.equal("host" in assets.entries, false, "the removed host relay must not remain an install target");
  assert.equal("systemd" in assets, false, "native runtime assets do not require a manager template directory");
});

test("R38: layout-only fixture detects missing raw SQL, native target, wrong root and symlink asset", () => {
  // Empty regular files model path/type facts ONLY, never full packaging or execution proof.
  const root = mkdtempSync(join(tmpdir(), "oma-layout-only-"));
  const assets = runtimeAssets(root);
  const commandBuilder = join(root, DEPLOYMENT_LAYOUT.modelCommandBuilder);
  const paths = [assets.schema, assets.contract, assets.extension, commandBuilder, ...Object.values(assets.entries)];
  const populate = (path: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, "", { flag: "wx" }); };
  try {
    for (const path of paths) populate(path);
    mkdirSync(join(root, "node_modules", "@oma"), { recursive: true });
    for (const workspace of DEPLOYMENT_LAYOUT.workspaces) {
      mkdirSync(join(root, workspace.root), { recursive: true });
      symlinkSync(join(root, workspace.root), join(root, "node_modules", workspace.name));
    }
    assert.doesNotThrow(() => assertRuntimeAssets(assets, { schema: assets.schema }));
    assert.throws(() => assertRuntimeAssets(assets, { schema: join(root, "wrong.sql") }), { code: "UNSUPPORTED_PROFILE" });
    for (const missing of [assets.schema, commandBuilder, ...Object.values(assets.entries)]) {
      rmSync(missing);
      assert.throws(() => assertRuntimeAssets(assets, { schema: assets.schema }), { code: "UNSUPPORTED_PROFILE" });
      populate(missing);
    }
    rmSync(assets.schema); symlinkSync(assets.contract, assets.schema);
    assert.throws(() => assertRuntimeAssets(assets, { schema: assets.schema }), { code: "UNSUPPORTED_PROFILE" });
    assert.throws(() => runtimeAssets(join(root, "..") + "/outside/.."), { code: "UNSUPPORTED_PROFILE" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
