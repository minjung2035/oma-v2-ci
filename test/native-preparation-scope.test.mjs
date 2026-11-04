/** Actual preparation scopes and the application's durable journal. These
 * observations do not qualify Society ownership or whole-product admission. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, openSync, closeSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PreparationExecutor } from '@oma/process/preparation';
import { launchDarwinJobScope } from '@oma/process/darwin-execution';
import { ExecutionJournal } from '@oma/storage/execution-journal';
import { observeDarwinCoalitionPopulation } from '@oma/native/audit-session';
import { ExecutionRuntime } from '#oma-test/app/runtime/execution-runtime';
const command=(root,script)=>({executable:realpathSync(process.execPath),argv:['-e',script],env:{HOME:root,TMPDIR:root},cwd:root,timeoutMs:null,stdoutBytes:4096,stderrBytes:4096});
async function unsupported(t){t.diagnostic('NOT_RUN: actual Darwin preparation; Linux checks only explicit backend refusal');await assert.rejects(launchDarwinJobScope(command(tmpdir(),'')),e=>e.cause?.code==='UNSUPPORTED_PROFILE');}
test('001. Standalone Darwin preparation returns inherited FD 3 and all captured bytes after complete scope close',{timeout:30000},async t=>{
 if(process.platform!=='darwin')return unsupported(t);
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-darwin-preparation-')));writeFileSync(join(root,'borrowed'),'held bytes');const fd=openSync(join(root,'borrowed'),'r');
 t.after(()=>{closeSync(fd);rmSync(root,{recursive:true});});
 const executor=new PreparationExecutor(),stream=[];
 const result=await executor.run(command(root,"process.stdout.write(require('node:fs').readFileSync(3))"),undefined,[fd],{stdoutSink:b=>stream.push(b)});
 assert.equal(result.kind,'exited');assert.equal(result.exitCode,0,result.stderr.toString());assert.equal(result.stdout.toString(),'held bytes');
 assert.equal(Buffer.concat(stream).toString(),'held bytes');assert.equal(executor.quiescence,'quiescent');
});
test('002. Application preparation publishes a durable CID before effects and retains cancellation uncertainty until fresh complete-death observation',{timeout:30000},async t=>{
 if(process.platform!=='darwin')return unsupported(t);
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-app-preparation-')));ExecutionJournal.initialize(root);
 writeFileSync(join(root,'borrowed'),'durable preparation');const fd=openSync(join(root,'borrowed'),'r'),controller=new AbortController(),executor=new PreparationExecutor();
 let runtime,run,identity;
 t.after(async()=>{controller.abort();await run?.catch(()=>{});
  if(identity)executor.reverifyStale(()=>observeDarwinCoalitionPopulation(identity)==='empty'?'quiescent':'unknown');
  try{await runtime?.close();rmSync(root,{recursive:true});}finally{closeSync(fd);}
 });
 runtime=new ExecutionRuntime(root,launchDarwinJobScope);
 let outcome;run=executor.run(command(root,"const fs=require('node:fs');fs.writeFileSync('entered',fs.readFileSync(3));setInterval(()=>{},1000)"),controller.signal,[fd]);void run.then(result=>{outcome={result};},error=>{outcome={error};});
 const deadline=performance.now()+10000;
 while(!existsSync(join(root,'entered'))){if(outcome?.error)throw outcome.error;if(outcome?.result)assert.fail('preparation returned before its effect: '+JSON.stringify({...outcome.result,stdout:outcome.result.stdout.toString(),stderr:outcome.result.stderr.toString()}));assert.ok(performance.now()<deadline,'preparation did not enter');await delay(5);}
 assert.equal(readFileSync(join(root,'entered'),'utf8'),'durable preparation');
 const rows=ExecutionJournal.inspect(root);assert.equal(rows.length,1);assert.ok(rows[0].slot.startsWith('preparation:'));
 identity=rows[0].witness;assert.equal(identity.kind,'darwin-resource-coalition');assert.equal(observeDarwinCoalitionPopulation(identity),'populated');
 controller.abort();const result=await run;assert.equal(result.kind,'aborted'); // Owner-requested stop fabricates no child wait status.
 assert.deepEqual(ExecutionJournal.inspect(root),[]);assert.equal(observeDarwinCoalitionPopulation(identity),'empty');assert.equal(executor.blocked,true);
 assert.equal(executor.reverifyStale(()=>observeDarwinCoalitionPopulation(identity)==='empty'?'quiescent':'unknown'),'quiescent');
 await runtime.close();assert.equal(executor.blocked,false);
});

test('003. Actual context preparation uses its held working directory and leaves the accepted ref unchanged',{timeout:60000},async t=>{
 const { GitRepository }=await import('@oma/git/repository');
 const { createHash }=await import('node:crypto');
 const { spawnSync }=await import('node:child_process');
 const { mkdirSync }=await import('node:fs');
 const { preparationShutdownBarrier }=await import('@oma/process/preparation');
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-native-context-directory-'))),projectGit=join(root,'project.git'),contextGit=join(root,'context.git');
 t.after(async()=>{await preparationShutdownBarrier();rmSync(root,{recursive:true});});
 const git=args=>{const child=spawnSync('/usr/bin/git',args,{encoding:'utf8',env:{PATH:'/usr/bin:/bin',HOME:root,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'},timeout:10000});
  assert.equal(child.error,undefined);assert.equal(child.signal,null);assert.equal(child.status,0,child.stderr);return child.stdout;};
 git(['init','--bare',projectGit]);
 const repository=new GitRepository({stateRoot:root,projectGit,contextGit,worldDir:join(root,'world'),society:'demo'},{submissions:()=>[]});
 const tree=join(root,'context-stage','tree'),bytes=Buffer.from('# Actual context directory\n');mkdirSync(tree,{recursive:true});writeFileSync(join(tree,'GOAL.md'),bytes);
 const entries=[{path:'GOAL.md',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}];
 const candidate=await repository.context.prepareCandidate(tree,entries,null);
 assert.equal(git(['--git-dir',contextGit,'show',candidate+':GOAL.md']),bytes.toString());
 assert.equal(repository.context.current(),null);assert.equal(repository.context.preparationQuiescent(tree),true);
});

test('004. Concurrent application preparations own different journal rows and stopping one cannot stop the other',{timeout:45000},async t=>{
 if(process.platform!=='darwin')return unsupported(t);
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-concurrent-preparations-')));ExecutionJournal.initialize(root);
 const executors=[new PreparationExecutor(),new PreparationExecutor()],controllers=[new AbortController(),new AbortController()],runs=[],outcomes=[],identities=[];
 let runtime;
 t.after(async()=>{
  for(const c of controllers)c.abort();await Promise.all(runs.map(p=>p.catch(()=>{})));
  for(let i=0;i<identities.length;i++)executors[i].reverifyStale(()=>observeDarwinCoalitionPopulation(identities[i])==='empty'?'quiescent':'unknown');
  await runtime?.close();rmSync(root,{recursive:true});
 });
 runtime=new ExecutionRuntime(root,launchDarwinJobScope);
 for(let i=0;i<2;i++){
  const script=`require('node:fs').writeFileSync('entered-${i}','started');setInterval(()=>{},1000)`;
  const run=executors[i].run(command(root,script),controllers[i].signal);runs.push(run);
  void run.then(result=>{outcomes[i]={result};},error=>{outcomes[i]={error};});
 }
 const deadline=performance.now()+15000;
 while(![0,1].every(i=>existsSync(join(root,'entered-'+i)))){
  for(const o of outcomes){if(o?.error)throw o.error;if(o?.result)assert.fail('preparation ended before its effect');}
  assert.ok(performance.now()<deadline,'concurrent preparations did not enter');await delay(5);
 }
 const rows=ExecutionJournal.inspect(root);assert.equal(rows.length,2);assert.equal(new Set(rows.map(r=>r.slot)).size,2);
 identities.push(...rows.map(r=>r.witness));assert.notEqual(identities[0].coalitionId,identities[1].coalitionId);
 controllers[0].abort();assert.equal((await runs[0]).kind,'aborted');
 const remaining=ExecutionJournal.inspect(root);assert.equal(remaining.length,1);
 assert.equal(observeDarwinCoalitionPopulation(remaining[0].witness),'populated');assert.equal(executors[1].blocked,true);
 controllers[1].abort();assert.equal((await runs[1]).kind,'aborted');assert.deepEqual(ExecutionJournal.inspect(root),[]);
 for(let i=0;i<2;i++){
  assert.equal(observeDarwinCoalitionPopulation(identities[i]),'empty');
  assert.equal(executors[i].reverifyStale(()=>observeDarwinCoalitionPopulation(identities[i])==='empty'?'quiescent':'unknown'),'quiescent');
 }
 await runtime.close();
});
