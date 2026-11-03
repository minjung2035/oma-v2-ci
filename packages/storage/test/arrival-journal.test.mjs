import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,appendFileSync,renameSync,utimesSync,chmodSync,statSync,symlinkSync,closeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {openOwnedDirectoryPath} from '@oma/storage/directory';
import {appendMailArrival} from '@oma/storage/arrival-journal';
import {messageIdForOperation} from '@oma/domain/derived';
const id=messageIdForOperation('op-12345678-1234-4123-8123-123456789abc',0);
function inbox(t){
 const root=mkdtempSync(join(tmpdir(),'oma-arrival-owner-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 return root;
}

const otherId=messageIdForOperation('op-12345678-1234-4123-8123-123456789abd',0);
for(const change of ['mtime-preserving rewrite','inode replacement','external complete append']) {
 test(`004. A warm arrival observation rechecks an ${change}`,{timeout:5000},async t=>{
  const root=inbox(t),path=join(root,'arrival'),directory=openOwnedDirectoryPath(root);
  writeFileSync(path,`123 ${id}\n`);utimesSync(path,1,1);
  try{
   appendMailArrival(directory,root,id);
   const before=statSync(path,{bigint:true});
   if(change==='mtime-preserving rewrite'){
    writeFileSync(path,`123 ${otherId}\n`);utimesSync(path,1,1);
    // Wait for an observable metadata tick; filesystems may share ctime across
    // adjacent syscalls. This tests invalidation when evidence changed.
    const deadline=performance.now()+1000;
    while(statSync(path,{bigint:true}).ctimeNs===before.ctimeNs){
     assert.ok(performance.now()<deadline,'filesystem did not expose a changed ctime');
     await new Promise(resolve=>setImmediate(resolve));utimesSync(path,1,1);
    }
    const after=statSync(path,{bigint:true});
    assert.equal(after.ino,before.ino);assert.equal(after.size,before.size);assert.equal(after.mtimeNs,before.mtimeNs);
   }else if(change==='inode replacement'){
    const replacement=join(root,'replacement');writeFileSync(replacement,`123 ${otherId}\n`);utimesSync(replacement,1,1);
    renameSync(replacement,path);assert.notEqual(statSync(path,{bigint:true}).ino,before.ino);
   }else appendFileSync(path,`456 ${otherId}\n`);
   const observed=readFileSync(path);
   appendMailArrival(directory,root,change==='external complete append'?otherId:id);
   const lines=readFileSync(path,'utf8').trimEnd().split('\n');
   assert.equal(lines.filter(line=>line.endsWith(` ${id}`)).length,1);
   assert.equal(lines.filter(line=>line.endsWith(` ${otherId}`)).length,1);
   if(change==='external complete append')assert.deepEqual(readFileSync(path),observed,'a cached negative cannot duplicate the externally completed record');
  }finally{closeSync(directory);}
 });
}
test('005. A warm journal with an incomplete tail preserves it without treating it as an arrival',t=>{
 const root=inbox(t),path=join(root,'arrival'),directory=openOwnedDirectoryPath(root);
 const original=`123 ${id}\n456 ${otherId.slice(0,-1)}`;
 writeFileSync(path,original);
 try{
  appendMailArrival(directory,root,id);assert.equal(readFileSync(path,'utf8'),original);
  appendMailArrival(directory,root,otherId);
  const completed=readFileSync(path,'utf8');
  assert.ok(completed.startsWith(original+'\n'));
  assert.equal(completed.split('\n').filter(line=>line.endsWith(` ${otherId}`)).length,1);
  appendMailArrival(directory,root,otherId);assert.equal(readFileSync(path,'utf8'),completed);
 }finally{closeSync(directory);}
});
for(const [point,phase] of [['file-write','after-visible'],['file-fsync','ambiguous'],['directory-fsync','ambiguous']]) {
 test(`006. Arrival retry after ${point}/${phase} re-observes and flushes without another append`,t=>{
  const root=inbox(t),path=join(root,'arrival'),directory=openOwnedDirectoryPath(root),fault=new Error('controlled interrupted publication');
  writeFileSync(path,`123 ${id}\n`);
  try{
   appendMailArrival(directory,root,id);
   assert.throws(()=>appendMailArrival(directory,root,otherId,event=>{if(event.point===point&&event.phase===phase)throw fault;}),error=>error===fault);
   const visible=readFileSync(path),events=[];
   appendMailArrival(directory,root,otherId,event=>events.push(`${event.point}:${event.phase}`));
   assert.deepEqual(readFileSync(path),visible,'an interrupted visible append is not appended again');
   assert.equal(visible.toString().split('\n').filter(line=>line.endsWith(` ${otherId}`)).length,1);
   assert.ok(events.includes('file-fsync:after-visible'),'a visible record is not yet file durability evidence');
   assert.ok(events.includes('directory-fsync:after-visible'),'the record name still needs its directory flush');
  }finally{closeSync(directory);}
 });
}
test("001. Arrival append repairs its owned regular inode and preserves complete earlier records",t=>{
 const root=inbox(t),path=join(root,'arrival');
 writeFileSync(path,`123 ${id}\n456 `);chmodSync(path,0);
 const directory=openOwnedDirectoryPath(root);
 const next=messageIdForOperation('op-12345678-1234-4123-8123-123456789abd',0);
 try{
  appendMailArrival(directory,root,id);
  assert.equal(readFileSync(path,'utf8'),`123 ${id}\n456 `);
  appendMailArrival(directory,root,next);
  const completed=readFileSync(path,'utf8');
  appendMailArrival(directory,root,id);appendMailArrival(directory,root,next);
  assert.equal(readFileSync(path,'utf8'),completed);
 }finally{closeSync(directory);}
 assert.match(readFileSync(path,'utf8'),new RegExp(`^123 ${id}\\n456 \\n\\d+ ${next}\\n$`));
 assert.equal(statSync(path).mode&0o600,0o600);
});
for(const kind of ['symlink','fifo','directory'])test(`002. Arrival append refuses an owned ${kind} before I/O`,t=>{
 const root=inbox(t),path=join(root,'arrival'),outside=join(root,'outside');
 writeFileSync(outside,'unchanged');
 if(kind==='symlink')symlinkSync(outside,path);
 else if(kind==='fifo')execFileSync('mkfifo',[path]);
 else execFileSync('mkdir',[path]);
 const directory=openOwnedDirectoryPath(root);
 try{assert.throws(()=>appendMailArrival(directory,root,id),{code:'STORE_CORRUPT'});}finally{closeSync(directory);}
 assert.equal(readFileSync(outside,'utf8'),'unchanged');
});

test("003. Repeated arrivals reuse one verified journal scan and invalidate after an external change",async t=>{
 const fs=await import('node:fs'),{syncBuiltinESMExports}=await import('node:module');
 const root=inbox(t),path=join(root,'arrival'),directory=openOwnedDirectoryPath(root);
 const ids=Array.from({length:2000},(_,i)=>messageIdForOperation(`op-${i.toString(16).padStart(8,'0')}-1234-4123-8123-123456789abc`,0));
 writeFileSync(path,ids.map(value=>`123 ${value}\n`).join(''));
 const original=fs.default.readSync;let readBytes=0;
 t.mock.method(fs.default,'readSync',(...args)=>{const got=original(...args);readBytes+=got;return got;});syncBuiltinESMExports();
 try{
  appendMailArrival(directory,root,ids[0]);assert.ok(readBytes>65536);
  readBytes=0;appendMailArrival(directory,root,id);assert.ok(readBytes<=1,`warm append read ${readBytes} bytes`);
  readBytes=0;appendMailArrival(directory,root,ids[1999]);assert.ok(readBytes<=1,`warm duplicate read ${readBytes} bytes`);
  writeFileSync(path,`123 ${ids[0]}\n`);readBytes=0;appendMailArrival(directory,root,id);assert.ok(readBytes>1);
  assert.equal(readFileSync(path,'utf8').split(id).length-1,1);
 }finally{t.mock.restoreAll();syncBuiltinESMExports();closeSync(directory);}
});
