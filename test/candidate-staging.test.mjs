/** Actual Linux scope/file observations of the common TS staging owner.
 * Darwin filesystem/Seatbelt/process qualification remains separate. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync,readdirSync,chmodSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
import {ExecutionStaging} from '@oma/storage/execution-staging';
import {treeQuiescence,leasePathOf} from '@oma/storage/tree-lease';
import {ExecutionJournal} from '@oma/storage/execution-journal';
import {ExecutionRuntime} from '#oma-test/app/runtime/execution-runtime';
import {runnerScope} from '@oma/platform-linux/runner-scope';

assert.equal(process.platform,'linux','common staging scope tests use the actual Linux backend');
function fixture(t,purpose="candidate"){
  const root=mkdtempSync(join(tmpdir(),'oma-candidate-staging-'));ExecutionJournal.initialize(root);
  const slot=purpose==="runtime-tools"?"preparation":purpose;
  const owner=new ExecutionRuntime(root),staging=new ExecutionStaging(root,purpose,()=>owner.confirmDead(slot));
  t.after(async()=>{await owner.close();rmSync(root,{recursive:true,force:true});});
  return {root,owner,staging,slot};
}
for(const purpose of ['candidate','runtime-tools']) test(`${purpose} staging: callback fault with a live scope and free lease retains the tree until actual termination and retry`,{timeout:20000},async t=>{
  const f=fixture(t,purpose),controller=new AbortController(),interrupted=new Error('fixture interruption after the child released its lease');
  let held,first;let ready;const childClosedLease=new Promise(resolve=>{ready=resolve;});let output='';
  t.after(async()=>{controller.abort();await held?.stop();});
  await assert.rejects(f.staging.run(async stage=>{
    first=stage;
    held=await f.owner.begin(f.slot,()=>runnerScope({executable:process.execPath,
      argv:['-e',"require('node:fs').closeSync(6);process.stdout.write('lease-closed\\n');setInterval(()=>{},1000)"],
      env:{PATH:'/usr/bin:/bin'},timeoutMs:null,stdoutBytes:65536,stderrBytes:65536}),controller.signal,()=>{},()=>{},[stage.leaseFd],
      {stdoutSink:bytes=>{output+=Buffer.from(bytes).toString();if(output.includes('lease-closed\n'))ready();}});
    await childClosedLease;
    throw interrupted;
  }),error=>error===interrupted);
  assert.equal(f.owner.confirmDead(f.slot),false);assert.equal(ExecutionJournal.inspect(f.root).length,1);
  assert.equal(ExecutionJournal.inspect(f.root)[0].slot,f.slot,'the actual persisted scope uses the closed journal grammar');
  assert.equal(held.population(),'populated','the actual kernel scope still contains its live child');
  assert.equal(treeQuiescence(first.root).kind,'quiescent','the real free flock is not a whole-scope death proof');
  assert.equal(existsSync(first.root),true);assert.equal(existsSync(leasePathOf(first.root)),true);
  let entered=false;
  await assert.rejects(f.staging.run(async()=>{entered=true;}),{code:'RUN_TERMINATION_UNKNOWN'});assert.equal(entered,false);
  await held.stop();assert.equal(f.owner.confirmDead(f.slot),true);
  await f.staging.run(async stage=>{assert.notEqual(stage.root,first.root);assert.equal(existsSync(first.root),false);writeFileSync(join(stage.workspace,'retry'),'once');});
  assert.deepEqual(readdirSync(join(f.root,'staging')),[]);
});
test('candidate staging: SIGKILL after collection preserves primary bytes and a fresh owner can restart',{timeout:20000},t=>{
  // Each actual broker process must acquire the exclusive journal itself.
  // The observing parent initializes it but holds no competing owner lock.
  const f={root:mkdtempSync(join(tmpdir(),'oma-candidate-restart-'))};ExecutionJournal.initialize(f.root);
  t.after(()=>rmSync(f.root,{recursive:true,force:true}));
  const primary=join(f.root,'accepted-evidence'),record=join(f.root,'stage-record');writeFileSync(primary,'accepted bytes stay primary');
  const common=`import {ExecutionStaging} from ${JSON.stringify(import.meta.resolve('@oma/storage/execution-staging'))};
    import {ExecutionRuntime} from ${JSON.stringify(import.meta.resolve('#oma-test/app/runtime/execution-runtime'))};
    import {writeFileSync,existsSync} from 'node:fs';import assert from 'node:assert/strict';
    const owner=new ExecutionRuntime(${JSON.stringify(f.root)});await owner.recover();
    const staging=new ExecutionStaging(${JSON.stringify(f.root)},"candidate",()=>owner.confirmDead('candidate'));let made;
    await staging.run(async stage=>{made=stage.root;writeFileSync(${JSON.stringify(record)},made);writeFileSync(stage.workspace+'/effect','complete');});
    assert.equal(existsSync(made),false);assert.equal(existsSync(made+'.lease'),false);`;
  const killed=spawnSync(process.execPath,['--input-type=module','-e',common+`process.kill(process.pid,'SIGKILL');`],
    {encoding:'utf8',timeout:10000,env:{PATH:process.env.PATH}});
  assert.equal(killed.error,undefined);assert.equal(killed.signal,'SIGKILL',killed.stderr);assert.equal(killed.status,null);
  const old=readFileSync(record,'utf8');assert.equal(existsSync(old),false);assert.equal(existsSync(leasePathOf(old)),false);
  assert.equal(readFileSync(primary,'utf8'),'accepted bytes stay primary');
  const restarted=spawnSync(process.execPath,['--input-type=module','-e',common+'await owner.close();'],
    {encoding:'utf8',timeout:10000,env:{PATH:process.env.PATH}});
  assert.equal(restarted.error,undefined);assert.equal(restarted.signal,null);assert.equal(restarted.status,0,restarted.stderr);
  assert.notEqual(readFileSync(record,'utf8'),old);assert.equal(readFileSync(primary,'utf8'),'accepted bytes stay primary');
  assert.deepEqual(readdirSync(join(f.root,'staging')),[]);
});
test('candidate staging: interrupted mode000 workspace collection preserves an external symlink target and retries',{timeout:20000},async t=>{
  const f=fixture(t),outside=join(f.root,'outside');mkdirSync(outside);writeFileSync(join(outside,'primary'),'outside stays untouched');
  const failed=new Error('fixture fault after changing owned workspace mode');let first;
  await assert.rejects(f.staging.run(async stage=>{
    first=stage.root;symlinkSync(outside,join(stage.workspace,'external'));writeFileSync(join(stage.workspace,'temporary'),'owned');
    chmodSync(stage.workspace,0);throw failed;
  }),error=>error===failed);
  assert.equal(existsSync(first),false);assert.equal(readFileSync(join(outside,'primary'),'utf8'),'outside stays untouched');
  await f.staging.run(async stage=>{writeFileSync(join(stage.workspace,'retry'),'complete');});
  assert.deepEqual(readdirSync(join(f.root,'staging')),[]);assert.equal(readFileSync(join(outside,'primary'),'utf8'),'outside stays untouched');
});
test('candidate staging: a real existing tree at the selected nonce is never collected as newly owned staging',{timeout:20000},async t=>{
  const f=fixture(t),nonce='00000000-0000-4000-8000-000000000001',foreign=join(f.root,'staging','candidate-'+nonce);
  mkdirSync(foreign,{recursive:true});writeFileSync(join(foreign,'primary'),'preexisting data stays primary');
  // Only the disposable name is deterministic. File creation, EEXIST, flock,
  // scope/journal observations and collection use the actual Linux kernel.
  const original=crypto.randomUUID;crypto.randomUUID=()=>nonce;syncBuiltinESMExports();
  let entered=false;
  try {await assert.rejects(f.staging.run(async()=>{entered=true;}),{code:'EEXIST'});}
  finally {crypto.randomUUID=original;syncBuiltinESMExports();}
  assert.equal(entered,false);assert.equal(readFileSync(join(foreign,'primary'),'utf8'),'preexisting data stays primary');
  assert.equal(existsSync(leasePathOf(foreign)),false,'a refused foreign tree must not acquire a misleading owned marker');
  await f.staging.run(async stage=>{assert.notEqual(stage.root,foreign);writeFileSync(join(stage.workspace,'retry'),'complete');});
  assert.equal(readFileSync(join(foreign,'primary'),'utf8'),'preexisting data stays primary');
});
