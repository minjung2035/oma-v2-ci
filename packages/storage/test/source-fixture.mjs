// Controlled syscall/boot observations around the ACTUAL source owner; no production injection API.
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as descriptors from '@oma/file-descriptors';
import * as posix from '@oma/native/posix-files';
import * as files from '@oma/native/files';
import * as cleanup from '@oma/native/cleanup';
import * as linux from '@oma/native/linux';
import * as namespace from '@oma/native/pid-namespace';
import * as errors from '@oma/domain/errors';
import * as utf8 from '@oma/domain/utf8';
import * as directory from '../dist/directory.js';
import * as durable from '../dist/durable-fs.js';
import * as staging from '../dist/package-staging.js';
import * as journal from '../dist/execution-journal.js';
import { Script } from 'node:vm';
import ts from 'typescript';
const dependencies = {
  'node:fs': fs, 'node:crypto': crypto, 'node:path': path,
  '@oma/file-descriptors': descriptors, '@oma/native/posix-files': posix, '@oma/native/files': files,
  '@oma/native/cleanup': cleanup, '@oma/native/linux': linux, '@oma/native/pid-namespace': namespace,
  '@oma/domain/errors': errors, '@oma/domain/utf8': utf8,
  './directory.js': directory, './durable-fs.js': durable, './package-staging.js': staging, './execution-journal.js': journal,
};
export function controlledSource(name, overrides = {}) {
  const url = new URL(`../src/${name}.ts`, import.meta.url), exports = {};
  const javascript = ts.transpileModule(fs.readFileSync(url, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Script(javascript, { filename: url.pathname }).runInNewContext({
    exports, Buffer, process, console,
    require(name) {
      if (!Object.hasOwn(dependencies, name)) throw new Error(`Uncontrolled source dependency: ${name}`);
      const actual = dependencies[name]; return Object.hasOwn(overrides, name) ? { ...actual, ...overrides[name](actual) } : actual;
    },
  });
  return exports;
}
