import { createMailModule, mailLedger } from "#oma-test/app/broker/mail-composition";
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {syncBuiltinESMExports} from 'node:module';
import {fork} from 'node:child_process';
import {Store} from '@oma/storage';
import {MailModule} from "@oma/mail";
import {mailInboxArrivalPathAt} from '@oma/domain/paths';
import {makeValidAgent,ALL_CAPS} from '../dist/test/fixtures/spec.js';

const auth={actor:'alice',incarnation:1,role:'resident',channel:'actor',capabilities:new Set(ALL_CAPS),
  peer:{pid:process.pid,uid:process.getuid(),gid:process.getgid()}};
const input={to:['bob'],subject:'arrival durability',kind:'message',body:'accepted bytes'};
const original=fs.writeSync;
function injectArrivalWrite(replacement){
  fs.writeSync=function(fd,value,...args){
    const bytes=typeof value==='string'?Buffer.from(value):value;
    if(Buffer.isBuffer(bytes)&&/^\d+ m-/.test(bytes.toString('utf8')))
      return replacement(fd,bytes,typeof args[0]==='number'?args[0]:0,typeof args[1]==='number'?args[1]:bytes.length);
    return original(fd,value,...args);
  };
  syncBuiltinESMExports();
  return ()=>{fs.writeSync=original;syncBuiltinESMExports();};
}
function world(t){
 const root=fs.mkdtempSync(join(tmpdir(),'oma-arrival-write-'));
 let store=new Store(join(root,'runtime.sqlite')), suspended=false;
 store.transaction(tx=>{tx.insertAgent(makeValidAgent('alice'));tx.insertAgent(makeValidAgent('bob'));});
 const mail=()=>createMailModule({stateRoot:root,society:'demo'},store,64);
 t.after(()=>{try{if(!suspended)store.close();}finally{fs.rmSync(root,{recursive:true,force:true});}});
 return {root,get store(){return store;},mail,suspend(){store.close();suspended=true;},reopen(){if(!suspended)store.close();store=new Store(join(root,'runtime.sqlite'));suspended=false;}};
}
function message(f,key){const row=f.store.getOperation('alice',key);assert.equal(row?.kind,'mail.send');return row;}
function completeArrival(f,id){
 const text=fs.readFileSync(mailInboxArrivalPathAt(f.root,'bob'),'utf8');
 assert.ok(text.endsWith('\n'),'only a terminated full append can precede materialized');
 assert.ok(text.split('\n').some(line=>{
   const space=line.indexOf(' '),time=Number(line.slice(0,space));
   return space>0&&Number.isSafeInteger(time)&&time>=0&&line.slice(space+1)===id;
 }),`missing full arrival record: ${JSON.stringify(text)}`);
}

if(process.argv[2]==='arrival-crash-worker'){
 const root=process.argv[3],store=new Store(join(root,'runtime.sqlite'));
 const restore=injectArrivalWrite((fd,bytes,offset,length)=>{
   const written=original(fd,bytes,offset,Math.min(13,length));
   process.send({checkpoint:'partial-arrival'});
   process.kill(process.pid,'SIGSTOP');
   return written;
 });
 try{await createMailModule({stateRoot:root,society:'demo'},store,64).send(auth,'killed',input);}
 finally{restore();store.close();}
 throw Error('worker must be killed at the real partial append');
}else{
 test('DR46-F05: ordinary arrival publication records a complete line',async t=>{
   const f=world(t);assert.equal((await f.mail().send(auth,'normal',input)).state,'succeeded');
   completeArrival(f,message(f,'normal').plan.message.id);
 });
 test('native wake: materialized hints run after commit and retain the original receipt',async t=>{
   const f=world(t), hints=[];
   const mail=createMailModule({stateRoot:f.root,society:'demo'},f.store,64,24,undefined,actor=>{
     assert.equal(f.store.inTransaction,false,'a wake cannot execute inside the publication transaction');
     const row=message(f,'wake-after-commit');
     assert.equal(f.store.getDelivery(row.plan.message.id,actor).materialized,1);
     completeArrival(f,row.plan.message.id); hints.push(actor);
   });
   const first=await mail.send(auth,'wake-after-commit',input);
   assert.equal(first.state,'succeeded'); assert.deepEqual(hints,['bob']);
   assert.deepEqual(await mail.send(auth,'wake-after-commit',input),first);
   assert.deepEqual(hints,['bob'],'a terminal same-key receipt creates no new delivery effect');
 });
 test('native wake: rollback emits no materialized hint and preserves the accepted plan',async t=>{
   const f=world(t), restore=injectArrivalWrite(()=>0);
   try{assert.equal((await f.mail().send(auth,'rollback-hint',input)).state,'pending');}finally{restore();}
   const row=message(f,'rollback-hint'), before=row.planJson, hints=[], failure=Error('abort publication transaction');
   const ledger=mailLedger(f.store,actor=>hints.push(actor));
   assert.throws(()=>ledger.transaction(tx=>{tx.markMaterialized(row.plan.message.id,'bob');throw failure;}),error=>error===failure);
   assert.deepEqual(hints,[]); assert.equal(f.store.inTransaction,false);
   assert.equal(message(f,'rollback-hint').planJson,before);
   assert.equal(f.store.getDelivery(row.plan.message.id,'bob').materialized,0);
   const mail=createMailModule({stateRoot:f.root,society:'demo'},f.store,64,24,undefined,actor=>hints.push(actor));
   assert.deepEqual(await mail.reconcilePending(),{examined:1,repaired:1,remaining:0});
   assert.deepEqual(hints,['bob']);
   ledger.transaction(tx=>tx.markMaterialized(row.plan.message.id,'bob'));
   assert.deepEqual(hints,['bob'],'re-confirming a materialized row cannot feed a recovery wake loop');
 });
 test('DR46-F05: short arrival writes persist every byte before materialized',async t=>{
   const f=world(t);let calls=0;
   const restore=injectArrivalWrite((fd,bytes,offset,length)=>{calls++;return original(fd,bytes,offset,Math.min(7,length));});
   try{assert.equal((await f.mail().send(auth,'short',input)).state,'succeeded');}finally{restore();}
   const row=message(f,'short');assert.ok(calls>1,'the actual append must continue after a partial write');
   assert.equal(f.store.getDelivery(row.plan.message.id,'bob').materialized,1);
   completeArrival(f,row.plan.message.id);
 });
 test('DR46-F05: a stalled arrival append remains pending and recovery preserves accepted bytes',async t=>{
   const f=world(t);let calls=0;
   const restore=injectArrivalWrite(()=>{calls++;return 0;});
   try{assert.equal((await f.mail().send(auth,'stalled',input)).state,'pending');}finally{restore();}
   assert.equal(calls,1,'a zero-byte append must refuse rather than spin');
   const before=message(f,'stalled'),id=before.plan.message.id;
   assert.equal(f.store.getDelivery(id,'bob').materialized,0);
   const object=fs.readFileSync(f.mail().objectPath(id));f.reopen();
   assert.equal((await f.mail().send(auth,'stalled',input)).state,'pending');
   assert.deepEqual(await f.mail().reconcilePending(),{examined:1,repaired:1,remaining:0});
   const after=message(f,'stalled');assert.equal(after.planJson,before.planJson);assert.equal(after.state,'succeeded');
   assert.deepEqual(fs.readFileSync(f.mail().objectPath(id)),object);completeArrival(f,id);
   assert.deepEqual(await f.mail().reconcilePending(),{examined:0,repaired:0,remaining:0});
 });
 for(const phase of ['file','parent'])test(`DR46-F05: ${phase} fsync failure cannot mark an arrival materialized`,async t=>{
   const f=world(t),path=mailInboxArrivalPathAt(f.root,'bob');
   const originalFsync=fs.fsyncSync;let sawArrival=false,injected=0;
   fs.fsyncSync=function(fd){
     const target=fs.readlinkSync(`/proc/self/fd/${fd}`);
     if(target===path){sawArrival=true;if(phase==='file'){injected++;throw Object.assign(Error('arrival fsync unavailable'),{code:'EIO'});}}
     if(sawArrival&&target===path.slice(0,path.lastIndexOf('/'))&&phase==='parent'){
       injected++;throw Object.assign(Error('arrival parent fsync unavailable'),{code:'EIO'});
     }
     return originalFsync(fd);
   };
   syncBuiltinESMExports();
   try{assert.equal((await f.mail().send(auth,phase,input)).state,'pending');}
   finally{fs.fsyncSync=originalFsync;syncBuiltinESMExports();}
   assert.equal(injected,1,'the actual arrival durability boundary must be injected');
   const before=message(f,phase),id=before.plan.message.id;
   assert.equal(f.store.getDelivery(id,'bob').materialized,0);
   const object=fs.readFileSync(f.mail().objectPath(id));f.reopen();
   assert.equal((await f.mail().send(auth,phase,input)).state,'pending');
   assert.deepEqual(await f.mail().reconcilePending(),{examined:1,repaired:1,remaining:0});
   assert.equal(message(f,phase).planJson,before.planJson);
   assert.deepEqual(fs.readFileSync(f.mail().objectPath(id)),object);completeArrival(f,id);
 });
 test('DR46-F05: SIGKILL during a real arrival append, retry and restart retain the accepted message',async t=>{
   const f=world(t);f.suspend();
   const child=fork(new URL(import.meta.url),['arrival-crash-worker',f.root],{stdio:['ignore','ignore','pipe','ipc']});
   let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
   t.after(()=>child.kill('SIGKILL'));
   await new Promise((resolve,reject)=>{
     let reached=false;
     const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error(`arrival checkpoint timeout: ${stderr}`));},10000);
     child.on('error',error=>{clearTimeout(timer);reject(error);});
     child.on('message',message=>{if(message?.checkpoint==='partial-arrival'){reached=true;child.kill('SIGKILL');}});
     child.on('exit',(_code,signal)=>{clearTimeout(timer);if(reached&&signal==='SIGKILL')resolve();else reject(Error(`worker missed boundary: ${stderr}`));});
   });
   f.reopen();const before=message(f,'killed'),id=before.plan.message.id;
   assert.equal(before.state,'pending');assert.equal(f.store.getDelivery(id,'bob').materialized,0);
   const partial=fs.readFileSync(mailInboxArrivalPathAt(f.root,'bob'),'utf8');
   assert.ok(partial.length>0&&!partial.endsWith('\n'),'the process actually died with an unfinished append');
   const object=fs.readFileSync(f.mail().objectPath(id));
   assert.equal((await f.mail().send(auth,'killed',input)).state,'pending');
   assert.deepEqual(await f.mail().reconcilePending(),{examined:1,repaired:1,remaining:0});
   const after=message(f,'killed');assert.equal(after.id,before.id);assert.equal(after.planJson,before.planJson);assert.equal(after.state,'succeeded');
   completeArrival(f,id);assert.deepEqual(fs.readFileSync(f.mail().objectPath(id)),object);
   f.reopen();assert.equal((await f.mail().send(auth,'killed',input)).state,'succeeded');
   assert.deepEqual(await f.mail().reconcilePending(),{examined:0,repaired:0,remaining:0});
 });
}
