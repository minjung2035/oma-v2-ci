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
 run=executor.run(command(root,"const fs=require('node:fs');fs.writeFileSync('entered',fs.readFileSync(3));setInterval(()=>{},1000)"),controller.signal,[fd]);void run.catch(()=>{});
 const deadline=performance.now()+10000;
 while(!existsSync(join(root,'entered'))){assert.ok(performance.now()<deadline,'preparation did not enter');await delay(5);}
 assert.equal(readFileSync(join(root,'entered'),'utf8'),'durable preparation');
 const rows=ExecutionJournal.inspect(root);assert.equal(rows.length,1);assert.ok(rows[0].slot.startsWith('preparation:'));
 identity=rows[0].witness;assert.equal(identity.kind,'darwin-resource-coalition');assert.equal(observeDarwinCoalitionPopulation(identity),'populated');
 controller.abort();const result=await run;assert.equal(result.kind,'signalled');assert.equal(result.signal,'SIGKILL');
 assert.deepEqual(ExecutionJournal.inspect(root),[]);assert.equal(observeDarwinCoalitionPopulation(identity),'empty');assert.equal(executor.blocked,true);
 assert.equal(executor.reverifyStale(()=>observeDarwinCoalitionPopulation(identity)==='empty'?'quiescent':'unknown'),'quiescent');
 await runtime.close();assert.equal(executor.blocked,false);
});
