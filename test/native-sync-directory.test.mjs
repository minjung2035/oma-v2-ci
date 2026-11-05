/** Actual child effects, not invocation-shape assertions. A directory
 * capability never changes the host cwd or grants a new sandbox permission. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {closeSync,fstatSync,mkdirSync,mkdtempSync,openSync,realpathSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {runProcessSync} from '@oma/process/run';
import {SOCIETY_FENCE_ENV} from '@oma/process/async';
import {controlSocketPair} from '@oma/native/control-socket';
import {bundledSeatbeltHelper} from '@oma/native/darwin-job-assets';
import {ExecutionJournal} from '@oma/storage/execution-journal';
import {launchDarwinJobScope,launchSeatbeltJobScope} from '@oma/platform-mac/job-scope';
import {ExecutionRuntime} from '#oma-test/app/runtime/execution-runtime';

for(const fenced of[false,true])test(`001. Synchronous directory execution uses its held root through replacement${fenced?' and preserves an explicit cooperation socket':''}`,t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-sync-directory-'))),original=join(root,'original'),replacement=join(root,'replacement'),moved=join(root,'moved');
 for(const p of[original,replacement])mkdirSync(p);writeFileSync(join(original,'canary'),'original');writeFileSync(join(replacement,'canary'),'replacement');
 const directory=openSync(original,'r'),identity=fstatSync(directory,{bigint:true}),before=process.cwd(),pair=fenced?controlSocketPair():undefined,previous=process.env[SOCIETY_FENCE_ENV];
 t.after(()=>{closeSync(directory);if(pair){closeSync(pair.parent);closeSync(pair.child);}rmSync(root,{recursive:true});});
 if(pair)process.env[SOCIETY_FENCE_ENV]=String(pair.parent);else delete process.env[SOCIETY_FENCE_ENV];
 const script=`const f=require('node:fs'),a=require('node:assert/strict');
try{const s=f.fstatSync(3,{bigint:true});a.notDeepEqual({dev:String(s.dev),ino:String(s.ino)},${JSON.stringify({dev:String(identity.dev),ino:String(identity.ino)})});}catch(e){if(e.code!=='EBADF')throw e;}
${fenced?"a.equal(f.fstatSync(4).isSocket(),true);":""}
console.log(JSON.stringify({cwd:process.cwd(),canary:f.readFileSync('canary','utf8')}));`;
 let result;
 try{result=runProcessSync({executable:process.execPath,argv:['-e',script],env:{PATH:'/usr/bin:/bin'},timeoutMs:5000,stdoutBytes:8192,stderrBytes:8192},
  (program,args,options)=>{renameSync(original,moved);renameSync(replacement,original);return spawnSync(program,args,options);},[],{directoryFd:directory});}
 finally{if(previous===undefined)delete process.env[SOCIETY_FENCE_ENV];else process.env[SOCIETY_FENCE_ENV]=previous;}
 assert.equal(result.kind,'exited',result.stderr.toString());assert.equal(result.exitCode,0,result.stderr.toString());
 assert.deepEqual(JSON.parse(result.stdout),{cwd:moved,canary:'original'});assert.equal(process.cwd(),before);assert.equal(fstatSync(directory,{bigint:true}).ino,identity.ino);
});

test('002. Actual Darwin directory child preserves its inherited Seatbelt denial',{timeout:30000},async t=>{
 if(process.platform!=='darwin'){t.diagnostic('NOT_RUN: Darwin directory child under actual Seatbelt');return;}
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-sync-sandbox-'))),secret=join(root,'secret');writeFileSync(secret,'forbidden');ExecutionJournal.initialize(root);
 const runtime=new ExecutionRuntime(root,launchDarwinJobScope);t.after(async()=>{await runtime.close();rmSync(root,{recursive:true});});await runtime.recover();
 const helper=bundledSeatbeltHelper(),script=`const f=require('node:fs'),a=require('node:assert/strict'),c=require('node:child_process');const fd=f.openSync(process.env.HOME,'r');
const r=c.spawnSync(${JSON.stringify(helper)},['--directory-fd3',process.execPath,'-e',${JSON.stringify(`const a=require('node:assert/strict');a.throws(()=>require('node:fs').readFileSync(${JSON.stringify(secret)}),e=>['EPERM','EACCES'].includes(e.code));process.stdout.write('inherited-denial');`)}],{encoding:'utf8',stdio:['ignore','pipe','pipe',fd]});f.closeSync(fd);
a.equal(r.error,undefined);a.equal(r.status,0,r.stderr);process.stdout.write(r.stdout);`;
 const command={executable:process.execPath,argv:['-e',script],cwd:root,env:{HOME:root,TMPDIR:root,PATH:'/usr/bin:/bin'},timeoutMs:10000,stdoutBytes:8192,stderrBytes:8192};
 const policy={readable:[],writable:[{path:root,kind:'directory'}],denied:[{path:secret,kind:'file'}],
  executable:[{path:process.execPath,kind:'file'},{path:helper,kind:'file'}],unixSockets:[],machServices:[],environmentKeys:['HOME','TMPDIR','PATH']};
 const result=await runtime.run('preparation',command,t.signal,()=>{},[],undefined,undefined,(source,options)=>launchSeatbeltJobScope(source,policy,options));
 assert.equal(result.kind,'exited',result.stderr.toString());assert.equal(result.exitCode,0,result.stderr.toString());assert.equal(result.stdout.toString(),'inherited-denial');
 assert.equal(runtime.confirmDead('preparation'),true);assert.deepEqual(ExecutionJournal.inspect(root),[]);
});
