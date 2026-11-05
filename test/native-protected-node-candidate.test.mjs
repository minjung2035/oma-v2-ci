/** Own Node/signing/child-memory comparison. This creates no product runtime
 * selection, entitlement installation, credential or guard exception. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,copyFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {fileDigest} from '@oma/storage/file-digest';
import {ExecutionJournal} from '@oma/storage/execution-journal';
import {launchDarwinJobScope} from '@oma/platform-mac/job-scope';
import {ExecutionRuntime} from '#oma-test/app/runtime/execution-runtime';

test('001. Actual own protected Node retains JIT and native FFI while its own debugger child tests task memory',{timeout:90000},async t=>{
 if(process.platform!=='darwin'){t.diagnostic('NOT_RUN: Darwin protected Node candidate');return;}
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-protected-node-'))),node=join(root,'node'),probe=join(root,'observer');
 ExecutionJournal.initialize(root);const runtime=new ExecutionRuntime(root,launchDarwinJobScope);
 t.after(async()=>{await runtime.close();rmSync(root,{recursive:true});});await runtime.recover();
 const run=(program,argv)=>{const r=spawnSync(program,argv,{encoding:'utf8',timeout:30000});assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr);return r;};
 const sourceDigest=fileDigest(process.execPath).sha256;copyFileSync(process.execPath,node);assert.equal(fileDigest(node).sha256,sourceDigest);
 const keys=['allow-dyld-environment-variables','allow-jit','allow-unsigned-executable-memory','disable-executable-page-protection','disable-library-validation'];
 const entitlements=join(root,'node.plist');writeFileSync(entitlements,'<?xml version="1.0"?><plist version="1.0"><dict>'+keys.map(key=>'<key>com.apple.security.cs.'+key+'</key><true/>').join('')+'</dict></plist>');
 run('/usr/bin/codesign',['--force','--sign','-','--options','runtime','--entitlements',entitlements,node]);
 const nodeSigning=run('/usr/bin/codesign',['--display','--verbose=4',node]),nodeEntitlements=run('/usr/bin/codesign',['--display','--entitlements',':-',node]);
 run('/usr/bin/codesign',['--verify','--strict',node]);
 run('/usr/bin/clang',['-Wall','-Wextra','-Werror',fileURLToPath(new URL('./fixtures/darwin-supervisor-guard.c',import.meta.url)),'-o',probe]);
 const debuggerEntitlements=join(root,'debugger.plist');writeFileSync(debuggerEntitlements,'<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.cs.debugger</key><true/></dict></plist>');
 run('/usr/bin/codesign',['--force','--sign','-','--options','runtime','--entitlements',debuggerEntitlements,probe]);
 const script=`import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {address,load} from ${JSON.stringify(import.meta.resolve('koffi'))};
const canary=Buffer.alloc(8);canary.writeBigUInt64LE(0x6f6d612d70726f62n);let sum=0;for(let n=0;n<100000;n++)sum+=n;
assert.equal(sum,4999950000);assert.equal(load(null).func('int getpid()')(),process.pid);
const r=spawnSync(process.argv[1],['own-parent',String(address(canary))],{encoding:'utf8',timeout:10000});
assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr);
assert.equal(canary.readBigUInt64LE(),0x6f6d612d70726f62n);
console.log(JSON.stringify({pid:process.pid,jitSum:sum,nativeFfi:true,observer:JSON.parse(r.stdout)}));`;
 const observations=[];
 for(const [name,executable]of[['original',process.execPath],['protected',node]]){
  const chunks=[];let result;
  try{result=await runtime.run('preparation',{executable,argv:['--no-global-search-paths','--input-type=module','-e',script,probe],
   cwd:root,env:{HOME:root,TMPDIR:root,PATH:'/usr/bin:/bin'},timeoutMs:20000,stdoutBytes:16384,stderrBytes:16384},t.signal,()=>{},[],undefined,undefined,
   (command,options)=>launchDarwinJobScope(command,{...options,stdoutSink:bytes=>chunks.push(Buffer.from(bytes))}));}
  finally{t.diagnostic(JSON.stringify({name,streamedStdout:Buffer.concat(chunks).toString()}));}
  assert.equal(result.kind,'exited',result.stderr.toString());assert.equal(result.exitCode,0,result.stderr.toString());
  assert.equal(runtime.confirmDead('preparation'),true);assert.deepEqual(ExecutionJournal.inspect(root),[]);
  observations.push({name,...JSON.parse(result.stdout),completeScopeReturned:true});
 }
 assert.equal(fileDigest(process.execPath).sha256,sourceDigest);
 t.diagnostic(JSON.stringify({productionAdopted:false,sourceDigest,derivedDigest:fileDigest(node).sha256,
  signing:nodeSigning.stderr,entitlements:nodeEntitlements.stdout,observations,
  originalMachReadPositive:observations[0].observer.canaryRead===true,protectedMachReadDenied:observations[1].observer.canaryRead===false}));
});
