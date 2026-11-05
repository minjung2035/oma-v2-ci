/** Product adapter's public VFS and root lifetime, on actual Darwin. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {closeSync,mkdirSync,mkdtempSync,openSync,readdirSync,realpathSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDarwinSqliteRoot} from '@oma/storage';
import {seatbeltProfile} from '@oma/platform-mac/seatbelt';
import {decode,load} from 'koffi';

test('001. Darwin SQLite roots isolate simultaneous databases and keep temp SQL and WAL through rename',t=>{
 const top=realpathSync(mkdtempSync(join(tmpdir(),'oma-native-sqlite-root-'))),roots=[],databases=[];t.after(()=>{for(const db of databases)db.close();for(const r of roots)r.capability.close();rmSync(top,{recursive:true});});
 if(process.platform!=='darwin'){assert.throws(()=>createDarwinSqliteRoot(0),error=>error.code==='UNSUPPORTED_PROFILE');t.diagnostic('NOT_RUN: actual Darwin SQLite root lifetime');return;}
 for(const name of ['a','b','a']){
  const path=join(top,name);if(name!=='a'||roots.length===0)mkdirSync(path,{mode:0o700});const fd=openSync(path,'r');let capability;try{capability=createDarwinSqliteRoot(fd);}finally{closeSync(fd);}
  roots.push({path,capability,address:capability.address('runtime.sqlite')});
 }
 assert.equal(roots[0].address,roots[2].address,'same inode must retain one WAL namespace');
 for(const r of roots.slice(0,2)){const db=new DatabaseSync(r.address);databases.push(db);assert.equal(db.prepare('PRAGMA journal_mode=WAL').get().journal_mode,'wal');db.exec('CREATE TABLE probe(value);INSERT INTO probe VALUES(1)');}
 const shared=new DatabaseSync(roots[2].address);databases.push(shared);assert.equal(shared.prepare('SELECT value FROM probe').get().value,1);
 for(let i=0;i<2;i++){
  const r=roots[i];renameSync(r.path,r.path+'-moved');mkdirSync(r.path,{mode:0o700});databases[i].exec('INSERT INTO probe VALUES('+(i+2)+')');assert.deepEqual(readdirSync(r.path),[]);
  assert.deepEqual(databases[i].prepare('SELECT value FROM probe ORDER BY value').all().map(row=>row.value),[1,i+2]);
 }
 databases[0].close();databases[0]=shared;databases.pop();roots[0].capability.close();
 assert.throws(()=>roots[2].capability.close(),error=>error.code==='REF_STATE_UNKNOWN');shared.exec('INSERT INTO probe VALUES(4)');assert.deepEqual(shared.prepare('SELECT value FROM probe ORDER BY value').all().map(row=>row.value),[1,2,4]);
 if(process.platform==='darwin'){
  // This test owns its isolated Node worker. Apply the production renderer
  // here so any temp open outside the held test roots is actually denied.
  const library=load('/usr/lib/libsandbox.1.dylib'),enter=library.func('int sandbox_init(const char *profile, uint64_t flags, void *error)'),release=library.func('void sandbox_free_error(void *error)'),error=Buffer.alloc(8);
  const profile=seatbeltProfile({readable:[{path:realpathSync('.'),kind:'directory'}],writable:[{path:top,kind:'directory'}],denied:[],executable:[{path:process.execPath,kind:'file'}],unixSockets:[],machServices:[],environmentKeys:[]});
  const status=enter(profile,0n,error),message=decode(error,'void *');if(message)release(message);assert.equal(status,0,'apply actual write containment before SQLite temp creation');
  assert.throws(()=>writeFileSync(top+'-outside','must be denied'),failure=>failure.code==='EPERM'||failure.code==='EACCES');
 }
 // Exceeds SQLite's usual temp page cache, exercising a real temporary file
 // while all filesystem writes outside top are denied on actual Darwin.
 databases[0].exec('PRAGMA temp_store=FILE;CREATE TEMP TABLE bulk(value);WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<6000) INSERT INTO bulk SELECT randomblob(4096) FROM n');
 assert.equal(databases[0].prepare('SELECT count(*) AS n FROM bulk').get().n,6000);
 for(const db of databases)db.close();databases.length=0;
 for(const r of roots)r.capability.close();
 for(const r of roots){assert.throws(()=>new DatabaseSync(r.address));assert.deepEqual(readdirSync(r.path),[]);assert.deepEqual(readdirSync(r.path+'-moved'),['runtime.sqlite']);}
});
