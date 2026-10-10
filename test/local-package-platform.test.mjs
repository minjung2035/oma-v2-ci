/** DR25/C20: `oma pi install` of a `.tar`/`.tgz` on the Mac host stages the
 * archive's scratch spool through the host's file owner -- the same split the
 * directory/file staging areas keep -- and never touches the Linux openat2 /
 * `/proc/self/fd` primitives, which do not exist there. The Darwin branch is
 * exercised with local files under a stubbed `process.platform`; the
 * contained/directory modules are replaced by the UNSUPPORTED_PROFILE refusal
 * the real host gives every one of their calls, so a regression that reaches
 * for them fails exactly as the Mac did.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import * as url from 'node:url';
import * as streams from 'node:stream/promises';
import * as zlib from 'node:zlib';
import { tmpdir } from 'node:os';
import { Script } from 'node:vm';
import ts from 'typescript';
import * as errors from '../dist/src/domain/errors.js';
import * as operations from '../dist/src/config/operations.js';
import * as piPackages from '../dist/src/runtime/pi-packages.js';
import * as durable from '../dist/src/storage/durable-fs.js';
import * as tar from '../dist/src/runtime/package-tar.js';
import * as packageArchive from '../dist/src/platform/package-archive.js';
import * as host from '../dist/src/platform/host/files.js';

const unsupported = () => {
  throw new errors.StoreError('UNSUPPORTED_PROFILE',
    'contained filesystem access requires Linux x64/arm64 openat2');
};
// On the real host every one of these entry points refuses; any Darwin-branch
// reach for one fails this fixture the way the regression failed the host.
const containedStub = new Proxy({}, { get: () => unsupported });
const directoryStub = new Proxy({}, { get: () => unsupported });

const code = ts.transpileModule(
  fs.readFileSync(process.env.OMA_LOCAL_PACKAGE_SOURCE ?? 'src/runtime/local-package.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
function load(platform, changes = {}) {
  const module = { exports: {} };
  const dependencies = {
    'node:crypto': crypto, 'node:path': path, 'node:fs': fs, 'node:stream/promises': streams,
    'node:zlib': zlib, 'node:os': os, 'node:url': url,
    '../domain/errors.js': errors, '../config/operations.js': operations,
    './pi-packages.js': piPackages, '../storage/contained-fs.js': containedStub,
    '../storage/directory.js': directoryStub, '../storage/durable-fs.js': durable,
    '../platform/package-archive.js': packageArchive, '../platform/host/files.js': host,
    ...changes };
  const stage = { exports: {} };
  const stageCode = ts.transpileModule(fs.readFileSync('src/runtime/local-package-stage.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = output => ({ module: output, exports: output.exports, Buffer, process: { platform },
    require(name) { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; } });
  new Script(stageCode).runInNewContext(context(stage));
  dependencies['./local-package-stage.js'] = stage.exports;
  dependencies['./package-tar.js'] = tar;
  new Script(code).runInNewContext(context(module));
  return module.exports;
}
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'oma-local-package-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root;
}

/** A ustar stream (as `npm pack` writes) holding the given files under
 * `package/`; `dirs` names directory members (type '5', trailing `/`), which
 * real `npm pack` output always carries. The same grammar pi-packages.test.ts
 * builds. */
function tarball(files, dirs = []) {
  const parts = [];
  const header = (name, size, type = 0x30) => {
    const block = Buffer.alloc(512);
    block.write(name, 0, 'utf8');
    block.write(`${(0o644).toString(8).padStart(7, '0')}\0`, 100);
    block.write('0000000\0', 108); block.write('0000000\0', 116);
    block.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
    block.write('00000000000\0', 136);
    block.write('        ', 148);
    block[156] = type;
    block.write('ustar\0', 257); block.write('00', 263);
    let sum = 0; for (let index = 0; index < 512; index++) sum += block[index];
    block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    return block;
  };
  for (const name of dirs) parts.push(header(name, 0, 0x35));
  for (const [name, text] of Object.entries(files)) {
    const content = Buffer.from(text, 'utf8');
    parts.push(header(name, content.length), content, Buffer.alloc((512 - (content.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}
const packedFiles = {
  'package/package.json': JSON.stringify({ name: 'oma-packed',
    pi: { extensions: ['./e.ts'], skills: ['./skills/roll/SKILL.md'] } }),
  'package/e.ts': 'export default function () {}\n',
  'package/skills/roll/SKILL.md': '# roll\n',
};
const packedDirs = ['package/', 'package/skills/', 'package/skills/roll/'];

for (const ext of ['tgz', 'tar']) {
  test(`DR25/C20: local archive install (darwin): a .${ext} stages through host file effects, never Linux containment`, async t => {
    const root = fixture(t), store = path.join(root, 'packages');
    fs.mkdirSync(store, { recursive: true });
    const source = path.join(root, `packed.${ext}`);
    const bytes = tarball(packedFiles, packedDirs);
    fs.writeFileSync(source, ext === 'tgz' ? zlib.gzipSync(bytes) : bytes);
    const api = load('darwin');
    assert.equal(await api.stageLocalPackage(store, source), 'local/oma-packed');
    assert.equal(fs.readFileSync(path.join(store, 'local', 'oma-packed', 'e.ts'), 'utf8'), packedFiles['package/e.ts']);
    assert.equal(fs.readFileSync(path.join(store, 'local', 'oma-packed', 'skills', 'roll', 'SKILL.md'), 'utf8'), '# roll\n');
    // The inflated archive's spool went with the call: nothing staging-named
    // is live content, and a crash's leftover is the sweep's, not a package.
    assert.equal(fs.readdirSync(store).some(name => name.startsWith('.staging-local-')), false,
      'the archive spool went with the call');
  });
}
test('DR25/C20: a refused local archive (darwin) still gives its spool back', async t => {
  const root = fixture(t), store = path.join(root, 'packages');
  fs.mkdirSync(store, { recursive: true });
  const source = path.join(root, 'bad.tgz');
  fs.writeFileSync(source, zlib.gzipSync(tarball({ 'a/': 'x' })));
  const api = load('darwin');
  await assert.rejects(api.stageLocalPackage(store, source), /not a normalized relative path/);
  assert.equal(fs.readdirSync(store).some(name => name.startsWith('.staging-local-')), false,
    'a refused archive leaves no spool behind');
});
