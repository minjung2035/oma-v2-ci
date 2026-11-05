/** A cooperation socket is inherited physically; this grants no lease/role. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,closeSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Socket} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {controlSocketPair} from '@oma/native/control-socket';
import {SOCIETY_FENCE_ENV} from '@oma/process/async';
import {ExecutionJournal} from '@oma/storage/execution-journal';
import {launchDarwinJobScope} from '@oma/platform-mac/job-scope';
import {ExecutionRuntime} from '#oma-test/app/runtime/execution-runtime';

for(const mode of ['ordinary','occupied-slot','explicit-same-socket'])test(`001. Darwin ${mode} child retains the cooperation socket after its parent returns its copy`,{timeout:45000},async t=>{
 if(process.platform!=='darwin'){t.diagnostic('NOT_RUN: actual Darwin cooperation socket handoff');return;}
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-darwin-fence-'))),sockets=[],fds=new Set();
 let runtime;const previous=process.env[SOCIETY_FENCE_ENV];
 const restore=()=>{if(previous===undefined)delete process.env[SOCIETY_FENCE_ENV];else process.env[SOCIETY_FENCE_ENV]=previous;};
 t.after(async()=>{restore();await runtime?.close();for(const fd of fds)closeSync(fd);for(const socket of sockets)socket.destroy();rmSync(root,{recursive:true});});
 const pair=()=>{const p=controlSocketPair();fds.add(p.parent);const socket=new Socket({fd:p.child,readable:true,writable:false});sockets.push(socket);let bytes='',ended=false;socket.on('data',chunk=>{bytes+=chunk;});socket.on('end',()=>{ended=true;});socket.on('error',()=>{});return{...p,bytes:()=>bytes,ended:()=>ended};};
 const own=pair(),other=mode==='occupied-slot'?pair():undefined;
 ExecutionJournal.initialize(root);runtime=new ExecutionRuntime(root,launchDarwinJobScope);await runtime.recover();
 const explicit=mode==='explicit-same-socket'?[{target:4,fd:own.parent}]:other?[{target:4,fd:other.parent}]:[];
 const script=`const fs=require('node:fs'),assert=require('node:assert/strict');const fd=Number(process.env.OMA_SOCIETY_FENCE_FD);assert.equal(fs.fstatSync(fd).isSocket(),true);${other?"assert.notEqual(fd,4);fs.writeSync(4,'explicit-slot');":"assert.equal(fd,4);"}fs.writeSync(fd,'inherited-cooperation');process.stdout.write(JSON.stringify({slot:fd}));`;
 process.env[SOCIETY_FENCE_ENV]=String(own.parent);
 let released=false;
 const result=await runtime.run('preparation',{executable:realpathSync(process.execPath),argv:['-e',script],env:{PATH:'/usr/bin:/bin'},timeoutMs:10000,stdoutBytes:4096,stderrBytes:4096},t.signal,()=>{
  // Setup already transferred fileport copies. There is no parent hold once
  // the workload is released, and setup/cleanup sees no stale environment FD.
  for(const p of[own,other])if(p){fds.delete(p.parent);closeSync(p.parent);}restore();released=true;
 },[],undefined,undefined,(source,options)=>launchDarwinJobScope(source,{...options,files:explicit}));
 assert.equal(released,true);assert.equal(result.kind,'exited');assert.equal(result.exitCode,0,result.stderr.toString());
 assert.equal(JSON.parse(result.stdout).slot,mode==='occupied-slot'?5:4);
 const end=performance.now()+2000;while(!own.ended() || other && !other.ended()){assert.ok(performance.now()<end,'all inherited socket copies returned');await delay(5);}
 assert.equal(own.bytes(),'inherited-cooperation');if(other)assert.equal(other.bytes(),'explicit-slot');
 assert.equal(runtime.confirmDead('preparation'),true);assert.deepEqual(ExecutionJournal.inspect(root),[]);
});
