/** Actual execution admission/recovery window; logical callback failures are
 * separate from kernel scope/population observations. No product role grant. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync}from'node:fs';
import{tmpdir}from'node:os';import{join}from'node:path';
import{ExecutionJournal}from'@oma/storage/execution-journal';
import{DARWIN_EXECUTION_JOURNAL_VERSION,EXECUTION_JOURNAL_VERSION}from'@oma/protocol/persisted-formats';
import{launchDarwinJobScope}from'@oma/process/darwin-execution';
import{runnerScope}from'@oma/platform-linux/runner-scope';
import{PreparationExecutor,preparationShutdownBarrier}from'@oma/process/preparation';
import{ExecutionRuntime}from'#oma-test/app/runtime/execution-runtime';
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return{promise,resolve};};
const command=(root,script)=>{const c={executable:realpathSync(process.execPath),argv:['-e',script],env:{HOME:root,TMPDIR:root},cwd:root,timeoutMs:null,stdoutBytes:32,stderrBytes:4096};return process.platform==='linux'?runnerScope(c):c;};
function fixture(t){const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-runtime-maintenance-')));ExecutionJournal.initialize(root);
 const runtime=new ExecutionRuntime(root,process.platform==='darwin'?launchDarwinJobScope:undefined);return{root,runtime};}
test('001. Recovery maintenance refuses a live journal owner and closes every new admission until its window returns',{timeout:45000},async t=>{
 const{root,runtime}=fixture(t);let ticket;const release=deferred();
 t.after(async()=>{release.resolve();await ticket?.stop();await ticket?.completion.catch(()=>{});await runtime.close();rmSync(root,{recursive:true});});
 await runtime.recover();const signal=new AbortController().signal;
 ticket=await runtime.begin('resident:alice',()=>command(root,'setInterval(()=>{},1000)'),signal,()=>{},()=>{});
 let touched=false;await assert.rejects(async()=>runtime.recoverAndMaintain(async()=>{touched=true;}),{code:'RUN_TERMINATION_UNKNOWN'});
 assert.equal(touched,false);assert.equal(ticket.population(),'populated');assert.equal(ExecutionJournal.inspect(root).length,1);
 await ticket.stop();await ticket.completion;assert.equal(runtime.confirmDead('resident:alice'),true);
 const entered=deferred(),maintenance=runtime.recoverAndMaintain(async()=>{entered.resolve();await release.promise;});await entered.promise;
 let authorized=false;
 await assert.rejects(runtime.run('candidate',command(root,'process.stdout.write("must-not-enter")'),undefined,()=>{authorized=true;}),{code:'BROKER_UNAVAILABLE'});
 await assert.rejects(runtime.begin('resident:alice',()=>{authorized=true;return command(root,'');},signal,()=>{},()=>{}),{code:'BROKER_UNAVAILABLE'});
 if(process.platform==='darwin'){
  const executor=new PreparationExecutor();
  await assert.rejects(executor.run(command(root,'')),{code:'BROKER_UNAVAILABLE'});
  assert.equal(executor.quiescence,'quiescent');await preparationShutdownBarrier();
 }
 assert.equal(authorized,false);assert.deepEqual(ExecutionJournal.inspect(root),[]);
 release.resolve();await maintenance;
 const result=await runtime.run('candidate',command(root,'process.stdout.write("released")'),undefined,()=>{});
 assert.equal(result.kind,'exited');assert.equal(result.exitCode,0,result.stderr.toString());assert.equal(result.stdout.toString(),'released');
 assert.deepEqual(ExecutionJournal.inspect(root),[]);
});
test('002. A failed maintenance effect stays fenced and shutdown still returns the actual journal',{timeout:15000},async t=>{
 const{root,runtime}=fixture(t),failure=new Error('logical maintenance fault');
 t.after(()=>rmSync(root,{recursive:true}));
 await assert.rejects(runtime.recoverAndMaintain(async()=>{throw failure;}),e=>e===failure);
 await assert.rejects(runtime.run('candidate',command(root,''),undefined,()=>assert.fail('fenced maintenance reached authority')),{code:'BROKER_UNAVAILABLE'});
 assert.deepEqual(ExecutionJournal.inspect(root),[]);
 await assert.rejects(runtime.close(),e=>e===failure);
 const reopened=ExecutionJournal.open(root,process.platform==='darwin'?DARWIN_EXECUTION_JOURNAL_VERSION:EXECUTION_JOURNAL_VERSION);reopened.close();
});


test('003. Shutdown before a recovery window starts creates no effect and still returns its journal',{timeout:15000},async t=>{
 const{root,runtime}=fixture(t);t.after(()=>rmSync(root,{recursive:true}));let entered=false;
 const maintenance=runtime.recoverAndMaintain(async()=>{entered=true;});const closing=runtime.close();
 await assert.rejects(maintenance,{code:'CANCELLED_BEFORE_COMMIT'});await closing;assert.equal(entered,false);
 const reopened=ExecutionJournal.open(root,process.platform==='darwin'?DARWIN_EXECUTION_JOURNAL_VERSION:EXECUTION_JOURNAL_VERSION);reopened.close();
});
