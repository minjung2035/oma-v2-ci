import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
import { runtimeAssets, assertRuntimeAssets } from "#oma-test/app/runtime/assets";
import { SCHEMA_PATH } from "@oma/storage";
import { UNIT_TPL_DIR } from "@oma/platform-linux/units";

const project = fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/, "");
test("R38: module-relative schema/templates and service targets match the non-flattened build", () => {
  const assets = runtimeAssets(project);
  assert.doesNotThrow(() => assertRuntimeAssets(assets, { schema: SCHEMA_PATH, systemd: UNIT_TPL_DIR }));
  const config = JSON.parse(readFileSync(join(project, "tsconfig.build.json"), "utf8"));
  assert.equal(config.compilerOptions.rootDir, "."); assert.equal(config.compilerOptions.outDir, "dist");
  const typecheck = JSON.parse(readFileSync(join(project, "tsconfig.json"), "utf8"));
  assert.ok(typecheck.include.includes("test/**/*.ts")); assert.ok(JSON.parse(readFileSync(join(project, "packages/contracts/tsconfig.json"), "utf8")).include.includes("src/**/*.ts"));
  for (const [template, entry] of Object.entries(DEPLOYMENT_LAYOUT.templateEntries)) {
    const text = readFileSync(join(assets.systemd, template), "utf8");
    assert.ok(text.includes(`ExecStart=@NODE@ @LIBDIR@/${DEPLOYMENT_LAYOUT.entries[entry]} `));
    assert.equal(text.includes("@LIBDIR@/dist/entry/"), false);
  }
});

test("R38: layout-only fixture detects missing raw SQL, template, wrong root and symlink asset", () => {
  // Empty regular files model path/type facts ONLY, never full packaging or execution proof.
  const root = mkdtempSync(join(tmpdir(), "oma-layout-only-"));
  const assets = runtimeAssets(root);
  const commandBuilder = join(root, DEPLOYMENT_LAYOUT.modelCommandBuilder);
  const paths = [assets.schema, assets.contract, assets.extension, commandBuilder, ...Object.values(assets.entries),
    ...Object.keys(DEPLOYMENT_LAYOUT.templateEntries).map(name => join(assets.systemd, name))];
  const populate = (path: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, "", { flag: "wx" }); };
  try {
    for (const path of paths) populate(path);
    mkdirSync(join(root, "node_modules", "@oma"), { recursive: true });
    for (const workspace of DEPLOYMENT_LAYOUT.workspaces) {
      mkdirSync(join(root, workspace.root), { recursive: true });
      symlinkSync(join(root, workspace.root), join(root, "node_modules", workspace.name));
    }
    assert.doesNotThrow(() => assertRuntimeAssets(assets, { schema: assets.schema, systemd: assets.systemd }));
    assert.throws(() => assertRuntimeAssets(assets, { schema: join(root, "wrong.sql"), systemd: assets.systemd }), { code: "UNSUPPORTED_PROFILE" });
    for (const missing of [assets.schema, commandBuilder, join(assets.systemd, "resident.service.in"), ...Object.values(assets.entries)]) {
      rmSync(missing);
      assert.throws(() => assertRuntimeAssets(assets, { schema: assets.schema, systemd: assets.systemd }), { code: "UNSUPPORTED_PROFILE" });
      populate(missing);
    }
    rmSync(assets.schema); symlinkSync(assets.contract, assets.schema);
    assert.throws(() => assertRuntimeAssets(assets, { schema: assets.schema, systemd: assets.systemd }), { code: "UNSUPPORTED_PROFILE" });
    assert.throws(() => runtimeAssets(join(root, "..") + "/outside/.."), { code: "UNSUPPORTED_PROFILE" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
