/** Shared metadata contract. The Darwin branch is exercised with local files,
 * not a native macOS attestation, VM, user manager, credential or provider. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { Script } from 'node:vm';
import ts from 'typescript';
import * as errors from "@oma/domain/errors";
import * as utf8 from "@oma/domain/utf8";
import * as assets from "@oma/native/directory-layout";
import * as contained from "@oma/native/files";
import * as durable from "@oma/storage/durable-fs";
import * as cleanup from "@oma/native/cleanup";

const code = ts.transpileModule(fs.readFileSync(process.env.OMA_USER_FILES_SOURCE ?? 'apps/oma/src/runtime/user-files.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function load(platform, changes = {}) {
  const module = { exports: {} };
  const dependencies = { 'node:fs': fs, 'node:path': path, '@oma/domain/errors': errors,
    '@oma/domain/utf8': utf8, '@oma/native/directory-layout': assets, "@oma/native/files": contained,
    "@oma/storage/durable-fs": durable, "@oma/native/cleanup": cleanup, ...changes };
  new Script(code).runInNewContext({ module, exports: module.exports, Buffer, process: { platform },
    require(name) { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; } });
  return module.exports;
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'oma-user-files-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root;
}
for (const platform of ['linux', 'darwin']) {
  test(`user files ${platform}: absence, whole publication, conflict and derived replacement`, t => {
    const root = fixture(t), api = load(platform), dir = path.join(root, 'new', 'nested'), file = path.join(dir, 'record.json');
    assert.equal(api.readUserFile(file, 64), null);
    api.ensureUserDirectory(dir);
    assert.equal(api.publishUserFile(file, 'first'), 'created');
    assert.equal(api.publishUserFile(file, 'second'), 'existing');
    assert.equal(api.readUserFile(file, 64), 'first');
    api.replaceUserFile(file, 'derived'); assert.equal(api.readUserFile(file, 64), 'derived');
    assert.deepEqual(fs.readdirSync(dir), ['record.json']);
  });
  test(`user files ${platform}: malformed and excessive bytes are not absence`, t => {
    const root = fixture(t), api = load(platform), file = path.join(root, 'file');
    for (const bytes of [Buffer.from([255]), Buffer.alloc(65, 65)]) {
      fs.writeFileSync(file, bytes); assert.throws(() => api.readUserFile(file, 64), { code: 'STORE_CORRUPT' });
    }
    assert.throws(() => api.readUserFile(file, 0), { code: 'INTERNAL_ERROR' });
    assert.throws(() => api.readUserFile(root, 64), { code: 'STORE_CORRUPT' });
  });
  test(`user files ${platform}: neither file nor parent symlinks are followed`, t => {
    const root = fixture(t), api = load(platform), real = path.join(root, 'real'), linked = path.join(root, 'linked');
    fs.mkdirSync(real); fs.writeFileSync(path.join(real, 'record'), 'unchanged'); fs.symlinkSync(real, linked);
    assert.throws(() => api.ensureUserDirectory(path.join(linked, 'new')));
    assert.throws(() => api.readUserFile(path.join(linked, 'record'), 64));
    fs.symlinkSync(path.join(real, 'record'), path.join(root, 'record'));
    assert.throws(() => api.readUserFile(path.join(root, 'record'), 64));
    assert.equal(fs.readFileSync(path.join(real, 'record'), 'utf8'), 'unchanged');
  });
  test(`user files ${platform}: immutable publication may retain a temporary hardlink; mutable settings may not`, t => {
    const root = fixture(t), file = path.join(root, 'record'), temporary = path.join(root, '.record.partial');
    fs.writeFileSync(temporary, 'first'); fs.linkSync(temporary, file); let returned = 0;
    const api = load(platform, { 'node:fs': { ...fs, closeSync(fd) { returned++; fs.closeSync(fd); } } });
    let saved;
    assert.doesNotThrow(() => { saved = api.readUserFile(file, 64); }, 'a leftover publication name does not change the fact');
    assert.equal(saved, 'first');
    assert.throws(() => api.readUserFile(file, 64, { singleName: true }), { code: 'UNSUPPORTED_PROFILE' });
    assert.equal(returned, 2, 'both readers return their descriptor');
    assert.equal(fs.readFileSync(temporary, 'utf8'), 'first');
    fs.unlinkSync(temporary);
    assert.equal(api.readUserFile(file, 64, { singleName: true }), 'first');
  });
  test(`user files ${platform}: IO failure is not an absent or corrupt record`, t => {
    const root = fixture(t), file = path.join(root, 'record'); fs.writeFileSync(file, 'first');
    const problem = Object.assign(new Error('unavailable'), { code: 'EIO' });
    const api = load(platform, { 'node:fs': { ...fs, readSync() { throw problem; } } });
    assert.throws(() => api.readUserFile(file, 64), error => error === problem);
  });
  test(`user files ${platform}: first-line bound counts bytes, not conversation size or decoded characters`, t => {
    const root = fixture(t), api = load(platform), file = path.join(root, 'history');
    for (const bytes of ['x'.repeat(64), 'x'.repeat(64) + '\n' + 'body'.repeat(1024), 'é'.repeat(32) + '\nbody']) {
      fs.writeFileSync(file, bytes);
      assert.equal(api.readUserFile(file, 64, { firstLine: true }), bytes.split('\n')[0]);
      assert.equal(fs.readFileSync(file, 'utf8'), bytes, 'header observation never rewrites history');
    }
    for (const bytes of ['x'.repeat(65) + '\nbody', 'é'.repeat(33) + '\nbody', Buffer.from([0xc3, 0x0a])]) {
      fs.writeFileSync(file, bytes);
      assert.throws(() => api.readUserFile(file, 64, { firstLine: true }), { code: 'STORE_CORRUPT' });
    }
    fs.writeFileSync(file, Buffer.concat([Buffer.from('header\n'), Buffer.from([255])]));
    assert.equal(api.readUserFile(file, 64, { firstLine: true }), 'header', 'the body remains the engine parser\'s responsibility');
  });
  test(`user files ${platform}: a split first line reads through UTF-8 and newline boundaries`, t => {
    const root = fixture(t), file = path.join(root, 'history'); let reads = 0, returned = 0;
    const bytes = 'x'.repeat(4095) + 'é\n' + 'body'.repeat(4096); fs.writeFileSync(file, bytes);
    const api = load(platform, { 'node:fs': { ...fs,
      readSync(...args) { reads++; assert.ok(args[3] <= 4096); return fs.readSync(...args); },
      closeSync(fd) { returned++; fs.closeSync(fd); },
    } });
    assert.equal(api.readUserFile(file, 8192, { firstLine: true }), 'x'.repeat(4095) + 'é');
    assert.equal(reads, 2); assert.equal(returned, 1);
  });
  test(`user files ${platform}: first-line IO failure and concurrent change return their descriptor without inventing absence`, t => {
    const root = fixture(t), file = path.join(root, 'history'); fs.writeFileSync(file, 'header\nbody');
    const problem = Object.assign(new Error('fixture unavailable'), { code: 'EIO' }); let returned = 0;
    const api = load(platform, { 'node:fs': { ...fs,
      readSync() { throw problem; }, closeSync(fd) { returned++; fs.closeSync(fd); },
    } });
    assert.throws(() => api.readUserFile(file, 64, { firstLine: true }), error => error === problem);
    assert.equal(returned, 1);
    const changed = load(platform, { 'node:fs': { ...fs, readSync(...args) {
      const count = fs.readSync(...args); fs.appendFileSync(file, 'changed'); return count;
    }, closeSync(fd) { returned++; fs.closeSync(fd); } } });
    assert.throws(() => changed.readUserFile(file, 64, { firstLine: true }), { code: 'STORE_CORRUPT' });
    assert.equal(returned, 2);
  });
  test(`user files ${platform}: a growing file is refused with bounded reads`, t => {
    const root = fixture(t), file = path.join(root, 'record'); fs.writeFileSync(file, 'first'); let calls = 0;
    const api = load(platform, { 'node:fs': { ...fs, readSync(...args) {
      if (++calls === 1) fs.appendFileSync(file, 'growing'); return fs.readSync(...args);
    } } });
    assert.throws(() => api.readUserFile(file, 64), { code: 'STORE_CORRUPT' }); assert.equal(calls, 1);
  });
}
for (const platform of ['linux', 'darwin']) for (const failed of [false, true])
  test(`user files ${platform}: ${failed ? 'read and' : 'only'} close failure is not absence or success`, t => {
    const root = fixture(t), file = path.join(root, 'record'); fs.writeFileSync(file, 'first');
    const primary = Object.assign(new Error('fixture read failed'), { code: 'EIO' });
    const secondary = Object.assign(new Error('fixture close failed'), { code: 'ENOENT' }); let returned = 0;
    const api = load(platform, { 'node:fs': { ...fs,
      readSync(...args) { if (failed) throw primary; return fs.readSync(...args); },
      closeSync(fd) { returned++; fs.closeSync(fd); throw secondary; },
    } });
    assert.throws(() => api.readUserFile(file, 64), error => {
      if (!failed) return error === secondary;
      assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [primary, secondary]); return true;
    });
    assert.equal(returned, 1); assert.equal(fs.readFileSync(file, 'utf8'), 'first');
  });

for (const visible of [false, true]) for (const cleanupFailed of [false, true])
  test(`shared metadata publication: ${visible ? 'visible' : 'pre-link'} primary and cleanup retain knowledge on retry (${cleanupFailed})`, t => {
    const root = fixture(t), file = path.join(root, 'record');
    const primary = new Error('publication failed'), secondary = new Error('cleanup failed');
    let armed = true;
    const api = load(process.platform, { '@oma/storage/durable-fs': { ...durable,
      publishNoReplace(target, bytes) {
        return durable.publishNoReplace(target, bytes, 0o600, fault => {
          if (!armed) return;
          if (fault.point === 'publication-link' && fault.phase === (visible ? 'after-visible' : 'before')) throw primary;
          if (cleanupFailed && fault.point === 'temporary-cleanup' && fault.phase === 'before') throw secondary;
        });
      },
    } });
    assert.throws(() => api.publishUserFile(file, 'first'), error => {
      if (!cleanupFailed) return error === primary;
      assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [primary, secondary]); return true;
    });
    assert.equal(fs.existsSync(file), visible);
    armed = false;
    assert.equal(api.publishUserFile(file, 'second'), visible ? 'existing' : 'created');
    assert.equal(api.readUserFile(file, 64), visible ? 'first' : 'second');
  });
