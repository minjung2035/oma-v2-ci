import test from 'node:test';import assert from 'node:assert/strict';import {ExecutionCoordinator} from '@oma/process/owned-execution';
import {setTimeout} from 'node:timers/promises';
test("001. Execution owner: a held recovery fences its slot without delaying a different slot",async()=>{
 const entries=new Map([['held',{slot:'held',execution:'old',witness:{id:'old'}}]]);let released=false,started=false;
 const journal={entries:()=>[...entries.values()],reserve:slot=>{assert.equal(entries.has(slot),false);const execution='new-'+slot;entries.set(slot,{slot,execution,witness:null});return {execution,publish:witness=>entries.set(slot,{slot,execution,witness}),retire:()=>entries.delete(slot)}},retire:slot=>entries.delete(slot)};
 const owner=new ExecutionCoordinator(journal,identity=>({kind:'running',identity}),identity=>({identity,terminate(){},population:()=>released?'empty':'populated',close(){}}));
 const recovery=owner.recover();await setTimeout(0);
 const observation={kind:'exited',exitCode:0,signal:null,errorCode:null,elapsedMs:1,stdout:Buffer.alloc(0),stderr:Buffer.alloc(0),stdoutTruncated:false,stderrTruncated:false};let empty=false;
 try { const task=owner.run({slot:'other',launch:async()=>({witness:{id:'other'},result:Promise.resolve(observation),closed:Promise.resolve(),population:()=>empty?'empty':'populated',release(){started=true},terminate(){empty=true},close(){}}),authorize(){}});
   assert.equal(await Promise.race([task.then(()=>true),setTimeout(200).then(()=>false)]),true);assert.equal(started,true);assert.equal(owner.confirmDead('held'),false);assert.equal(owner.confirmDead('other'),true);
 } finally {released=true;await recovery;await owner.drain();}
});
