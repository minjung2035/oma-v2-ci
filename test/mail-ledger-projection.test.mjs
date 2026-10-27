import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '@oma/storage';
import {mailLedger} from "#oma-test/app/broker/mail-composition";
import {makeValidAgent} from '../dist/test/fixtures/spec.js';
const refused=error=>error?.code==='INTERNAL_ERROR';
function world(t){
 const root=mkdtempSync(join(tmpdir(),'oma-mail-ledger-'));
 const store=new Store(join(root,'runtime.sqlite'));
 t.after(()=>{try{store.close();}finally{rmSync(root,{recursive:true,force:true});}});
 return {store,ledger:mailLedger(store)};
}
test('DR46 Mail: a projected transaction cannot escape its original root transaction',t=>{
 const {store,ledger}=world(t);let saved;
 ledger.transaction(tx=>{saved=tx;assert.ok(Object.isFrozen(tx));});
 assert.ok(Object.isFrozen(ledger));
 assert.equal('db' in ledger,false);assert.equal('insertAgent' in ledger,false);assert.equal('close' in ledger,false);
 assert.equal('insertAgent' in saved,false);assert.equal('operations' in saved,false);
 assert.throws(()=>saved.setOperationSucceeded('op-missing','{}'),refused);
 assert.throws(()=>saved.markMaterialized('m-missing','bob'),refused);
 store.transaction(()=>assert.throws(()=>saved.setOperationSucceeded('op-missing','{}'),refused));
 store.transaction(()=>assert.throws(()=>saved.markMaterialized('m-missing','bob'),refused));
 ledger.transaction(tx=>{assert.notEqual(tx,saved);assert.throws(()=>saved.setOperationSucceeded('op-missing','{}'),refused);});
 assert.equal(store.inTransaction,false);
});
test('DR46 Mail: real projection retains runtime Promise and thenable rejection',t=>{
 const {store,ledger}=world(t);
 assert.throws(()=>ledger.transaction(()=>Promise.resolve('escaped')),refused);
 assert.throws(()=>ledger.transaction(()=>({then(){}})),refused);
 assert.equal(store.inTransaction,false);
 store.transaction(tx=>tx.insertAgent(makeValidAgent('alice')));
 assert.equal(ledger.getAgent('alice').name,'alice');
});
test('DR46 Mail: readers observe current authority without an adapter snapshot',t=>{
 const {store,ledger}=world(t);assert.equal(ledger.getAgent('alice'),null);
 store.transaction(tx=>tx.insertAgent(makeValidAgent('alice')));
 assert.equal(ledger.getAgent('alice').incarnation,1);
 store.transaction(tx=>tx.updateAgent({name:'alice',incarnation:2}));
 assert.equal(ledger.getAgent('alice').incarnation,2);
 assert.deepEqual(ledger.listAgents().map(agent=>agent.name),['alice']);
});
