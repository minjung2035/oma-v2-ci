/** Controlled lifecycle/ownership checks; these ports do not claim a kernel scope. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PreparationExecutor, configurePreparationExecution, preparationShutdownBarrier } from '../dist/preparation.js';
import { ExecutionNotStarted } from '../dist/owned-execution.js';
import { StoreError } from '@oma/domain/errors';
const command = () => ({executable:process.execPath,argv:['original'],env:{VALUE:'original'},timeoutMs:null,stdoutBytes:64,stderrBytes:64});
const result = {kind:'exited',exitCode:0,signal:null,errorCode:null,stdout:Buffer.from('complete'),stderr:Buffer.alloc(0),stdoutTruncated:false,stderrTruncated:false,elapsedMs:1};
test('001. The configured owner sees frozen launch inputs and shutdown waits for its complete result',async()=>{
 let finish, observed;const pending=new Promise(resolve=>{finish=resolve;});
 const port={run(...args){observed=args;return pending;}};
 const release=configurePreparationExecution(port);
 try {
  assert.throws(()=>configurePreparationExecution(port),{code:'INTERNAL_ERROR'});
  const executor=new PreparationExecutor(),source=command(),fds=[0],sink=()=>{},sinks={stdoutSink:sink};
  const run=executor.run(source,undefined,fds,sinks);source.argv[0]='changed';source.env.VALUE='changed';fds[0]=999;sinks.stdoutSink=()=>{};
  assert.equal(executor.blocked,true);let drained=false;const barrier=preparationShutdownBarrier().then(()=>{drained=true;});
  await assert.rejects(executor.run(command()),{code:'REF_STATE_UNKNOWN'});await Promise.resolve();
  assert.equal(drained,false);assert.deepEqual(observed[0].argv,['original']);assert.equal(observed[0].env.VALUE,'original');
  assert.deepEqual(observed[2],[0]);assert.equal(observed[3].stdoutSink,sink);
  finish(result);assert.equal(await run,result);await barrier;assert.equal(executor.quiescence,'quiescent');
 }finally{release();}
});
test('002. A positively unstarted provider returns its bookkeeping while an uncertain provider stays blocked until fresh quiescence',async()=>{
 const notStarted=new ExecutionNotStarted(new Error('no scope created'));
 let error=notStarted;const release=configurePreparationExecution({run(){throw error;}});
 try {
  const executor=new PreparationExecutor();await assert.rejects(executor.run(command()),e=>e===notStarted.cause,'the caller receives the typed reason nothing started');
  await preparationShutdownBarrier();assert.equal(executor.blocked,false);
  error=new Error('scope outcome unknown');await assert.rejects(executor.run(command()),e=>e===error);assert.equal(executor.blocked,true);
  await assert.rejects(preparationShutdownBarrier(),{code:'RUN_TERMINATION_UNKNOWN'});
  assert.equal(executor.reverifyStale(()=> 'unknown'),'unknown');assert.equal(executor.blocked,true);
  assert.equal(executor.reverifyStale(()=> 'quiescent'),'quiescent');await preparationShutdownBarrier();assert.equal(executor.blocked,false);
 }finally{release();}
});
test('003. A pre-release cancellation the execution owner already settled does not fence shutdown',async()=>{
 const cancelled=new StoreError('CANCELLED_BEFORE_COMMIT','execution was cancelled before release');
 const release=configurePreparationExecution({run(){return Promise.reject(cancelled);}});
 try {
  const executor=new PreparationExecutor();await assert.rejects(executor.run(command()),e=>e===cancelled);
  await preparationShutdownBarrier();assert.equal(executor.blocked,false);assert.equal(executor.quiescence,'quiescent');
 }finally{release();}
});
test('004. An interrupted run the execution owner settled leaves its state unknown without fencing shutdown',async()=>{
 const aborted={...result,kind:'aborted',exitCode:null,signal:'SIGKILL'};
 const release=configurePreparationExecution({run(){return Promise.resolve(aborted);}});
 try {
  const executor=new PreparationExecutor();assert.equal(await executor.run(command()),aborted);
  await preparationShutdownBarrier();assert.equal(executor.blocked,true,'the prepared state still needs a fresh observation');
  assert.equal(executor.reverifyStale(()=> 'quiescent'),'quiescent');assert.equal(executor.blocked,false);
 }finally{release();}
});
