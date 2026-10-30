/** Controlled mkdir errno, real held-descriptor observation. Not a kernel errno diagnosis. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, lstatSync, symlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { Script } from 'node:vm';
import ts from 'typescript';
import * as descriptors from '@oma/file-descriptors';
const actual = createRequire(new URL('../packages/storage/dist/directory.js',import.meta.url));
function owner(code) {
  let calls=0;
  const exports={};
  const source=ts.transpileModule(readFileSync('packages/storage/src/directory.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2023}}).outputText;
  new Script(source).runInNewContext({exports,process,Buffer,require(name){
    if(name==='@oma/file-descriptors') return {...descriptors,mkdirAt(fd,name,mode){
      if(name==='target'){calls++;throw Object.assign(new Error('controlled mkdir observation'),{code});}
      return descriptors.mkdirAt(fd,name,mode);
    }};
    return actual(name);
  }});
  return {ensure:exports.ensureOwnedDirectory,calls:()=>calls};
}
for(const kind of ['present','missing','link','denied']) test(`IMP-F01: uncertain mkdir ${kind} requires positive held-directory evidence`,()=>{
  const root=mkdtempSync('/tmp/oma-directory-evidence-'),target=join(root,'target');
  try {
    if(kind==='present'||kind==='denied'){mkdirSync(target);writeFileSync(join(target,'payload'),'preserved');}
    if(kind==='link'){mkdirSync(join(root,'outside'));writeFileSync(join(root,'outside','payload'),'outside');symlinkSync('outside',target);}
    const before=existsSync(target)?lstatSync(target).ino:null;
    const f=owner(kind==='denied'?'EACCES':'EAGAIN');
    if(kind==='present'){
      assert.deepEqual(Array.from(f.ensure(target,root)),[]);
      assert.equal(lstatSync(target).ino,before);assert.equal(readFileSync(join(target,'payload'),'utf8'),'preserved');
    } else {
      assert.throws(()=>f.ensure(target,root),error=>kind==='denied'?error.code==='EACCES':
        error.name==='AggregateError'&&error.errors.length===2&&error.errors[0].code==='EAGAIN');
      if(kind==='missing')assert.equal(existsSync(target),false);
      if(kind==='link'){assert.equal(lstatSync(target).ino,before);assert.equal(lstatSync(target).isSymbolicLink(),true);assert.equal(readFileSync(join(root,'outside','payload'),'utf8'),'outside');}
    }
    assert.equal(f.calls(),1,'no unbounded retries or uncertain leaf replacement');
  } finally {rmSync(root,{recursive:true,force:true});}
});
