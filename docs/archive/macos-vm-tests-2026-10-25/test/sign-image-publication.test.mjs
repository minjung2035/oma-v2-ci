import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { generateKeyPairSync, verify } from "node:crypto";
import crypto from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const signer = new URL("../scripts/platform/sign-image.mjs", import.meta.url);
const source = ts.transpileModule(fs.readFileSync(signer, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const keys = generateKeyPairSync("ed25519");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(tmpdir(), "oma-sign-publication-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manifest = Buffer.from('{"version":"one"}\n');
  fs.writeFileSync(path.join(root, "manifest.json"), manifest);
  const key = path.join(root, "release.pem");
  fs.writeFileSync(key, keys.privateKey.export({ type: "pkcs8", format: "pem" }));
  fs.writeFileSync(path.join(root, "manifest.json.sig"), "previous signature\n");
  return { root, key, manifest, target: path.join(root, "manifest.json.sig") };
}
function valid(f) {
  assert.ok(verify(null, f.manifest, keys.publicKey, Buffer.from(fs.readFileSync(f.target, "utf8").trim(), "base64")));
}
function injected(f, failure) {
  const events = [], names = new Map();
  const boundary = phase => { events.push(phase); if (failure === phase) throw new Error(`injected ${phase}`); };
  const mocked = { ...fs,
    openSync(name, flags, mode) {
      if (name !== f.root) {
        assert.equal(flags, "wx");
        assert.equal(path.dirname(name), f.root);
        assert.notEqual(name, f.target);
      }
      const fd = fs.openSync(name, flags, mode); names.set(fd, name); events.push(name === f.root ? "open-parent" : "open-temp"); return fd;
    },
    writeFileSync(fd, bytes) { assert.equal(typeof fd, "number"); boundary("write-temp"); fs.writeFileSync(fd, bytes); },
    fsyncSync(fd) { boundary(names.get(fd) === f.root ? "fsync-parent" : "fsync-temp"); fs.fsyncSync(fd); },
    closeSync(fd) { events.push(names.get(fd) === f.root ? "close-parent" : "close-temp"); fs.closeSync(fd); },
    renameSync(from, to) { boundary("rename"); assert.equal(to, f.target); fs.renameSync(from, to); },
  };
  const run = () => runInNewContext(source, { exports: {}, process: { argv: ["node", "signer", f.root, f.key] },
    require: name => ({ "node:fs": mocked, "node:crypto": crypto, "node:path": path })[name], console });
  return { run, events };
}

test("AV-31: signing publishes a complete signature with file fsync before rename and directory fsync after", t => {
  const f = fixture(t), { run, events } = injected(f);
  run(); valid(f);
  assert.deepEqual(events, ["open-temp", "write-temp", "fsync-temp", "close-temp", "rename", "open-parent", "fsync-parent", "close-parent"]);
  assert.equal(fs.readdirSync(f.root).some(name => name.startsWith(".manifest.json.sig-")), false);
  const result = spawnSync(process.execPath, [fileURLToPath(signer), f.root, f.key], { encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr); valid(f);
});

for (const phase of ["write-temp", "fsync-temp", "rename", "fsync-parent"]) {
  test(`AV-31: ${phase} failure preserves either the old signature or the completely published new one`, t => {
    const f = fixture(t), { run } = injected(f, phase);
    assert.throws(run, new RegExp(`injected ${phase}`));
    if (phase === "fsync-parent") valid(f);
    else assert.equal(fs.readFileSync(f.target, "utf8"), "previous signature\n");
    assert.equal(fs.readdirSync(f.root).some(name => name.startsWith(".manifest.json.sig-")), false);
    injected(f).run(); valid(f);
  });
}

for (const phase of ['file-fsync', 'rename', 'parent-fsync']) test(`AV-31: process kill after ${phase} keeps signature bytes whole and restart verifies them`, t => {
  const f = fixture(t), preload = path.join(f.root, 'kill-boundary.mjs');
  fs.writeFileSync(preload, `import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';
    const flush = fs.fsyncSync, rename = fs.renameSync;
    fs.fsyncSync = fd => { flush(fd); const directory = fs.fstatSync(fd).isDirectory();
      if (${JSON.stringify(phase)} === (directory ? 'parent-fsync' : 'file-fsync')) process.kill(process.pid, 'SIGKILL'); };
    fs.renameSync = (...args) => { rename(...args); if (${JSON.stringify(phase)} === 'rename') process.kill(process.pid, 'SIGKILL'); };
    syncBuiltinESMExports();`);
  const killed = spawnSync(process.execPath, ['--import', preload, fileURLToPath(signer), f.root, f.key], { timeout: 10000 });
  assert.equal(killed.signal, 'SIGKILL');
  if (phase === 'file-fsync') assert.equal(fs.readFileSync(f.target, 'utf8'), 'previous signature\n');
  else valid(f);
  const restarted = spawnSync(process.execPath, [fileURLToPath(signer), f.root, f.key], { encoding: 'utf8', timeout: 10000 });
  assert.equal(restarted.status, 0, restarted.stderr); valid(f);
});

test("AV-31: rename replaces a signature symlink rather than truncating the linked file", t => {
  const f = fixture(t), protectedFile = path.join(f.root, "protected");
  fs.writeFileSync(protectedFile, "untouched");
  fs.unlinkSync(f.target); fs.symlinkSync(protectedFile, f.target);
  injected(f).run(); valid(f);
  assert.equal(fs.readFileSync(protectedFile, "utf8"), "untouched");
  assert.equal(fs.lstatSync(f.target).isSymbolicLink(), false);
});
