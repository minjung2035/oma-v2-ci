/** The held Society fence is inherited physically at its slot; this grants no lease/role.
 * A paid scope enrolls with the fence creator, so an arbitrary socketpair is not a fence. */
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
import {tryHoldSociety} from '#oma-test/app/runtime/society-lease';

for(const mode of ['ordinary','occupied-slot','explicit-same-socket'])test(`001. Darwin ${mode} child retains the Society fence after its parent returns its copy`,{timeout:45000},async t=>{
 if(process.platform!=='darwin'){t.diagnostic('NOT_RUN: actual Darwin cooperation socket handoff');return;}
 const base=realpathSync(mkdtempSync(join(tmpdir(),'oma-darwin-fence-'))),root=join(base,'state'),sockets=[],fds=new Set();
 let runtime,held,next;const previous=process.env[SOCIETY_FENCE_ENV];
 const restore=()=>{if(previous===undefined)delete process.env[SOCIETY_FENCE_ENV];else process.env[SOCIETY_FENCE_ENV]=previous;};
 t.after(async()=>{restore();await runtime?.close();for(const lease of[held,next])lease?.release();for(const fd of fds)closeSync(fd);for(const socket of sockets)socket.destroy();rmSync(base,{recursive:true});});
 const pair=()=>{const p=controlSocketPair();fds.add(p.parent);const socket=new Socket({fd:p.child,readable:true,writable:false});sockets.push(socket);let bytes='',ended=false;socket.on('data',chunk=>{bytes+=chunk;});socket.on('end',()=>{ended=true;});socket.on('error',()=>{});return{...p,bytes:()=>bytes,ended:()=>ended};};
 held=tryHoldSociety(root);assert.notEqual(held,null);const own={parent:held.fence},other=mode==='occupied-slot'?pair():undefined;
 ExecutionJournal.initialize(root);runtime=new ExecutionRuntime(root,launchDarwinJobScope);await runtime.recover();
 const explicit=mode==='explicit-same-socket'?[{target:4,fd:own.parent}]:other?[{target:4,fd:other.parent}]:[];
 const script=`const fs=require('node:fs'),assert=require('node:assert/strict');const fd=Number(process.env.OMA_SOCIETY_FENCE_FD);assert.equal(fs.fstatSync(fd).isSocket(),true);${other?"assert.notEqual(fd,4);fs.writeSync(4,'explicit-slot');":"assert.equal(fd,4);"}process.stdout.write(JSON.stringify({slot:fd}));`;
 process.env[SOCIETY_FENCE_ENV]=String(held.fence);
 let released=false;
 const result=await runtime.run('preparation',{executable:realpathSync(process.execPath),argv:['-e',script],env:{PATH:'/usr/bin:/bin'},timeoutMs:10000,stdoutBytes:4096,stderrBytes:4096},t.signal,()=>{
  // Setup already transferred fileport copies. There is no parent hold once
  // the workload is released, and setup/cleanup sees no stale environment FD.
  if(other){fds.delete(other.parent);closeSync(other.parent);}assert.equal(tryHoldSociety(root),null);const lease=held;held=undefined;lease.release();restore();released=true;
 },[],undefined,undefined,(source,options)=>launchDarwinJobScope(source,{...options,files:explicit}));
 assert.equal(released,true);assert.equal(result.kind,'exited');assert.equal(result.exitCode,0,result.stderr.toString());
 assert.equal(JSON.parse(result.stdout).slot,mode==='occupied-slot'?5:4);
 const end=performance.now()+2000;while(other && !other.ended()){assert.ok(performance.now()<end,'the explicit slot copy returned');await delay(5);}
 if(other)assert.equal(other.bytes(),'explicit-slot');
 assert.equal(runtime.confirmDead('preparation'),true);assert.deepEqual(ExecutionJournal.inspect(root),[]);
 const limit=performance.now()+16000;while((next=tryHoldSociety(root))===null){assert.ok(performance.now()<limit,'complete scope death and drain return the Society');await delay(20);}
});
