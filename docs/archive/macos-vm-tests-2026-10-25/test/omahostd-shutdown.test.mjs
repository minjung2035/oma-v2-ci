import * as sessionHandoffMeaning from "@oma/protocol/session-handoff";
import * as hostErrorMeaning from "@oma/protocol/host-errors";
import * as hostLossMeaning from "@oma/process/host-loss";
import * as deploymentMeaning from "@oma/domain/deployment";
// Exercise the actual daemon entry with controlled native boundaries on Linux.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import ts from 'typescript';
const source=ts.transpileModule(readFileSync('apps/oma/src/entry/omahostd.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
async function world(mode){
 const signals=new Map(),timers=new Set(),exits=[],errors=[];
 let closes=0,shutdowns=0,options;
 const record={instanceId:'instance',installationId:'installation',provisioning:'pending',highestSchemaWritten:1};
 const driver={onPower(){},close(){closes++;if(mode==='close-failure')throw new Error('helper close failed');}};
 const service={lifecycle:{onState(){}},async shutdown(){shutdowns++;if(mode==='failure')throw new Error('VM end unknown');if(mode==='hang')await new Promise(()=>{});return 'stopped';}};
 const exports={};
 new Script(source).runInNewContext({exports,module:{exports},process:{argv:['node','omahostd','--bundle','/app'],platform:'darwin',env:{HOME:'/owned'},getuid:()=>1001,
  stderr:{write:text=>errors.push(text)},exit:code=>exits.push(code),on:(signal,fn)=>signals.set(signal,fn)},
  setTimeout(fn){const timer={fn,unref(){}};timers.add(timer);return timer;},clearTimeout:timer=>timers.delete(timer),
  require(name){
if (name === "@oma/protocol/session-handoff") return sessionHandoffMeaning;
if (name === "@oma/protocol/host-errors") return hostErrorMeaning;
if (name === "@oma/domain/deployment") return deploymentMeaning;
switch(name){
   case 'node:fs':return {chmodSync(){},closeSync(){},constants:{O_WRONLY:1,O_CREAT:2,O_EXCL:4},ftruncateSync(){},openSync:()=>5,statSync:()=>({blocks:0}),readFileSync:path=>path.endsWith('/current')?'version':'public-key'};
   case 'node:crypto':return {createPublicKey:value=>value};
   case 'node:path':return {join:(...parts)=>parts.join('/')};
   case '@oma/platform-mac/image':return {verifyImage:async()=>({version:'version',verityRoot:'hash',paths:{kernel:'k',initrd:'i',system:'s',verity:'v'},stateSchema:{written:3}}),bootableWith(){}};
   case '@oma/platform-mac/vz-driver':return {VzDriver:{launch:()=>driver}};
   case '../platform/host/service.js':return {DEFAULT_TIMINGS:{drainDeadlineMs:60},HostService:{async start(value){options=value;return service;}}};
   case '../platform/host/resolver.js':return {hostResolver:()=>()=>{}};
   case '@oma/platform-mac/record':return {newHostRecord:()=>record,readHostRecord:()=>record,writeHostRecord(){}};
   case '@oma/protocol/host-guest':return {HOST_GUEST_PROTOCOL:7};
   case '../platform/rpc.js':return {connectSocket(){throw new Error('unused');}};
   case '@oma/process/host-loss':return {HOST_LOSS_SIGNALS:['SIGTERM','SIGINT']};
   case '@oma/platform-mac/bookmark':return {nativeProjectBookmarks:()=>({})};
   case '@oma/platform-mac/files':return {ensureHostOwnedDirectory(){}};
   default:throw new Error(`unexpected native boundary ${name}`);
  }} });
 await flush();
 assert.equal(typeof signals.get('SIGTERM'),'function');
 return {signals,timers,exits,errors,get closes(){return closes;},get shutdowns(){return shutdowns;},options};
}
for(const mode of ['success','failure','close-failure'])test(`DR38: daemon shutdown ${mode} reports the real process result`,async()=>{
 const w=await world(mode);
 assert.equal(w.options.stateSchemaWritten,3,'verified image schema must reach mandatory readiness persistence');
 w.signals.get('SIGTERM')();w.signals.get('SIGINT')();await flush();
 assert.deepEqual(w.exits,[mode==='success'?0:1]);
 assert.equal(w.closes,1);assert.equal(w.shutdowns,1);assert.equal(w.timers.size,0);
 if(mode==='failure')assert.match(w.errors.join(''),/VM end unknown/);
});
test('DR38: daemon watchdog failure closes the helper and exits non-zero',async()=>{
 const w=await world('hang');w.signals.get('SIGTERM')();await flush();
 assert.deepEqual(w.exits,[]);assert.equal(w.timers.size,1);
 [...w.timers][0].fn();assert.deepEqual(w.exits,[1]);assert.equal(w.closes,1);
});
