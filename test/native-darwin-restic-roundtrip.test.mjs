/** Actual pinned Restic on Darwin: which restored metadata the storage verifier can rely on. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,existsSync,lutimesSync,mkdirSync,mkdtempSync,realpathSync,rmSync,symlinkSync,utimesSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {managedResticPath} from '@oma/storage/restic-tool';
import {digestCacheTrees} from '@oma/storage/cache-trees';

test('001. A pinned Restic backup and restore reproduces every entry the storage verifier digests',{timeout:120000},async t=>{
 if(process.platform!=='darwin'){t.diagnostic('NOT_RUN: actual Darwin Restic round trip');return;}
 const restic=process.env.OMA_RESTIC_COMMAND??managedResticPath();
 if(!restic||!existsSync(restic)){t.diagnostic('NOT_RUN: the pinned Restic is not installed (npm run setup:storage)');return;}
 const base=realpathSync(mkdtempSync(join(tmpdir(),'oma-restic-roundtrip-'))),source=join(base,'source');
 t.after(()=>rmSync(base,{recursive:true,force:true}));
 mkdirSync(join(source,'tree','nested'),{recursive:true});
 writeFileSync(join(source,'tree','file'),'data\n');chmodSync(join(source,'tree','file'),0o640);
 writeFileSync(join(source,'tree','exec'),'#!/bin/sh\n');chmodSync(join(source,'tree','exec'),0o755);
 writeFileSync(join(source,'tree','nested','deep'),'deep\n');
 symlinkSync('file',join(source,'tree','link'));
 const at=new Date(1700000000123);
 for(const path of ['tree/file','tree/exec','tree/nested/deep','tree/nested','tree'])utimesSync(join(source,path),at,at);
 lutimesSync(join(source,'tree','link'),at,at);utimesSync(join(source,'tree'),at,at);
 const env={PATH:'/usr/bin:/bin',HOME:base,RESTIC_PASSWORD:'roundtrip-password',RESTIC_REPOSITORY:join(base,'repository')};
 const run=args=>{const result=spawnSync(restic,[...args,'--no-cache','--quiet'],{cwd:source,env,encoding:'utf8',timeout:60000});
  assert.equal(result.status,0,`restic ${args.join(' ')}: ${result.stderr}`);return result.stdout;};
 run(['init']);run(['backup','tree']);run(['restore','latest','--target',join(base,'restored')]);
 const before=await digestCacheTrees(source,['tree']),after=await digestCacheTrees(join(base,'restored'),['tree']);
 const differences=[...before.metadata].flatMap(([path,value])=>{const restored=after.metadata.get(path);
  return JSON.stringify(restored)===JSON.stringify(value)?[]:[{path,original:value,restored}];});
 assert.deepEqual(differences,[],JSON.stringify(differences,null,1));
 assert.equal(after.digest,before.digest);
});
