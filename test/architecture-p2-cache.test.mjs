import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {publicDownloads,downloadCacheKey,ensureDownloadCache,fillDownloadCache,readDownloadCache} from '@oma/git/download-cache';
test("001. Download cache: scope/toolchain/setup keys differ, corruption misses, and only anonymous integrity-pinned public tarballs qualify",async t=>{
 const root=mkdtempSync(join(tmpdir(),'oma-cache-'));t.after(()=>rmSync(root,{recursive:true}));const payload=Buffer.from('opaque public tarball'),integrity='sha512-'+createHash('sha512').update(payload).digest('base64');
 const lock=Buffer.from(JSON.stringify({packages:{a:{resolved:'https://registry.npmjs.org/example/-/example-1.tgz',integrity},b:{resolved:'https://token@registry.npmjs.org/private/-/p.tgz',integrity},c:{resolved:'https://private.example/p.tgz',integrity},d:{resolved:'file:../private',integrity},e:{resolved:'https://registry.npmjs.org/p.tgz?token=private',integrity}}}));
 const downloads=publicDownloads(lock);assert.equal(downloads.length,1);const policy={version:2,setupSteps:[],checkSteps:[],env:{},toolchainDigest:'a'.repeat(64),cachePolicy:{kind:'npm-downloads',trustScope:'one',lockfile:'package-lock.json'}};
 const key=downloadCacheKey('/repo',policy,lock,'npm@1');for(const other of [downloadCacheKey('/another',policy,lock,'npm@1'),downloadCacheKey('/repo',{...policy,toolchainDigest:'b'.repeat(64)},lock,'npm@1'),downloadCacheKey('/repo',policy,lock,'npm@2')])assert.notEqual(key,other);
 const dir=ensureDownloadCache(root,key);let calls=0;await fillDownloadCache(dir,key,downloads,async()=>{calls++;return new Response(payload)});let hit=readDownloadCache(dir,key,downloads);assert.equal(hit.entries.length,1);assert.equal(calls,1);
 writeFileSync(join(dir,hit.entries[0].file),'corrupted');assert.equal(readDownloadCache(dir,key,downloads),null);
 await fillDownloadCache(dir,key,downloads,async()=>new Response(payload));assert.equal(readDownloadCache(dir,key,downloads).entries.length,1);
 await fillDownloadCache(dir,key,downloads,async()=>new Response('wrong integrity'));assert.equal(readDownloadCache(dir,key,downloads).entries.length,0);
});
