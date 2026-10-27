import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,renameSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {join,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {HeldMailInbox} from '@oma/storage/mailbox';
import {mailInboxArrivalPathAt,mailObjectPathAt,mailInboxPathAt} from '@oma/domain/paths';
import {messageIdForOperation} from '@oma/domain/derived';
import {sha256Hex} from '@oma/domain/canonical-json';
const id=messageIdForOperation('op-12345678-1234-4123-8123-123456789abc',0);
function world(t){const root=mkdtempSync(join(tmpdir(),'oma-held-mailbox-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;}
test('a held mailbox publishes, observes, appends and moves under the same directory inode',t=>{
 const root=world(t),bytes=Buffer.from('accepted message'),message={id,bytes:bytes.length,sha256:sha256Hex(bytes)};
 const source=mailObjectPathAt(root,id);mkdirSync(dirname(source),{recursive:true});writeFileSync(source,bytes);
 const inboxPath=dirname(mailInboxArrivalPathAt(root,'alice')),held=new HeldMailInbox(root,'alice');
 try{
  renameSync(inboxPath,inboxPath+'.held');mkdirSync(inboxPath);
  held.publishInboxMessage('new',message);held.appendMailArrival(id);
  assert.deepEqual(readFileSync(join(inboxPath+'.held','new',basename(mailInboxPathAt(root,'alice',id,'new')))),bytes);
  assert.match(readFileSync(join(inboxPath+'.held','arrival'),'utf8'),new RegExp(`^\\d+ ${id}\\n$`));
  assert.deepEqual(readdirSync(inboxPath),[],'a replacement pathname cannot redirect the held capability');
  assert.equal(held.observeInboxMessage('new',message).kind,'present');
  held.moveNewToCur(id);held.flushCur();held.flushNew();
  assert.equal(held.observeInboxMessage('new',message).kind,'absent');
  assert.equal(held.observeInboxMessage('cur',message).kind,'present');
 }finally{held.close();}
 assert.throws(()=>held.observeInboxMessage('cur',message),{code:'INTERNAL_ERROR'});
});
test('partial mailbox acquisition closes every directory it already acquired',t=>{
 const root=world(t),inbox=dirname(mailInboxArrivalPathAt(root,'alice'));
 mkdirSync(join(inbox,'new'),{recursive:true});execFileSync('mkfifo',[join(inbox,'cur')]);
 const before=readdirSync('/proc/self/fd').length;
 for(let i=0;i<5;i++)assert.throws(()=>new HeldMailInbox(root,'alice'),{code:'STORE_CORRUPT'});
 assert.equal(readdirSync('/proc/self/fd').length,before,'a refused cur acquisition cannot retain its inbox/new descriptors');
});

test('copy fallback retains its caller-owned destination descriptor and complete immutable bytes',async t=>{
 const {publishImmutableEntry,observeImmutableEntry}=await import('@oma/storage/immutable-file');
 const {openOwnedDirectoryPath}=await import('@oma/storage/directory');
 const {closeSync,statSync}=await import('node:fs');
 const root=world(t),source=join(root,'source'),bytes=Buffer.from('complete copy fallback bytes');
 writeFileSync(source,bytes);const directory=openOwnedDirectoryPath(root);let injected=0;
 try{
  publishImmutableEntry(source,directory,'copy',join(root,'copy'),sha256Hex(bytes),fault=>{
   if(fault.point==='publication-link'&&fault.phase==='before'&&injected++===0)
    throw Object.assign(Error('injected cross-device link refusal'),{code:'EXDEV'});
  });
  assert.equal(injected,1);
  assert.equal(observeImmutableEntry(directory,'copy',sha256Hex(bytes),bytes.length).kind,'present');
  assert.notEqual(statSync(source).ino,statSync(join(root,'copy')).ino,'fallback must copy rather than link');
  assert.deepEqual(readdirSync(root).sort(),['copy','source'],'no copy temporary is retained after completion');
 }finally{closeSync(directory);}
});
