import * as posixFiles from "@oma/native/posix-files";
/** Actual publication owner and real local FDs, with controlled I/O failures. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as errors from '@oma/domain/errors';
import * as fileDigest from '@oma/storage/file-digest';
import * as directory from '@oma/storage/directory';
import * as cleanup from '@oma/native/cleanup';
import * as config from '../dist/index.js';
import * as operations from '../dist/operations.js';
import * as stateFormat from '../dist/state-format.js';
import { Script } from 'node:vm';
import ts from 'typescript';
import * as native from '@oma/native/files';
import * as durable from '@oma/storage/durable-fs';
import { removeOwnedTree } from '@oma/storage/directory';
import { StoreError, primaryFailure, errorCodeOf } from '@oma/domain/errors';
const source = fs.readFileSync(new URL('../src/generations.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText + '\nexports.publishForProbe = publishGeneration;';
for (const effectFails of [false, true]) for (const failures of [[], ['roles'], ['prompts'], ['roles', 'prompts', 'tree']]) {
  test(`Generation cleanup: effect=${effectFails}, failed closes=${failures.join(',') || 'none'} retain every owner and primary`, () => {
    const root = fs.mkdtempSync(join(tmpdir(), 'oma-generation-cleanup-')), generations = join(root, 'generations');
    fs.mkdirSync(generations);
    const held = new Map(), attempted = [], closeErrors = new Map(failures.map(name => [name, Object.assign(new Error(`close ${name}`), { code: 'EIO' })]));
    const primary = new StoreError('STORE_CORRUPT', 'original publication failure');
    const deps = {
      '@oma/native/posix-files': posixFiles,
      'node:fs': { ...fs, closeSync(fd) {
        const name = held.get(fd); attempted.push(name); fs.closeSync(fd);
        if (closeErrors.has(name)) throw closeErrors.get(name);
      } },
      '@oma/native/files': { ...native, openBeneath(parent, path, flags) {
        const fd = native.openBeneath(parent, path, flags); held.set(fd, ['roles', 'prompts'].includes(path) ? path : 'tree'); return fd;
      } },
      '@oma/storage/durable-fs': { ...durable, writeExclusiveFsyncedEntry(...args) {
        if (effectFails) throw primary; return durable.writeExclusiveFsyncedEntry(...args);
      } },
      'node:crypto': crypto, 'node:path': path, '@oma/domain/errors': errors,
      '@oma/storage/file-digest': fileDigest, '@oma/storage/directory': directory, '@oma/native/cleanup': cleanup,
      './index.js': config, './operations.js': operations, './state-format.js': stateFormat,
    };
    const module = { exports: {} };
    new Script(code).runInNewContext({ module, exports: module.exports, Buffer, AggregateError, process,
      require(name) { assert.ok(Object.hasOwn(deps, name), name); return deps[name]; } });
    let caught;
    try {
      try { module.exports.publishForProbe(generations, `g-${'a'.repeat(64)}`, new Map([['roles/principal.json', Buffer.from('{}')]])); }
      catch (error) { caught = error; }
      assert.deepEqual(attempted, ['roles', 'prompts', 'tree']);
      for (const fd of held.keys()) assert.throws(() => fs.fstatSync(fd), { code: 'EBADF' });
      if (effectFails) { assert.equal(primaryFailure(caught), primary); assert.equal(errorCodeOf(caught), 'STORE_CORRUPT'); }
      else if (failures.length) assert.equal(primaryFailure(caught), closeErrors.get(failures[0]));
      else assert.equal(caught, undefined);
      const flatten = error => error instanceof AggregateError ? error.errors.flatMap(flatten) : [error];
      if (effectFails || failures.length) assert.deepEqual(flatten(caught), [...(effectFails ? [primary] : []), ...failures.map(name => closeErrors.get(name))]);
    } finally {
      for (const fd of held.keys()) try { fs.closeSync(fd); } catch (error) { if (error.code !== 'EBADF') throw error; }
      removeOwnedTree(root);
    }
  });
}
