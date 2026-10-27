import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
test('descriptor pruning retains exact channels and closes actual FDs above a lowered soft limit',()=>{
  const root=mkdtempSync(join(tmpdir(),'oma-kept-fds-'));
  try {
    const header=fileURLToPath(new URL('../packages/platform-mac/src/seatbelt/',import.meta.url));
    const fixture=fileURLToPath(new URL('./fixtures/descriptor-prune-control.c',import.meta.url));
    const binary=join(root,'prune'),canary=join(root,'canary');writeFileSync(canary,'fixture-owned inode');
    const compiled=spawnSync(process.platform==='darwin'?'/usr/bin/xcrun':'/usr/bin/cc',
      [...(process.platform==='darwin'?['clang']:[]),'-Wall','-Wextra','-Werror','-I',header,fixture,'-o',binary],{encoding:'utf8',timeout:30000});
    assert.equal(compiled.error,undefined);assert.equal(compiled.signal,null);assert.equal(compiled.status,0,compiled.stderr);
    const observe=list=>spawnSync(binary,[canary,list],{encoding:'utf8',timeout:10000});
    const negative=observe('negative-control');assert.equal(negative.status,3,negative.stderr);
    assert.equal(JSON.parse(negative.stdout).outsideSoftLimitOpen,true,'the real canary above RLIMIT must be detected before cleanup');
    const positive=observe('6,8');assert.equal(positive.error,undefined);assert.equal(positive.signal,null);assert.equal(positive.status,0,positive.stderr);
    assert.deepEqual(JSON.parse(positive.stdout),{kept:true,outsideSoftLimitOpen:false,lowClosed:true,inheritable:true});
    for(const malformed of ['', '3','0','-6','+6','06','8,6','6,6','6,','6 8','6,,8','2147483647','999999999999999999999999','5']){
      const refused=observe(malformed);assert.equal(refused.status,125,`${malformed}: ${refused.stderr}`);assert.match(refused.stderr,/descriptor policy/);
    }
  }finally{rmSync(root,{recursive:true,force:true});}
});
