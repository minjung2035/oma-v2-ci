import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Store } from '@oma/storage';
import { StoreError } from '@oma/domain/errors';
import { observeStoreFailure } from '@oma/domain/admission';
import { brokerLedger } from "#oma-test/app/broker/broker-composition";
import { testBroker } from '../dist/test/helpers/broker-fixture.js';
import { ledgerFixture, agentRecord, routeOperation, routeResult } from './helpers/ledger-fixture.mjs';

test('DR46 Broker: incarnation writes retain the original captured T and refuse stale or borrowed scopes',t=>{
 const {store}=ledgerFixture(t),ledger=brokerLedger(store);let saved;
 ledger.transaction(tx=>{saved=tx;assert.ok(Object.isFrozen(tx));assert.deepEqual(Object.keys(tx),['updateIncarnation']);});
 for(const field of ['path','db','close','acceptOperation','insertAgent','updateAgent'])assert.equal(field in ledger,false,field);
 const stale=()=>assert.throws(()=>saved.updateIncarnation('alice',1),{code:'INTERNAL_ERROR'});
 stale();store.transaction(stale);ledger.transaction(tx=>{assert.notEqual(saved,tx);stale();});
 assert.equal(ledger.getAgent('alice').incarnation,0);
 const original=ledger.getAgent('alice');ledger.transaction(tx=>tx.updateIncarnation('alice',1));
 const current=ledger.getAgent('alice');assert.equal(current.incarnation,1);assert.equal(current.desired,original.desired);assert.equal(current.specJson,original.specJson);
});
test('DR46 Broker: async and thenable T results roll back incarnation writes and queries remain live',t=>{
 const {store}=ledgerFixture(t),ledger=brokerLedger(store);
 for(const late of [()=>Promise.resolve('late'),()=>({then(){}})])
  assert.throws(()=>ledger.transaction(tx=>{tx.updateIncarnation('alice',1);return late();}),{code:'INTERNAL_ERROR'});
 assert.equal(ledger.getAgent('alice').incarnation,0);assert.equal(store.inTransaction,false);
 store.transaction(tx=>tx.updateAgent({name:'alice',incarnation:2,desired:'stopped'}));
 assert.equal(ledger.getAgent('alice').incarnation,2);assert.equal(ledger.getAgent('alice').desired,'stopped');
});
test('DR46 Broker: application admission binds the original Store rather than its projected ledger',async()=>{
 const root=mkdtempSync(join(tmpdir(),'oma-broker-admission-')),store=new Store(join(root,'runtime.sqlite'),0,{society:'fixture'});
 let broker;
 try{
 store.transaction(tx=>{tx.insertAgent(agentRecord('principal'));tx.insertAgent(agentRecord('alice','principal'));});
 broker=testBroker({store,mail:{},units:{},views:{observeRunnerSource(){},refreshWorld(){throw Error('corrupt admission reached startup effects');},publishStatus(){}},
  lifecycle:{},git:null,reviews:null,reconcile:null,paths:{stateRoot:root,runRoot:join(root,'run'),society:'fixture',hasGoal:()=>true}});
  observeStoreFailure(store,new StoreError('STORE_CORRUPT','injected durable corruption'));
  assert.throws(()=>broker.start(),{code:'STORE_CORRUPT'});
  assert.throws(()=>store.transaction(tx=>tx.acceptOperation(routeOperation())),{code:'STORE_CORRUPT'});
  assert.equal(brokerLedger(store).getAgent('alice').name,'alice','diagnostic reads remain available');
 }finally{try{if(broker)await broker.drainAndClose();else store.close();}finally{rmSync(root,{recursive:true,force:true});}}
});
for(const position of ['before-commit','after-commit'])
 test(`DR46 Broker ledger: SIGKILL ${position} retains the incarnation boundary and exact earlier receipt`,t=>{
  const {root,store,close}=ledgerFixture(t),operation=routeOperation({requestKey:'original'});
  store.transaction(tx=>{tx.acceptOperation(operation);tx.follow('design','alice');tx.setOperationSucceeded(operation.id,routeResult(operation));});
  const original=store.getOperationById(operation.id);close();
  const code=`
   import {Store} from ${JSON.stringify(import.meta.resolve('@oma/storage'))};
   import {brokerLedger} from ${JSON.stringify(new URL(import.meta.resolve("#oma-test/app/broker/broker-composition")).href)};
   const store=new Store(${JSON.stringify(join(root,'runtime.sqlite'))},0,{society:'fixture'});
   brokerLedger(store).transaction(tx=>{tx.updateIncarnation('alice',1);${position==='before-commit'?"process.kill(process.pid,'SIGKILL');":''}});
   ${position==='after-commit'?"process.kill(process.pid,'SIGKILL');":''}
   process.exitCode=99;
  `;
  const child=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',timeout:10000});
  assert.equal(child.signal,'SIGKILL',child.stderr);
  const reopened=new Store(join(root,'runtime.sqlite'),0,{society:'fixture'});
  try{
   assert.equal(reopened.getAgent('alice').incarnation,position==='before-commit'?0:1);
   assert.deepEqual(reopened.getOperationById(operation.id),original);
   assert.equal(reopened.transaction(tx=>tx.acceptOperation(operation)),'retry');
   assert.deepEqual(reopened.getOperationById(operation.id),original);
  }finally{reopened.close();}
 });
