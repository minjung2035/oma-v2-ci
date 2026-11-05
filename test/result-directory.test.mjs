/** Actual immutable-result I/O after directory name replacement. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {closeSync,existsSync,fstatSync,mkdirSync,mkdtempSync,openSync,readFileSync,readdirSync,realpathSync,renameSync,rmSync,rmdirSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createResult,readResult} from '@oma/tool-files/results';

test('001. Result completion flushes the directory originally opened by its writer after rename',t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-result-parent-'))),original=join(root,'original'),moved=join(root,'moved');mkdirSync(original);
 t.after(()=>rmSync(root,{recursive:true}));
 const writer=createResult(original);t.after(()=>writer.close());writer.append(Buffer.from('retained result bytes'));
 renameSync(original,moved);const result=writer.finish(),name=writer.path.split('/').at(-1);
 assert.equal(readFileSync(join(moved,name),'utf8'),'retained result bytes');assert.equal(existsSync(original),false);
 assert.equal(readResult(moved,result.reference).text,'retained result bytes');writer.close();
});

test('002. Explicit result directory controls retain original-only creation and reads after replacement',t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-result-control-'))),original=join(root,'original'),moved=join(root,'moved');mkdirSync(original);
 const directory=openSync(original,'r'),identity=fstatSync(directory),cwd=process.cwd();t.after(()=>{closeSync(directory);rmSync(root,{recursive:true});});
 renameSync(original,moved);mkdirSync(original);
 const controls={directoryFd:directory},writer=createResult(original,undefined,controls);t.after(()=>writer.close());writer.append(Buffer.from('original capability'));
 const result=writer.finish();assert.deepEqual(readdirSync(original),[]);assert.equal(readdirSync(moved).length,1);
 assert.equal(readResult(original,result.reference,{},controls).text,'original capability');assert.throws(()=>readResult(original,result.reference),error=>error.code==='ENOENT');
 assert.equal(fstatSync(directory).ino,identity.ino);assert.equal(process.cwd(),cwd);
});

test('003. A failed borrowed result directory is never replaced with the diagnostic pathname',t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-result-bad-control-')));t.after(()=>rmSync(root,{recursive:true}));
 const directory=openSync(root,'r');closeSync(directory);
 assert.throws(()=>createResult(root,undefined,{directoryFd:directory}));assert.deepEqual(readdirSync(root),[]);
});

test('004. Removed result and directory names cannot produce a successful publication reference',t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-result-removed-'))),directory=join(root,'result');mkdirSync(directory);t.after(()=>rmSync(root,{recursive:true}));
 const writer=createResult(directory);t.after(()=>writer.close());writer.append(Buffer.from('removed'));
 unlinkSync(writer.path);rmdirSync(directory);assert.throws(()=>writer.finish(),/removed/);writer.close();
});
