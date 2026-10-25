import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const entry = resolve("apps/oma/dist/entry/oma.js");
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oma-native-entry-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, "project"); mkdirSync(project);
  return { root, run: argv => spawnSync(process.execPath, [entry, ...argv], { cwd: project,
    env: { ...process.env, HOME: root, XDG_DATA_HOME: join(root, "data"), XDG_RUNTIME_DIR: join(root, "run") },
    encoding: "utf8", timeout: 15000 }) };
}
test("native entry: public help needs no VM, manager, configuration or state creation", t => {
  const f = fixture(t), result = f.run(["--help"]);
  assert.equal(result.status, 0, result.stderr); assert.match(result.stderr, /usage: oma/);
  assert.deepEqual(readdirSync(f.root), ["project"]);
});
test("native entry: retired VM commands refuse before any filesystem effect", t => {
  const f = fixture(t);
  for (const argv of [["attach", "demo"], ["open", "demo", "--project", "old"], ["bind", "demo"], ["stop"], ["status"], ["list"]]) {
    const result = f.run(argv);
    assert.equal(result.status, 2, result.stderr); assert.match(result.stderr, /VM commands have been retired/);
    assert.deepEqual(readdirSync(f.root), ["project"]);
  }
});
if (process.platform === "darwin") test("native Darwin: unresolved gates refuse actual entrypoints and preserve old bytes", t => {
  const f = fixture(t), old = join(f.root, "old-vm-state"); writeFileSync(old, "accepted bytes must remain\n");
  for (const argv of [[], ["--mode", "personal"], ["login"], ["pi", "install", "npm:fixture"]]) {
    const result = f.run(argv);
    assert.equal(result.status, 4, result.stderr); assert.match(result.stderr, /G-PROCESS, G-FILES and G-AUTH/);
    assert.equal(readFileSync(old, "utf8"), "accepted bytes must remain\n");
    assert.deepEqual(readdirSync(f.root).sort(), ["old-vm-state", "project"]);
  }
});
