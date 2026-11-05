/** Public extension/VFS and descriptor namespace observations only.
 * No product Store backend, schema, loader policy or root proof is changed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {closeSync,mkdirSync,mkdtempSync,openSync,readFileSync,readdirSync,realpathSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

function observe(root,vfs){
 const directory=join(root,vfs?'shim':'default'),moved=directory+'-moved';mkdirSync(directory);writeFileSync(join(directory,'canary'),'original');
 const fd=openSync(directory,'r'),reference=`/dev/fd/${fd}`,before=process.cwd();let db,stage='descriptor-directory';const result={vfs:vfs?'oma-held-path-candidate':'default'};
 try{
  try{result.canary=readFileSync(reference+'/canary','utf8');}catch(error){result.canaryError={code:error.code,message:error.message};}
  stage='database-open';db=new DatabaseSync('file:'+reference+'/runtime.sqlite'+(vfs?'?vfs=oma-held-path-candidate':''));
  stage='initial-write';result.filename=db.prepare('PRAGMA database_list').all();result.journal=db.prepare('PRAGMA journal_mode=WAL').all();db.exec('CREATE TABLE probe(value);INSERT INTO probe VALUES(1)');
  stage='replacement';renameSync(directory,moved);mkdirSync(directory);
  stage='post-replacement-write';db.exec('INSERT INTO probe VALUES(2)');result.values=db.prepare('SELECT value FROM probe ORDER BY value').all();
  result.replacement=readdirSync(directory);result.original=readdirSync(moved);result.status=result.replacement.length===0?'ORIGINAL_ONLY_OBSERVED':'UNSAFE_SPLIT';
 }catch(error){result.status='REJECTED';result.stage=stage;result.error={code:error.code,errcode:error.errcode,message:error.message};}
 finally{db?.close();closeSync(fd);assert.equal(process.cwd(),before);}
 return result;
}

test('001. Actual Darwin SQLite public VFS observes directory-FD paths and WAL roots through replacement',t=>{
 if(process.platform!=='darwin'){t.diagnostic('NOT_RUN: Darwin SQLite directory namespace candidate');return;}
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-sqlite-root-candidate-'))),library=join(root,'fd-vfs.dylib');t.after(()=>rmSync(root,{recursive:true}));
 const run=(program,args)=>{const r=spawnSync(program,args,{encoding:'utf8',timeout:30000});assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr);return r;};
 run('/usr/bin/clang',['-dynamiclib','-fPIC','-Wall','-Wextra','-Werror',fileURLToPath(new URL('./fixtures/sqlite-fd-vfs-candidate.c',import.meta.url)),'-o',library]);
 run('/usr/bin/codesign',['--force','--sign','-',library]);
 // A fixed test-owned extension is loaded only into an in-memory connection.
 // Main databases retain Node's default disabled extension-loading setting.
 const loader=new DatabaseSync(':memory:',{allowExtension:true});try{loader.loadExtension(library);}finally{loader.close();}
 const observations=[observe(root,false),observe(root,true)];
 t.diagnostic(JSON.stringify({productionAdopted:false,node:process.version,observations}));
 assert.equal(observations.length,2);assert.ok(observations.every(row=>['REJECTED','UNSAFE_SPLIT','ORIGINAL_ONLY_OBSERVED'].includes(row.status)));
});

test('002. Actual Darwin SQLite public syscall hooks keep WAL and locks on a held directory after replacement',t=>{
 if(process.platform!=='darwin'){t.diagnostic('NOT_RUN: Darwin SQLite openat VFS candidate');return;}
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-sqlite-at-candidate-'))),directory=join(root,'database'),moved=directory+'-moved',library=join(root,'at-vfs.dylib'),before=process.cwd();
 mkdirSync(directory);t.after(()=>rmSync(root,{recursive:true}));
 const run=(program,args)=>{const r=spawnSync(program,args,{encoding:'utf8',timeout:30000});assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr);};
 run('/usr/bin/clang',['-dynamiclib','-fPIC','-Wall','-Wextra','-Werror',fileURLToPath(new URL('./fixtures/sqlite-at-vfs-candidate.c',import.meta.url)),'-o',library]);
 run('/usr/bin/codesign',['--force','--sign','-',library]);
 const loader=new DatabaseSync(':memory:',{allowExtension:true});let fd=openSync(directory,'r'),loaded=false,writer,reader,contender,ordinary;
 try{
  loader.loadExtension(library);loaded=true;const prefix=loader.prepare('SELECT oma_candidate_bind(?) AS root').get(fd).root;closeSync(fd);fd=undefined;
  const address='file:'+prefix+'/runtime.sqlite?vfs=oma-at-candidate';
  writer=new DatabaseSync(address);writer.exec('CREATE TABLE probe(value);INSERT INTO probe VALUES(1)');
  // The first WAL and SHM opens occur after the diagnostic name is replaced.
  renameSync(directory,moved);mkdirSync(directory);
  const journal=writer.prepare('PRAGMA journal_mode=WAL').get().journal_mode;assert.equal(journal,'wal');
  reader=new DatabaseSync(address);reader.exec('BEGIN');assert.deepEqual(reader.prepare('SELECT value FROM probe').all().map(row=>row.value),[1]);
  writer.exec('BEGIN IMMEDIATE;INSERT INTO probe VALUES(2)');
  contender=new DatabaseSync(address);assert.throws(()=>contender.exec('BEGIN IMMEDIATE'),error=>error.errcode===5);contender.close();contender=undefined;
  writer.exec('COMMIT');assert.deepEqual(reader.prepare('SELECT value FROM probe').all().map(row=>row.value),[1]);reader.exec('COMMIT');
  assert.deepEqual(reader.prepare('SELECT value FROM probe ORDER BY value').all().map(row=>row.value),[1,2]);reader.close();reader=undefined;
  assert.ok(readdirSync(moved).includes('runtime.sqlite-wal'));assert.ok(readdirSync(moved).includes('runtime.sqlite-shm'));assert.deepEqual(readdirSync(directory),[]);
  assert.equal(writer.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get().busy,0);writer.close();writer=undefined;
  writer=new DatabaseSync(address);assert.equal(writer.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(writer.prepare('SELECT value FROM probe ORDER BY value').all().map(row=>row.value),[1,2]);writer.close();writer=undefined;
  ordinary=new DatabaseSync(join(root,'ordinary.sqlite'));ordinary.exec('CREATE TABLE unrelated(value);INSERT INTO unrelated VALUES(3)');assert.equal(ordinary.prepare('SELECT value FROM unrelated').get().value,3);ordinary.close();ordinary=undefined;
  loader.prepare('SELECT oma_candidate_unbind()').get();
  assert.throws(()=>new DatabaseSync(address));assert.deepEqual(readdirSync(directory),[]);assert.equal(process.cwd(),before);
  t.diagnostic(JSON.stringify({productionAdopted:false,candidate:'public Unix VFS syscall hooks',journal,postReplacementWal:true,snapshotIsolation:true,writerContention:true,checkpoint:true,reopenIntegrity:true,unrelatedDefaultVfs:true,returnedRootRefused:true}));
 }finally{ordinary?.close();contender?.close();reader?.close();writer?.close();if(fd!==undefined)closeSync(fd);try{if(loaded)loader.prepare('SELECT oma_candidate_unbind()').get();}finally{loader.close();}assert.equal(process.cwd(),before);}
});
