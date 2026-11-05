/** Actual Git directory-FD experiment. A trace coordinates the rename; only
 * file contents, actual scope death and resource return establish outcomes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,renameSync,rmSync,closeSync,writeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {openDirectory} from '@oma/native/files';
import {controlPipe} from '@oma/native/control-socket';
import {ExecutionJournal} from '@oma/storage/execution-journal';
import {launchDarwinJobScope,launchSeatbeltJobScope} from '@oma/platform-mac/job-scope';
import {ExecutionRuntime} from '#oma-test/app/runtime/execution-runtime';
import {prepareResidentTools} from '#oma-test/app/runtime/resident-tools';

test('001. Actual Git relative repository effects retain their directory through replacement after setup',{timeout:60000},async t=>{
 if(process.platform!=='darwin')return assert.rejects(launchDarwinJobScope({executable:process.execPath,argv:[],env:{},timeoutMs:null,stdoutBytes:0,stderrBytes:0}),e=>e.cause?.code==='UNSUPPORTED_PROFILE');
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-git-root-reference-')));ExecutionJournal.initialize(root);
 const runtime=new ExecutionRuntime(root,launchDarwinJobScope),held=[];
 t.after(async()=>{await runtime.close();for(const fd of held)closeSync(fd);rmSync(root,{recursive:true});});
 await runtime.recover();const tools=await prepareResidentTools(root,runtime,t.signal,()=>{});
 const env={PATH:'/usr/bin:/bin',HOME:root,TMPDIR:root,LANG:'C',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',
  GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0',GIT_EXEC_PATH:tools.execPath,DEVELOPER_DIR:tools.developer};
 const git=(repository,argv)=>{const r=spawnSync(tools.git,['--git-dir',repository,...argv],{cwd:root,env,encoding:'utf8',timeout:10000});
  assert.equal(r.error,undefined);assert.equal(r.signal,null);return r;};
 for(const seatbelt of [false,true]){
  const original=join(root,seatbelt?'sandbox.git':'ordinary.git'),moved=original+'.moved',replacement=original+'.replacement';
  for(const path of [original,replacement]){const r=git(path,['init','-q','--bare']);assert.equal(r.status,0,r.stderr);}
  const directory=openDirectory(original),gate=controlPipe();held.push(directory,gate.read,gate.write);
  let swapped=false,trace='';
  const sink=bytes=>{
   trace+=Buffer.from(bytes).toString();
   if(!swapped&&trace.includes('setup: git_dir:')){
    swapped=true;renameSync(original,moved);renameSync(replacement,original);
    writeSync(gate.write,Buffer.from('held Git directory\n'));closeSync(gate.write);held.splice(held.indexOf(gate.write),1);
   }
  };
  const policy={readable:[{path:root,kind:'directory'},{path:tools.contents,kind:'directory'}],
   writable:[{path:root,kind:'directory'}],mapped:[{path:tools.contents,kind:'directory'}],denied:[],
   executable:[{path:tools.git,kind:'file'},{path:tools.execPath,kind:'directory'}],unixSockets:[],machServices:[],environmentKeys:Object.keys({...env,GIT_TRACE_SETUP:'1'})};
  const result=await runtime.run('preparation',{executable:tools.git,argv:['--git-dir','.','hash-object','-w','--stdin'],
   env:{...env,GIT_TRACE_SETUP:'1'},stdinFd:gate.read,timeoutMs:10000,stdoutBytes:8192,stderrBytes:16384},t.signal,()=>{},[],undefined,undefined,
   (command,options)=>seatbelt?launchSeatbeltJobScope(command,policy,{...options,directoryFd:directory,stderrSink:sink}):
    launchDarwinJobScope(command,{...options,directoryFd:directory,stderrSink:sink}));
  assert.equal(result.kind,'exited',result.stderr.toString());assert.equal(result.exitCode,0,result.stderr.toString());assert.equal(swapped,true,trace);
  const oid=result.stdout.toString().trim();assert.match(oid,/^[a-f0-9]{40,64}$/);
  const expected=git(moved,['cat-file','-p',oid]),wrong=git(original,['cat-file','-e',oid]);
  assert.equal(expected.status,0,expected.stderr);assert.equal(expected.stdout,'held Git directory\n');assert.notEqual(wrong.status,0);
  assert.equal(runtime.confirmDead('preparation'),true);assert.deepEqual(ExecutionJournal.inspect(root),[]);
  t.diagnostic(JSON.stringify({seatbelt,changedAfterGitSetup:true,originalReceivedWrite:true,replacementReceivedWrite:false,
   trace,completeScopeReturned:true,productionBindingAdopted:false}));
 }
});
