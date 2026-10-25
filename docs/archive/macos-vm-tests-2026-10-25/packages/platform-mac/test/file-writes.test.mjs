import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as layout from '@oma/native/directory-layout';
import * as errors from '@oma/domain/errors';
import * as cleanup from '@oma/native/cleanup';
import * as native from '@oma/native/linux';
import * as preparation from '@oma/git/project-preparation';
import { Script } from 'node:vm';
import ts from 'typescript';
const imports = {"node:crypto":crypto,"node:path":path,"@oma/native/directory-layout":layout,"@oma/domain/errors":errors,"@oma/native/cleanup":cleanup,"@oma/native/linux":native,"@oma/git/project-preparation":preparation};
const source = ts.transpileModule(fs.readFileSync(new URL('../src/files.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function owner(write) {
  const module = { exports: {} }, closed = [];
  new Script(source).runInNewContext({ module, exports: module.exports, Buffer,
    require(name) { return name === 'node:fs' ? { ...fs, writeSync: write,
      closeSync(fd) { closed.push(fd); fs.closeSync(fd); } } : (assert.ok(Object.hasOwn(imports, name), name), imports[name]); } });
  return { ...module.exports, closed };
}
for (const zero of [false, true]) test(`Mac file owner: ${zero ? 'no progress refuses and cleans' : 'short writes publish exact bytes'}`, t => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'oma-mac-writes-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'record'); fs.writeFileSync(path, 'original');
  let writes = 0, descriptor;
  const api = owner((fd, bytes, offset, count) => { descriptor = fd; writes++;
    return zero ? 0 : fs.writeSync(fd, bytes, offset, Math.min(count, 2)); });
  if (zero) assert.throws(() => api.replaceFile(dir, 'record', 'replacement'), { code: 'EIO' });
  else api.replaceFile(dir, 'record', 'replacement');
  assert.equal(fs.readFileSync(path, 'utf8'), zero ? 'original' : 'replacement');
  assert.deepEqual(fs.readdirSync(dir), ['record'], 'no abandoned temporary remains');
  assert.equal(api.closed.length, zero ? 1 : 2, 'temporary and successful directory flush each release their own hold');
  assert.throws(() => fs.fstatSync(descriptor), { code: 'EBADF' });
  if (zero) assert.equal(writes, 1); else assert.ok(writes > 1);
});
test('Mac raw file writer does not own or close its caller descriptor', t => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'oma-mac-writer-fd-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fd = fs.openSync(join(dir, 'bytes'), 'wx');
  try {
    const api = owner(() => 0);
    assert.throws(() => api.writeHostBytes(fd, Buffer.from('x')), { code: 'EIO' });
    assert.ok(fs.fstatSync(fd).isFile()); assert.deepEqual(api.closed, []);
  } finally { fs.closeSync(fd); }
});
