/** Direct fixed-producer candidate only; not a Society lease backend. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {machoImageCdHashes} from '@oma/native/darwin-macho-image';

test('001. Direct suspended fixed producer authenticates before release and publishes its fresh socket',{timeout:90000},t=>{
 if(process.platform!=='darwin'){t.diagnostic('NOT_RUN: Darwin direct fixed producer candidate');return;}
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-fence-direct-')));
 t.after(()=>rmSync(root,{recursive:true}));
 const producer=join(root,'producer'),controller=join(root,'controller');
 const run=(program,args)=>{const result=spawnSync(program,args,{encoding:'utf8',timeout:30000});assert.equal(result.error,undefined);assert.equal(result.signal,null,result.stderr);assert.equal(result.status,0,result.stderr);return result;};
 const fixture=name=>fileURLToPath(new URL('./fixtures/'+name,import.meta.url));
 run('/usr/bin/clang',['-Wall','-Wextra','-Werror',fixture('darwin-fence-producer-candidate.c'),'-o',producer]);
 run('/usr/bin/clang',['-Wall','-Wextra','-Werror',fixture('darwin-fence-direct-candidate.c'),'-framework','Security','-framework','CoreFoundation','-lproc','-o',controller]);
 // The producer receives no entitlement or loader/debug exception.
 for(const image of[producer,controller]){run('/usr/bin/codesign',['--force','--sign','-','--options','runtime',image]);run('/usr/bin/codesign',['--verify','--strict',image]);}
 const hashes=machoImageCdHashes(readFileSync(producer),process.arch==='arm64'?'arm64':'x64');assert.equal(hashes.length,1);
 for(const peer of ['bootstrap-peer','bootstrap-discovery']){
 const mode=peer==='bootstrap-discovery'?[peer]:[];
 const refused=run(controller,[producer,randomBytes(32).toString('hex'),'0'.repeat(40),...mode]);
 assert.deepEqual(JSON.parse(refused.stdout),{matched:false,released:false,childReaped:true});
 t.diagnostic(JSON.stringify({phase:'direct-producer-refusal',peer,security:refused.stderr.trim()}));
 const accepted=run(controller,[producer,randomBytes(32).toString('hex'),hashes[0],...mode]);
 assert.deepEqual(JSON.parse(accepted.stdout),{matched:true,released:true,kernelSender:true,instanceMatched:true,creatorLiveAcrossLastClose:true,childReaped:true,...(peer==='bootstrap-discovery'?{discoveryAuthenticated:true}:{})});
 t.diagnostic(JSON.stringify({phase:'direct-producer-accepted',peer,security:accepted.stderr.trim(),productionAdopted:false,ownerLossQualified:false}));
 }
});
