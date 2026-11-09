import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ownedStaging } from '@oma/storage/package-staging';

test('001. Failed descent releases intermediate staging directories on every retry', t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'oma-stage-descent-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const area = ownedStaging(root);
  try {
    area.write('nested/blocked', Buffer.from('file'), false);
    const before = fs.readdirSync('/proc/self/fd').length;
    for (let attempt = 0; attempt < 5; attempt++)
      assert.throws(() => area.make('nested/blocked/child'), { code: 'STORE_CORRUPT' });
    assert.equal(fs.readdirSync('/proc/self/fd').length, before);
    area.write('nested/valid', Buffer.from('still usable'), false);
    assert.equal(fs.readFileSync(join(area.path, 'nested/valid'), 'utf8'), 'still usable');
  } finally { area.close(); }
});

test('002. Failed package directory durability closes its acquired local directory', t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'oma-stage-flush-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const area = ownedStaging(root);
  const original = fs.fsyncSync;
  try {
    area.write('extension.ts', Buffer.from('export default function () {}'), false);
    const before = fs.readdirSync('/proc/self/fd').length;
    let injected = 0;
    fs.fsyncSync = fd => {
      if (fs.readlinkSync(`/proc/self/fd/${fd}`) === join(root, 'local')) {
        injected++;
        throw Object.assign(new Error('injected local durability failure'), { code: 'EIO' });
      }
      return original(fd);
    };
    syncBuiltinESMExports();
    for (let attempt = 0; attempt < 5; attempt++)
      assert.throws(() => area.publish('extension.ts', 'extension.ts'), { code: 'EIO' });
    assert.equal(injected, 5);
    assert.equal(fs.readdirSync('/proc/self/fd').length, before);
    assert.equal(fs.existsSync(join(root, 'local/extension.ts')), false);
  } finally {
    fs.fsyncSync = original;
    syncBuiltinESMExports();
    area.close();
  }
});
