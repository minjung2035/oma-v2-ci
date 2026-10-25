/** Local physical I/O and installed native assets; no Mac/VM qualification. */
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const hook = registerHooks({resolve(name, context, next) {
  assert.notEqual(name, 'node:sqlite', 'native platform APIs loaded the ledger'); return next(name, context);
}});
const root = mkdtempSync(join(tmpdir(), 'oma-installed-mac-'));
try {
  const { MAC_HELPER_SOURCES } = await import('@oma/platform-mac/native-assets');
  const { replaceFile } = await import('@oma/platform-mac/files');
  const { encryptArchive, decryptArchive } = await import('@oma/platform-mac/archive-crypto');
  assert.match(readFileSync(join(MAC_HELPER_SOURCES, 'Package.swift'), 'utf8'), /oma-vmhelper/);
  assert.match(readFileSync(join(MAC_HELPER_SOURCES, 'Sources/oma-vmhelper/main.swift'), 'utf8'), /Virtualization/);
  replaceFile(root, 'record', 'exact committed bytes'); assert.equal(readFileSync(join(root, 'record'), 'utf8'), 'exact committed bytes');
  const plain=join(root,'plain'), sealed=join(root,'sealed'), opened=join(root,'opened'), key=Buffer.alloc(32,17);
  writeFileSync(plain, 'private archive'); encryptArchive(plain,sealed,key); decryptArchive(sealed,opened,key);
  assert.equal(readFileSync(opened,'utf8'), 'private archive');
  assert.equal(readFileSync(sealed).includes(Buffer.from('private archive')), false);
  for(const absent of ['@oma/engine','@oma/client','@oma/config','@oma/tui','@oma/broker'])
    assert.throws(() => import.meta.resolve(absent), {code:'ERR_MODULE_NOT_FOUND'});
} finally { hook.deregister(); rmSync(root,{recursive:true,force:true}); }
