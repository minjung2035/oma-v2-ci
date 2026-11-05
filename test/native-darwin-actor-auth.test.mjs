/** Actual Broker/Resident/Actor authority, using controlled protocol programs.
 * This does not enable guarded product entry, Pi or immutable external imports. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,realpathSync,rmSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {Store} from '@oma/storage';
import {ExecutionJournal} from '@oma/storage/execution-journal';
import {ProcessLock} from '@oma/native/process-lock';
import {createMachBrokerTransport} from '@oma/platform-mac/mach-transport';
import {launchDarwinJobScope} from '@oma/platform-mac/job-scope';
import {defaultHostConfig} from '@oma/config/defaults';
import {withAsyncCleanup} from '@oma/native/cleanup';
import {createMacRuntimeGeneration} from '#oma-test/app/runtime/mac-runtime-generation';
import {deploymentDigest} from '#oma-test/app/runtime/deployment-manifest';
import {ExecutionRuntime} from '#oma-test/app/runtime/execution-runtime';
import {createNativeResidents} from '#oma-test/app/runtime/native-residents';
import {newSessionBirth,publishSessionBirth} from '#oma-test/app/runtime/session-mode';
import {createBroker} from '#oma-test/app/broker/broker-composition';
import {createMailModule} from '#oma-test/app/broker/mail-composition';
import {createLifecycleModule} from '#oma-test/app/broker/lifecycle-composition';
import {ViewsModule} from '#oma-test/app/views';
import {makeValidAgent,ALL_CAPS,withWorkerCapacity} from '../dist/test/fixtures/spec.js';
import {minimalRuntime} from './fixtures/minimal-runtime.mjs';
import {actorProgram,runnerProgram} from './fixtures/darwin-actor-program.mjs';

async function until(read,signal){
 const deadline=performance.now()+30000;
 for(;;){if(signal.aborted)throw signal.reason;const value=read();if(value)return value;assert.ok(performance.now()<deadline,'actual authority observation did not arrive');await delay(10);}
}
function json(path){try{return JSON.parse(readFileSync(path,'utf8'));}catch(e){if(e.code==='ENOENT'||e instanceof SyntaxError)return null;throw e;}}

test('001. Actual Darwin Broker admits the current Run and kernel Actor, refuses another CID and rechecks desired state',{timeout:90000},async t=>{
 if(process.platform!=='darwin')return assert.throws(()=>createMacRuntimeGeneration({libdir:'/unused',node:process.execPath,deploymentDigest:'0'.repeat(64)},'/unused'),{code:'UNSUPPORTED_PROFILE'});
 const parent=realpathSync(mkdtempSync(join(tmpdir(),'oma-actor-auth-'))),root=join(parent,'demo'),runRoot=join(root,'run'),home=join(root,'actor-home');
 mkdirSync(home,{recursive:true,mode:0o700});mkdirSync(runRoot,{mode:0o700});
 let generation,runtime,units,store,broker,lock;
 const shutdown=async()=>{await withAsyncCleanup(()=>units?.close(),()=>runtime?.close());};
 t.after(async()=>{
  if(broker){await broker.drainAndClose();lock.close();}else{await shutdown();store?.close();lock?.close();}
  generation?.close();rmSync(parent,{recursive:true});
 });
 const worker=actorProgram(),source=join(parent,'installation'),fixture=minimalRuntime(source,runnerProgram(worker));
 const runner=join(source,'apps/oma/dist/entry/runner.js');mkdirSync(dirname(runner));renameSync(fixture.entry,runner);
 const installation={...fixture.installation,deploymentDigest:deploymentDigest(source)};
 generation=createMacRuntimeGeneration(installation,parent);ExecutionJournal.initialize(root);runtime=new ExecutionRuntime(root,launchDarwinJobScope);await runtime.recover();
 publishSessionBirth(root,newSessionBirth(root,'society',process.cwd(),'collaboration-v1'));
 store=new Store(join(root,'runtime.sqlite'));store.transaction(tx=>tx.insertAgent(makeValidAgent('alice',{capabilities:ALL_CAPS.filter(capability=>capability!=='context.publish')})));
 const cfg=defaultHostConfig({society:'demo',...installation});cfg.agentProfiles.p=cfg.agentProfiles.resident;cfg.modelProfiles.md=cfg.modelProfiles.worker;
 const physical=createMachBrokerTransport(30),listeners=[],pins=[];
 const transport={...physical,openListener(...args){const result=physical.openListener(...args);listeners.push(result.listener);return result;},
  pinPeer(socket){const pin=physical.pinPeer(socket);if(pin)pins.push(pin);return pin;}};
 units=createNativeResidents(store,runtime,{stateRoot:root,runRoot,society:'demo',configPath:join(root,'config.json')},cfg,
  (socket,peer)=>broker.attachRunner(socket,peer),()=>broker.hintWork(),(actor,invocation)=>broker.residentIncarnation(actor,invocation),
  {environment:{HOME:root,TMPDIR:root,PATH:'/usr/bin:/bin'},darwin:{launchNode:generation.launchNode,reservePeer:physical.reservePeer}});
 const mail=createMailModule({stateRoot:root,society:'demo'},store,cfg.limits.replyReferences,cfg.limits.batchMaxMessages,cfg.limits);
 const lifecycle=createLifecycleModule(store,units,{stateRoot:root,projectGit:join(root,'repos/project.git'),society:'demo',hasGoal:()=>true,activationAllowed:()=>true},
  withWorkerCapacity(()=>{throw Error('authority fixture cannot create agents');}),mail);
 const views=new ViewsModule(store,root,'demo','p',cfg.limits,'collaboration-v1');
 lock=ProcessLock.acquire(join(runRoot,'broker.lock'));
 broker=createBroker({store,mail,units,views,lifecycle,git:null,reviews:null,reconcile:null,transport,
  paths:{stateRoot:root,runRoot,society:'demo',hasGoal:()=>true,quiesceOnDrain:shutdown},limits:cfg.limits,lock});
 await broker.start();await units.start('alice',false);
 const report=await until(()=>json(join(home,'runner.json')),t.signal),positive=await until(()=>json(join(home,'positive.json')),t.signal);
 const rows=ExecutionJournal.inspect(root);assert.equal(rows.length,1);const witness=rows[0].witness;
 assert.equal(witness.kind,'darwin-resource-coalition');assert.equal(store.getAgent('alice').incarnation,2);
 assert.equal(report.lease.actor,'alice');assert.equal(report.lease.incarnation,2);assert.equal(report.wrongActorRefused,true);assert.equal(report.wrongInvocationRefused,true);
 assert.notEqual(report.pid,positive.pid);assert.deepEqual(report.peer,positive.peer);assert.equal(positive.first.ok,true);
 const accepted=pins.find(pin=>pin.pid===positive.pid);assert.ok(accepted);assert.equal(accepted.alive(),true);assert.equal(accepted.inScope(witness),true);

 // The real endpoint capability and same Host provenance still grant no
 // Actor role to an independently launched coalition.
 const peer=listeners.at(-1).peerSource();let foreign;
 try{
  foreign=await runtime.run('preparation',{executable:installation.node,argv:['--no-global-search-paths','--input-type=module','-e',worker,
   JSON.stringify({foreign:true,path:report.lease.socketHostPath,home,stateRoot:root,limits:cfg.limits})],
   cwd:home,env:{HOME:home,TMPDIR:home},timeoutMs:15000,stdoutBytes:8192,stderrBytes:16384},t.signal,()=>{},[],undefined,undefined,
   (command,options)=>launchDarwinJobScope(command,{...options,peer}));
 }finally{peer.close();}
 assert.equal(foreign.kind,'exited');assert.equal(foreign.exitCode,0,foreign.stderr.toString());
 const rejected=JSON.parse(foreign.stdout);assert.equal(rejected.refused,true);assert.notEqual(rejected.pid,positive.pid);
 assert.equal(runtime.confirmDead('preparation'),true);assert.equal(accepted.inScope(witness),true);

 store.transaction(tx=>tx.updateAgent({name:'alice',desired:'stopped'}));writeFileSync(join(home,'revoke'),'go');
 const stale=await until(()=>json(join(home,'stale.json')),t.signal);assert.equal(stale.pid,positive.pid);assert.equal(stale.stale.error.code,'STALE_RUN');
 assert.equal(accepted.alive(),true);assert.equal(accepted.inScope(witness),true,'current authority refusal is observed before scope death');
 writeFileSync(join(home,'finish'),'go');writeFileSync(join(home,'runner-finish'),'go');
 await units.stop('alice',2);assert.equal(runtime.confirmDead('resident:alice'),true);assert.deepEqual(ExecutionJournal.inspect(root),[]);
 assert.equal(accepted.alive(),false);assert.equal(store.getAgent('alice').incarnation,2);
 t.diagnostic(JSON.stringify({currentRunCommitted:true,kernelActorAdmitted:true,otherCoalitionRefused:true,desiredRefusedBeforeDeath:true,completeScopeReturned:true}));
});
