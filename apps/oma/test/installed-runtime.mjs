import assert from "node:assert/strict";
const { runtimeAssets } = await import("@oma/app/runtime/assets");
const { DEPLOYMENT_LAYOUT } = await import("@oma/domain/deployment");
const assets = runtimeAssets("/explicit-install");
assert.equal(assets.entries.tui, "/explicit-install/" + DEPLOYMENT_LAYOUT.entries.tui);
assert.match(assets.entries.tui, /apps\/oma\/dist\/entry\/oma\.js$/);

// Exercise the installed executable from this isolated dependency closure.
const { spawnSync } = await import("node:child_process");
const { join, dirname } = await import("node:path");
const result = spawnSync(join(process.cwd(), "node_modules/.bin/oma"), ["--help"], {
  cwd: process.cwd(), encoding: "utf8", timeout: 10000,
  env: { ...process.env, HOME: process.cwd(), PATH: dirname(process.execPath) + ":/usr/bin:/bin" },
});
assert.ifError(result.error);
assert.equal(result.status, 0, result.stderr || "installed executable failed");
assert.match(result.stdout + result.stderr, /usage: oma/);

// Internal application modules remain shipped for the executable, without becoming package APIs.
const { readFileSync, readdirSync } = await import("node:fs");
const appRoot = join(dirname(new URL(import.meta.resolve("@oma/app/runtime/assets")).pathname), "../..");
const manifest = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8"));
assert.deepEqual(Object.keys(manifest.exports).sort(), ["./diagnostics/files", "./diagnostics/integrity", "./diagnostics/ledger", "./runtime/assets"]);
function inspect(directory, prefix = "") {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) inspect(join(directory, entry.name), name + "/");
    else if (entry.name.endsWith(".js")) {
      const subpath = name.slice(0, -3);
      if (!Object.hasOwn(manifest.exports, "./" + subpath))
        assert.throws(() => import.meta.resolve("@oma/app/" + subpath), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
    }
  }
}
inspect(join(appRoot, "dist"));
const rootTestOnly = ["#oma-test", "app", "runtime", "assets"].join("/");
assert.throws(() => import.meta.resolve(rootTestOnly), { code: "ERR_PACKAGE_IMPORT_NOT_DEFINED" });
