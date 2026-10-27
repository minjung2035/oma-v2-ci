import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
test('descriptor keep-list grammar rejects reserved, unordered and overflowing channels',()=>{
  const root=mkdtempSync(join(tmpdir(),'oma-kept-fds-'));
  try {
    const header=fileURLToPath(new URL('../packages/platform-mac/src/seatbelt/',import.meta.url));
    const fixture=fileURLToPath(new URL('./fixtures/descriptor-policy-parse.c',import.meta.url));
    const binary=join(root,'parse');
    const compiled=spawnSync(process.platform==='darwin'?'/usr/bin/xcrun':'/usr/bin/cc',
      [...(process.platform==='darwin'?['clang']:[]),'-Wall','-Wextra','-Werror','-I',header,fixture,'-o',binary],{encoding:'utf8',timeout:30000});
    assert.equal(compiled.error,undefined);assert.equal(compiled.signal,null);assert.equal(compiled.status,0,compiled.stderr);
    const observe=list=>spawnSync(binary,[list],{encoding:'utf8',timeout:10000});
    for(const list of ['4','5','6,8','4,6,8,9','2147483646']){
      const positive=observe(list);assert.equal(positive.error,undefined);assert.equal(positive.signal,null);assert.equal(positive.status,0,positive.stderr);
      assert.deepEqual(JSON.parse(positive.stdout),list.split(',').map(Number));
    }
    for(const malformed of ['', '3','0','-6','+6','06','8,6','6,6','6,','6 8','6,,8','2147483647','999999999999999999999999']){
      const refused=observe(malformed);assert.equal(refused.status,125,`${malformed}: ${refused.stderr}`);assert.match(refused.stderr,/descriptor policy/);
    }
  }finally{rmSync(root,{recursive:true,force:true});}
});
