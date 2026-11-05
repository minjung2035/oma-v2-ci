/** Qualification only; the private generation producer still uses its copy. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {closeSync,mkdirSync,mkdtempSync,openSync,readFileSync,readdirSync,realpathSync,renameSync,rmSync,unlinkSync,writeFileSync,writeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {setDarwinUserImmutable} from '@oma/native/darwin-file-flags';

for(const sourceKind of ['renamed','unlinked','immutable'])test(`001. Actual Darwin clone of ${sourceKind} held bytes preserves exclusive publication and independent storage`,t=>{
 if(process.platform!=='darwin'){t.diagnostic('NOT_RUN: Darwin clone candidate');return;}
 const top=realpathSync(mkdtempSync(join(tmpdir(),'oma-clone-candidate-'))),directory=join(top,'destination'),moved=directory+'-moved',source=join(top,'source'),program=join(top,'clone');mkdirSync(directory,{mode:0o700});const bytes=Buffer.alloc(4*1024*1024,0x61);writeFileSync(source,bytes);let fd=openSync(source,'r+'),parent=openSync(directory,'r'),target;
 t.after(()=>{if(target!==undefined){if(sourceKind==='immutable')setDarwinUserImmutable(target,false);closeSync(target);}if(sourceKind==='immutable')setDarwinUserImmutable(fd,false);closeSync(fd);closeSync(parent);rmSync(top,{recursive:true});});
 const built=spawnSync('/usr/bin/clang',['-Wall','-Wextra','-Werror',fileURLToPath(new URL('./fixtures/darwin-clone-copy-candidate.c',import.meta.url)),'-o',program],{encoding:'utf8',timeout:30000});assert.equal(built.error,undefined);assert.equal(built.status,0,built.stderr);
 renameSync(directory,moved);mkdirSync(directory,{mode:0o700});
 if(sourceKind==='renamed')renameSync(source,source+'-moved');if(sourceKind==='unlinked')unlinkSync(source);if(sourceKind==='immutable')setDarwinUserImmutable(fd,true);
 const run=()=>{const r=spawnSync(program,[],{stdio:['ignore','pipe','pipe',fd,parent],encoding:'utf8',timeout:30000});assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
 const observed=run();assert.equal(observed.result,0,JSON.stringify(observed));assert.equal(observed.observed,true);assert.equal(observed.differentInode,true);assert.equal(observed.links,1);target=openSync(join(moved,'copy'),'r');assert.deepEqual(readFileSync(target),bytes);assert.deepEqual(readdirSync(directory),[]);
 const second=run();assert.equal(second.result,-1);assert.equal(second.error,17);assert.deepEqual(readFileSync(join(moved,'copy')),bytes);
 if(sourceKind!=='immutable'){writeSync(fd,Buffer.from('changed'),0,7,0);assert.deepEqual(readFileSync(join(moved,'copy')),bytes);}
 t.diagnostic(JSON.stringify({productionAdopted:false,sourceKind,flags:observed.flags,originalDirectoryOnly:true,independentInode:true,exclusiveWinnerPreserved:true}));
});
