/** Controlled signing matrix only. Every inspected process is this fixture's
 * own child; observations cannot enable product execution or relax a guard. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFileSync,mkdtempSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {ExecutionJournal} from '@oma/storage/execution-journal';
import {launchDarwinJobScope} from '@oma/platform-mac/job-scope';
import {ExecutionRuntime} from '#oma-test/app/runtime/execution-runtime';

const plist=keys=>'<?xml version="1.0"?><plist version="1.0"><dict>'+keys.map(key=>'<key>'+key+'</key><true/>').join('')+'</dict></plist>';
function reports(stdout){
 const rows=stdout.trim().split('\n').map(line=>JSON.parse(line));
 assert.equal(rows.filter(row=>row.kind==='mach').length,1);
 assert.equal(rows.find(row=>row.kind==='joined')?.canaryIntact,true);
 return rows;
}
test('001. Actual hardened signing matrix compares an own debuggable target with an own protected target',{timeout:90000},async t=>{
 if(process.platform!=='darwin'){t.diagnostic('NOT_RUN: Darwin signing and own-process debugging matrix');return;}
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-hardened-supervisor-'))),executable=join(root,'probe');
 ExecutionJournal.initialize(root);const runtime=new ExecutionRuntime(root,launchDarwinJobScope);
 t.after(async()=>{await runtime.close();rmSync(root,{recursive:true});});await runtime.recover();
 const run=(command,argv,timeout=30000)=>{
  const r=spawnSync(command,argv,{encoding:'utf8',timeout});
  assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr);return r;
 };
 const nodeSigning=run('/usr/bin/codesign',['--display','--verbose=4',process.execPath]);
 const nodeEntitlements=run('/usr/bin/codesign',['--display','--entitlements',':-',process.execPath]);
 t.diagnostic(JSON.stringify({selectedNode:process.execPath,signing:nodeSigning.stderr,
  entitlements:nodeEntitlements.stdout,entitlementDiagnostic:nodeEntitlements.stderr}));
 run('/usr/bin/clang',['-Wall','-Wextra','-Werror',fileURLToPath(new URL('./fixtures/darwin-supervisor-guard.c',import.meta.url)),'-o',executable]);
 const observations=[];
 for(const [name,entitlements]of[
  ['debuggable',['com.apple.security.cs.debugger','com.apple.security.get-task-allow']],
  ['protected',['com.apple.security.cs.debugger']],
 ]){
  const target=join(root,name),entitlementFile=target+'.plist';copyFileSync(executable,target);writeFileSync(entitlementFile,plist(entitlements));
  run('/usr/bin/codesign',['--force','--sign','-','--options','runtime','--entitlements',entitlementFile,target]);
  const signing=run('/usr/bin/codesign',['--display','--verbose=4',target]);
  for(const mode of ['ordinary','guard']){
   const result=await runtime.run('preparation',{executable:target,argv:[mode],cwd:root,env:{HOME:root,TMPDIR:root,PATH:'/usr/bin:/bin'},
    timeoutMs:20000,stdoutBytes:16384,stderrBytes:16384},t.signal,()=>{});
   t.diagnostic(JSON.stringify({name,mode,kind:result.kind,exitCode:result.exitCode,signal:result.signal,
    stdout:result.stdout.toString(),stderr:result.stderr.toString()}));
   assert.equal(result.kind,'exited',result.stderr.toString());assert.equal(result.exitCode,0,result.stderr.toString());
   assert.equal(runtime.confirmDead('preparation'),true);assert.deepEqual(ExecutionJournal.inspect(root),[]);
   observations.push({name,mode,entitlements,signing:signing.stderr,reports:reports(result.stdout.toString()),completeScopeReturned:true});
  }
 }
 const positive=observations.find(row=>row.name==='debuggable'&&row.mode==='ordinary').reports.find(row=>row.kind==='mach');
 const guarded=observations.filter(row=>row.name==='protected').map(row=>row.reports.find(report=>report.kind==='mach'));
 t.diagnostic(JSON.stringify({candidate:'hardened runtime without get-task-allow',productionAdopted:false,
  ownTargetMachReadPositive:positive.canaryRead===true,protectedMachReadsDenied:guarded.every(row=>row.canaryRead===false),observations}));
});
