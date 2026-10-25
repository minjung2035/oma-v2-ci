import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const helper = new URL("../apps/oma/dist/runtime/compile-cache.js", import.meta.url).href;
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oma-compile-cache-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, `oma-node-cache-${process.getuid()}`);
  const run = (source = "", extraEnv = {}) => {
    const env = { ...process.env, TMPDIR: root };
    for (const key of ["NODE_COMPILE_CACHE", "NODE_DISABLE_COMPILE_CACHE", "NODE_V8_COVERAGE", "NODE_OPTIONS"]) delete env[key];
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { enableProcessCompileCache } from ${JSON.stringify(helper)};
      import { getCompileCacheDir } from 'node:module';
      const enabled = enableProcessCompileCache();
      ${source}
      console.log(JSON.stringify({ enabled, directory: getCompileCacheDir(), value: typeof value === 'undefined' ? null : value }));
    `], { env: { ...env, ...extraEnv }, encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  return { root, directory, run };
}

test("startup: a warm compile cache still loads changed module bytes", t => {
  const f = fixture(t), module = join(f.root, "value.mjs");
  writeFileSync(module, "export const value = 1;\n");
  const source = `const { value } = await import(${JSON.stringify(pathToFileURL(module).href)});`;
  assert.equal(f.run(source).value, 1);
  assert.equal(f.run(source).value, 1);
  // Same length, different bytes: an earlier compilation is never authoritative.
  writeFileSync(module, "export const value = 2;\n");
  const current = f.run(source);
  assert.equal(current.enabled, true);
  assert.equal(current.value, 2);
  assert.equal(lstatSync(f.directory).mode & 0o777, 0o700);
});

test("startup: a linked compile cache is refused without modifying its target", t => {
  const f = fixture(t), target = join(f.root, "target");
  mkdirSync(target, { mode: 0o700 }); symlinkSync(target, f.directory);
  assert.deepEqual(f.run(), { enabled: false, value: null });
  assert.deepEqual(readdirSync(target), []);
  assert.equal(lstatSync(f.directory).isSymbolicLink(), true);
});

test("startup: a shared compile cache is refused and an owned inaccessible cache is repaired", t => {
  const f = fixture(t);
  mkdirSync(f.directory, { mode: 0o700 }); chmodSync(f.directory, 0o777);
  assert.equal(f.run().enabled, false);
  assert.deepEqual(readdirSync(f.directory), []);
  chmodSync(f.directory, 0);
  assert.equal(f.run().enabled, true);
  assert.equal(lstatSync(f.directory).mode & 0o777, 0o700);
});

for (const env of [{ NODE_DISABLE_COMPILE_CACHE: "1" }, { NODE_V8_COVERAGE: "" }]) {
  test(`startup: ${Object.keys(env)[0]} disables optional compilation caching`, t => {
    const f = fixture(t);
    assert.equal(f.run("", env).enabled, false);
    assert.equal(existsSync(f.directory), false);
  });
}
