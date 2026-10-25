import assert from 'node:assert/strict';
import { ReconcileModule } from '@oma/reconcile';
assert.throws(() => Reflect.construct(ReconcileModule,[{},null,null,null,{}, {}, {}]),{code:'UNSUPPORTED_PROFILE'});
let open=true, allowed=true, goal=true, pending=true;
let row={name:'alice',role:'resident',desired:'enabled',incarnation:1,specHash:'a'};
const calls=[];
const reads={recoverableOperations:()=>[],getOperationById:()=>null,listAgents:()=>[row],getAgent:()=>row,societyOpen:()=>open};
let observe=()=>({activeState:'inactive'});
const units={observeAsync:async()=>observe(),observe:()=>observe(),confirmDead:()=>true,
 stop:()=>{calls.push('stop');return {activeState:'inactive'};},start:()=>calls.push('start'),startLimitStatus:()=>null};
const effects={observeStoreFailure:error=>{throw error;},quiesceResidents:()=>calls.push('quiesce'),
 collectUnacceptedArtifacts:()=>{calls.push('collect');return Object.freeze({removed:[],kept:[]});},
 canonicalMain:()=>{assert.fail('no canonical owner configured');},assertCanonicalHealthy:async()=>{assert.fail('no Git owner configured');},
 hasPendingWork:()=>pending};
const recon=new ReconcileModule(reads,{reconcileOperation:async()=>{}},null,null,units,{},
 {stateRoot:'/state',hasGoal:()=>goal,activationAllowed:()=>allowed},effects);
await recon.startup(false,async()=>calls.push('prepare'));
assert.deepEqual(calls,['quiesce','collect','prepare']);calls.length=0;
const first=recon.sweep();assert.equal(recon.sweep(),first,'all callers share the same in-flight promise');
assert.deepEqual(await first,{examined:0,repaired:0,remaining:0});assert.deepEqual(calls,['start']);
for(const gate of ['activation','goal','pending']){
 calls.length=0;allowed=gate!=='activation';goal=gate!=='goal';pending=gate!=='pending';await recon.sweep();assert.deepEqual(calls,[],gate);
}
allowed=goal=pending=true;calls.length=0;
units.observeAsync=async()=>{const old={activeState:'inactive'};row={...row,incarnation:row.incarnation+1};return old;};
await recon.sweep();assert.deepEqual(calls,[]);assert.equal(recon.unitDiagnostics[0].reason,'identity_changed');
// An asynchronous inactive result is never a current death proof.
row={...row,desired:'stopped'};units.observeAsync=async()=>({activeState:'inactive'});units.confirmDead=()=>false;
await recon.sweep();assert.deepEqual(calls,['stop']);
assert.deepEqual(recon.startLimitState(),[]);
