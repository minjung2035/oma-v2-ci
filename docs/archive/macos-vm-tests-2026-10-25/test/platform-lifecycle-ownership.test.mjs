import * as sessionHandoffMeaning from "@oma/protocol/session-handoff";
import * as hostErrorMeaning from "@oma/protocol/host-errors";
import * as hostLossMeaning from "@oma/process/host-loss";
import * as deploymentMeaning from "@oma/domain/deployment";
// DR27/P0-4/P0-5: real lifecycle over manually scheduled observations.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import ts from 'typescript';
const code=ts.transpileModule(readFileSync('apps/oma/src/platform/host/lifecycle.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
class PlatformError extends Error {constructor(failure){super(failure.message);this.failure=failure;}}
const module_={exports:{}};
new Script(code).runInNewContext({exports:module_.exports,module:module_,Promise,AbortController,require(name){
if (name === "@oma/protocol/session-handoff") return sessionHandoffMeaning;
if (name === "@oma/protocol/host-errors") return hostErrorMeaning;
if (name === "@oma/process/host-loss") return hostLossMeaning;
if (name === "@oma/domain/deployment") return deploymentMeaning;
assert.equal(name,'../rpc.js');return {PlatformError};}});
const {VmLifecycle}=module_.exports;
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};};
function world({bootWait=null,timeWait=null,listWait=null,healthWait=null,autoPower=true}={}){
 let now=0,next=0,stopped=()=>{},starts=0,forced=0;
 const timers=new Map(),calls=[],records=[];
 const after=(ms,run)=>{const id=++next;timers.set(id,{at:now+ms,ms,run});return {cancel:()=>timers.delete(id)};};
 const control=generation=>({isClosed:false,close(){this.isClosed=true;},async request(method){calls.push([generation,method]);if(method==='time.set'&&timeWait)await timeWait.promise;if(method==='health.get'&&healthWait)await healthWait.promise;if(method==='power.off'&&autoPower)stopped('guest');return {};}});
 const link={async json(channel){if(channel==='control')return control(starts);return {close(){},async request(method){calls.push([starts,method]);if(method==='society.list')return listWait?await listWait.promise:{societies:[]};return {};}};}};
 const driver={async start(){starts++;if(bootWait)await bootWait.promise;},async forceStop(){forced++;stopped('error');},onStopped(f){stopped=f;}};
 const life=new VmLifecycle({driver,link,now:()=>now,wallClock:()=>1,after,handshakeDeadlineMs:100,handshakeRetryMs:2,drainDeadlineMs:60,healthEveryMs:10,hungAfterMs:30,restarts:{max:3,windowMs:600,backoffMs:1},record:e=>records.push(e)});
 const tick=async ms=>{now+=ms;for(const [id,timer] of [...timers])if(timer.at<=now&&timers.delete(id))timer.run();await flush();};
 return {life,calls,timers,records,tick,crash:()=>stopped('error'),get starts(){return starts;},get forced(){return forced;}};
}
test('VM baseline: normal start and clean stop remain observed',async()=>{const w=world();await w.life.start();assert.equal(w.life.state,'ready');assert.equal(await w.life.stop(),'stopped');assert.equal(w.forced,0);});
test('VM owner: a clean stop returns its deadline timer',async()=>{const w=world();await w.life.start();await w.life.stop();assert.equal(w.timers.size,0,'stop retained its losing drain deadline');});
test('VM owner: the old boot cannot publish ready after its driver stopped',async()=>{const timeWait=deferred(),w=world({timeWait});const starting=w.life.start();await flush();assert.equal(w.life.state,'handshaking');w.crash();assert.equal(w.life.state,'crashed');timeWait.resolve({});await starting.catch(()=>undefined);assert.notEqual(w.life.state,'ready','late time.set revived a dead boot');});
test('VM owner: an old hung timer cannot force-stop a ready successor',async()=>{const healthWait=deferred(),w=world({healthWait});await w.life.start();await w.tick(10);w.crash();await flush();await w.tick(1);assert.equal(w.starts,2);assert.equal(w.life.state,'ready');await w.tick(29);assert.equal(w.forced,0,'old generation hung timer killed new boot');healthWait.resolve({});});
test('VM owner: concurrent stop callers share one drain owner',async()=>{const w=world({autoPower:false});await w.life.start();const first=w.life.stop(),second=w.life.stop();await flush();assert.equal(w.calls.filter(([,m])=>m==='maintenance.begin').length,1,'two simultaneous stop calls ran two drains');w.crash();await Promise.all([first,second]);});
test('VM owner: stop budget begins even while driver start is unresolved',async()=>{const bootWait=deferred(),w=world({bootWait,autoPower:false});void w.life.start().catch(()=>{});await flush();assert.equal(w.starts,1);void w.life.stop().catch(()=>{});await flush();assert.ok([...w.timers.values()].some(t=>t.ms===60),'stop has no deadline until hung start answers');});
test('VM owner: a timed-out drain cannot power off a successor',async()=>{const listWait=deferred(),w=world({listWait,autoPower:false});await w.life.start();const stopping=w.life.stop();await flush();await w.tick(60);assert.equal(await stopping,'forced');await w.life.start();assert.equal(w.starts,2);listWait.resolve({societies:[{society:'demo',running:true}]});await flush();assert.equal(w.calls.some(([g,m])=>g===2&&m==='power.off'),false,'old drain powered off current control');});
