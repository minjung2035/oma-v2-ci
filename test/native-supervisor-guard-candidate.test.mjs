/** Observation-only candidate. It cannot enable product pipeline execution. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {launchDarwinJobScope,launchSeatbeltJobScope} from '@oma/platform-mac/job-scope';
import {ExecutionCoordinator} from '@oma/process/owned-execution';

test('001. Actual Darwin supervisor candidate records task access and attach attacks before any production adoption',{timeout:90000},async t=>{
 if(process.platform!=='darwin')return assert.rejects(launchDarwinJobScope({executable:process.execPath,argv:[],env:{},timeoutMs:null,stdoutBytes:0,stderrBytes:0}),e=>e.cause?.code==='UNSUPPORTED_PROFILE');
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-supervisor-guard-'))),executable=join(root,'probe'),rows=[];
 const owner=new ExecutionCoordinator({entries:()=>rows.map(row=>({...row})),reserve(slot){
  const row={slot,execution:randomUUID(),witness:null};rows.push(row);
  return{execution:row.execution,publish(witness){row.witness=witness;},retire(){rows.splice(rows.indexOf(row),1);}};
 },retire(){throw Error('unexpected fixture recovery');}},()=>({kind:'unavailable'}));
 t.after(async()=>{await owner.drain();rmSync(root,{recursive:true});});
 const compile=spawnSync('/usr/bin/clang',['-Wall','-Wextra','-Werror',fileURLToPath(new URL('./fixtures/darwin-supervisor-guard.c',import.meta.url)),'-o',executable],{encoding:'utf8',timeout:30000});
 assert.equal(compile.error,undefined);assert.equal(compile.signal,null);assert.equal(compile.status,0,compile.stderr);
 // arm64 clang emits an ad-hoc signature; Intel clang may emit none. This
 // owned fixture needs a CodeDirectory for the unchanged image capture gate.
 const signed=spawnSync('/usr/bin/codesign',['--force','--sign','-',executable],{encoding:'utf8',timeout:10000});
 assert.equal(signed.error,undefined);assert.equal(signed.signal,null);assert.equal(signed.status,0,signed.stderr);
 const observations=[];
 for(const [mode,seatbelt]of[['ordinary',false],['guard',false],['guard',true]]){
  const command={executable,argv:[mode],cwd:root,env:{HOME:root,TMPDIR:root,PATH:'/usr/bin:/bin'},timeoutMs:20000,stdoutBytes:16384,stderrBytes:16384};
  const policy={readable:[],writable:[{path:root,kind:'directory'}],denied:[],executable:[{path:executable,kind:'file'}],
   unixSockets:[],machServices:[],environmentKeys:['HOME','TMPDIR','PATH']};
  const result=await owner.run({slot:'guard-probe',signal:t.signal,
   launch:()=>seatbelt?launchSeatbeltJobScope(command,policy):launchDarwinJobScope(command),authorize(){}});
  assert.equal(result.kind,'exited',result.stderr.toString());assert.equal(result.exitCode,0,result.stderr.toString());
  const reports=result.stdout.toString().trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(reports.filter(row=>row.kind==='supervisor').length,1);assert.equal(reports.filter(row=>row.kind==='mach').length,1);
  const joined=reports.find(row=>row.kind==='joined');assert.equal(joined?.canaryIntact,true);
  assert.ok(joined.attachExit===0||joined.attachSignal>0);assert.deepEqual(rows,[]);
  observations.push({mode,seatbelt,reports});
 }
 t.diagnostic(JSON.stringify({candidate:'task access port plus PT_DENY_ATTACH',productionAdopted:false,observations}));
});
