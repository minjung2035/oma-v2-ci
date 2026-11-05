/** Actual Store transactions and schema preflight through a held root. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {closeSync,linkSync,mkdirSync,mkdtempSync,openSync,readFileSync,readdirSync,realpathSync,renameSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '@oma/storage';
import {resolvedSpecDigest} from '@oma/domain/spec-identity';

function seed(store){
 const spec={name:'alice',from:'0'.repeat(40),brief:'hello',profile:'p',modelProfile:'m',capabilities:['mail.send']};
 store.transaction(tx=>tx.insertAgent({name:spec.name,specJson:JSON.stringify(spec),specHash:resolvedSpecDigest(spec),role:'resident',desired:'enabled',incarnation:1,profile:spec.profile,createdBy:null}));
}
for(const replacement of ['before-open','while-open'])test(`001. Rooted Store ${replacement} keeps transactions, rollback and reopen on its original directory`,t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-store-directory-'))),directory=join(root,'state'),moved=directory+'-moved',path=join(directory,'runtime.sqlite'),before=process.cwd();mkdirSync(directory,{mode:0o700});let fd=openSync(directory,'r'),store;
 t.after(()=>{store?.close();if(fd!==undefined)closeSync(fd);rmSync(root,{recursive:true});});
 if(process.platform!=='darwin'){assert.throws(()=>new Store(path,undefined,null,undefined,{directoryFd:fd}),error=>error.code==='UNSUPPORTED_PROFILE');assert.deepEqual(readdirSync(directory),[]);t.diagnostic('NOT_RUN: actual Darwin rooted Store');return;}
 const replace=()=>{renameSync(directory,moved);mkdirSync(directory,{mode:0o700});};
 if(replacement==='before-open')replace();
 store=new Store(path,undefined,null,undefined,{directoryFd:fd});seed(store);if(replacement==='while-open')replace();
 assert.throws(()=>store.transaction(tx=>{tx.updateAgent({name:'alice',desired:'stopped'});throw new Error('fixture rollback');}),/fixture rollback/);
 assert.equal(store.getAgent('alice').desired,'enabled');store.transaction(tx=>tx.updateAgent({name:'alice',desired:'stopped'}));assert.equal(store.getAgent('alice').desired,'stopped');
 assert.deepEqual(readdirSync(directory),[]);assert.ok(readdirSync(moved).includes('runtime.sqlite-wal'));assert.ok(readdirSync(moved).includes('runtime.sqlite-shm'));
 store.close();store=undefined;store=new Store(path,undefined,null,undefined,{directoryFd:fd});assert.equal(store.getAgent('alice').desired,'stopped');
 closeSync(fd);fd=undefined;store.close();store=undefined;
 const checked=new DatabaseSync(join(moved,'runtime.sqlite'),{readOnly:true});try{assert.equal(checked.prepare('PRAGMA integrity_check').get().integrity_check,'ok');}finally{checked.close();}
 assert.deepEqual(readdirSync(directory),[]);assert.equal(process.cwd(),before);
});

for(const version of [4,99])test(`002. Rooted Store schema ${version} preserves compatibility checks and backup on the original directory`,t=>{
 if(process.platform!=='darwin'){t.diagnostic('NOT_RUN: actual Darwin rooted schema preflight');return;}
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-store-schema-root-'))),directory=join(root,'state'),moved=directory+'-moved';mkdirSync(directory,{mode:0o700});let fd,store;
 t.after(()=>{store?.close();if(fd!==undefined)closeSync(fd);rmSync(root,{recursive:true});});
 const path=join(directory,'runtime.sqlite'),initial=new Store(path);seed(initial);initial.close();
 const edit=new DatabaseSync(path);edit.exec('PRAGMA user_version='+version);edit.close();const before=readFileSync(path);fd=openSync(directory,'r');renameSync(directory,moved);mkdirSync(directory,{mode:0o700});
 if(version===99){assert.throws(()=>new Store(path,undefined,null,undefined,{directoryFd:fd}),error=>error.code==='STORE_CORRUPT');assert.deepEqual(readFileSync(join(moved,'runtime.sqlite')),before);assert.deepEqual(readdirSync(moved),['runtime.sqlite']);}
 else{
  store=new Store(path,undefined,null,undefined,{directoryFd:fd});assert.equal(store.getAgent('alice').desired,'enabled');store.close();store=undefined;
  const backups=readdirSync(moved).filter(name=>name.startsWith('runtime.sqlite.before-v5-')&&name.endsWith('.sqlite'));assert.equal(backups.length,1);
  const backup=new DatabaseSync(join(moved,backups[0]),{readOnly:true});try{assert.equal(backup.prepare('PRAGMA user_version').get().user_version,4);assert.equal(backup.prepare('PRAGMA integrity_check').get().integrity_check,'ok');}finally{backup.close();}
 }
 assert.deepEqual(readdirSync(directory),[]);
});

test('003. Rooted Store refuses an aliased database before compatibility reads or writes',t=>{
 if(process.platform!=='darwin'){t.diagnostic('NOT_RUN: actual Darwin rooted alias refusal');return;}
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-store-alias-root-'))),path=join(root,'runtime.sqlite');let fd;
 t.after(()=>{if(fd!==undefined)closeSync(fd);rmSync(root,{recursive:true});});
 const initial=new Store(path);initial.close();linkSync(path,join(root,'alias'));const before=readFileSync(path);fd=openSync(root,'r');
 assert.throws(()=>new Store(path,undefined,null,undefined,{directoryFd:fd}),error=>error.code==='STORE_CORRUPT');assert.deepEqual(readFileSync(path),before);assert.deepEqual(readdirSync(root).sort(),['alias','runtime.sqlite']);
});
