import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
const forbidden=[];
const hook=registerHooks({resolve(specifier,context,next){
  const answer=next(specifier,context);
  if(specifier==='node:sqlite'||/\/(?:storage|mail|git|lifecycle|reconcile)\/(?:dist|src)\//.test(answer.url))forbidden.push(answer.url);
  return answer;
}});
const {Broker}=await import('@oma/broker');
const {ProcessLock}=await import('@oma/native/process-lock');
const {socketDescriptor}=await import('@oma/native/linux');
const {enableUnixCredentials}=await import('@oma/native/unix-message');
hook.deregister();assert.deepEqual(forbidden,[],'Broker import must not load concrete state or feature owners');
assert.throws(()=>Reflect.construct(Broker,[{}, {}, {}]),{code:'BROKER_UNAVAILABLE'});
const root=mkdtempSync(join(tmpdir(),'oma-installed-broker-')),runRoot=join(root,'run');mkdirSync(runRoot);
const lockPath=join(runRoot,'broker.lock'),lock=ProcessLock.acquire(lockPath);
const limits={frameBytes:262144,mailBodyBytes:262144,subjectBytes:512,addresses:64,replyReferences:64,
 contextFiles:256,contextBytes:8388608,bundleBytes:268435456,logBytes:1048576,batchMaxMessages:24,idleStreamSeconds:30,receiptWaitSeconds:30};
let closed=false,bound=false,revoker;
const snapshot=()=>Promise.resolve({observedAtMs:Date.now(),units:new Map(),failure:null});
const unavailable=()=>{throw Error('no mutation requested in installed transport/lifetime smoke');};
const pub={store:{listAgents:()=>[],getAgent:()=>null,getReceipt:()=>null,hasOperation:()=>false},mail:{send:unavailable},
 units:{statusSnapshot:snapshot},views:{status:()=>[]},lifecycle:{setSociety:unavailable,create:unavailable,start:unavailable,stop:unavailable,ack:unavailable,follow:unavailable},git:null,review:null,limits};
const dependencies={
 acquireRunScope:unavailable,
 ledger:{agentNames:()=>[],getAgent:()=>null,listAgents:()=>[],preparedBatches:()=>[],societyOpen:()=>true,transaction:unavailable},
 mail:{prepare:unavailable,complete:unavailable,settleFromReceipt:unavailable},
 units:{observe:unavailable,scopeRoot:unavailable,runnerAlive:unavailable,readLogs:unavailable,bindRunRevoker:callback=>{revoker=callback;}},
 views:{refreshWorld(){},publishStatus(){},observeRunnerSource(){}},reconcile:null,status:{request:snapshot},public:pub,
 internal:{store:{getAgentIdentity:()=>null,pendingDeliveryCount:()=>0,getBatchAgent:()=>null,preparedBatchIds:()=>[]},
 mail:{prepare:unavailable,complete:unavailable,moveToCur:unavailable}},
 effects:{pinPeer:unavailable,assertEndpoint:unavailable,openListener(serve,maxConnections){const listener=createServer({allowHalfOpen:true,pauseOnConnect:true},serve);if(maxConnections!==undefined)listener.maxConnections=maxConnections;return{listener,prepare(){const fd=socketDescriptor(listener);assert.notEqual(fd,null);enableUnixCredentials(fd);}};},peerStream:unavailable,
 bindAdmission:()=>{bound=true;},ensureRunRoot(){},ensureActorDirectory:unavailable,
 prepareEndpoint:path=>{assert.equal(existsSync(path),false);},removeStatusView(){},makeSpool:unavailable,closeLedger:()=>{closed=true;}},
};
const broker=new Broker(dependencies,{stateRoot:root,runRoot,society:'demo',hasGoal:()=>true},limits,lock);
try{
 assert.equal(bound,true);await broker.start();assert.equal(typeof revoker,'function');
 assert.equal(existsSync(join(runRoot,'admin.sock')),true);assert.equal(existsSync(join(runRoot,'host.sock')),false);
 assert.equal(ProcessLock.tryAcquire(lockPath),null);
 const closing=broker.drainAndClose();assert.equal(broker.drainAndClose(),closing);await closing;
 assert.equal(closed,true);assert.equal(ProcessLock.tryAcquire(lockPath),null,'outer owner retains the lock after Broker drain');
 lock.close();const next=ProcessLock.tryAcquire(lockPath);assert.ok(next);next.close();
}finally{try{await broker.drainAndClose();}finally{lock.close();rmSync(root,{recursive:true,force:true});}}
