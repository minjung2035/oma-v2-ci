/** Shared verify/import commands use a held canonical cwd; no role or scope
 * admission is inferred from these dedicated child processes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,closeSync,mkdirSync,mkdtempSync,openSync,readFileSync,realpathSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {exportRefForRequestKey} from '@oma/domain/derived';

for(const corrupt of[false,true])test(`001. Shared quarantine retains its canonical root through replacement${corrupt?' and refuses unrelated canonical corruption':''}`,{timeout:20000},async t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-quarantine-root-'))),source=join(root,'source'),project=join(root,'project.git'),moved=project+'.moved',replacement=join(root,'replacement.git'),quarantine=join(root,'quarantine');
 let fd,child,complete;
 t.after(async()=>{if(child?.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');if(complete)await complete.catch(()=>{});if(fd!==undefined)closeSync(fd);rmSync(root,{recursive:true});});
 for(const p of[source,quarantine])mkdirSync(p);for(const phase of['verify','import'])mkdirSync(join(quarantine,phase+'-tmp'));
 const env={PATH:'/usr/bin:/bin',HOME:root,TMPDIR:root,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',
  GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'};
 const git=(cwd,args)=>{const r=spawnSync('/usr/bin/git',args,{cwd,env,encoding:'utf8',timeout:5000});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 git(source,['init','-q']);writeFileSync(join(source,'base'),'original base');git(source,['add','.']);git(source,['commit','-qm','base']);
 const base=git(source,['rev-parse','HEAD']);git(root,['clone','-q','--bare',source,project]);git(root,['init','-q','--bare',replacement]);
 if(corrupt){const file=join(root,'unrelated');writeFileSync(file,'unrelated canonical object');const oid=git(root,['--git-dir',project,'hash-object','-w',file]),object=join(project,'objects',oid.slice(0,2),oid.slice(2));chmodSync(object,0o600);writeFileSync(object,'corrupt');}
 const before=git(root,['--git-dir',project,'show-ref']);writeFileSync(join(source,'candidate'),'accepted bytes');git(source,['add','.']);git(source,['commit','-qm','candidate']);
 const candidate=git(source,['rev-parse','HEAD']),exportRef=exportRefForRequestKey('held-root'),bundle=join(quarantine,'input.bundle');git(source,['update-ref',exportRef,candidate]);git(source,['bundle','create',bundle,exportRef,'^'+base]);
 const accepted=readFileSync(bundle),hostCwd=process.cwd();fd=openSync(project,'r');
 const script=`import{readFileSync,closeSync}from'node:fs';import{enterDirectory}from ${JSON.stringify(import.meta.resolve('@oma/native/files'))};
import{executeQuarantinePhase}from ${JSON.stringify(import.meta.resolve('@oma/git/quarantine-worker'))};
process.stdout.write('ready\\n');readFileSync(0);enterDirectory(3);closeSync(3);
try{await executeQuarantinePhase(JSON.parse(process.argv[1]),'.');}catch(error){console.log(JSON.stringify({code:error.code}));process.exitCode=1;}`;
 const has=(repo)=>spawnSync('/usr/bin/git',['--git-dir',repo,'cat-file','-e',candidate+'^{commit}'],{env,timeout:5000}).status===0;
 for(const phase of['verify','import']){
  const input={phase,candidate,exportRef,prerequisites:[base],view:{git:'/usr/bin/git',project,root:quarantine,bundle,temporary:join(quarantine,phase+'-tmp')}};
  child=spawn(process.execPath,['--input-type=module','-e',script,JSON.stringify(input)],{env,stdio:['pipe','pipe','pipe',fd]});
  let stdout='',stderr='';complete=once(child,'close');child.stdout.on('data',bytes=>{stdout+=bytes;if(stdout==='ready\n'){
   if(phase==='verify'){renameSync(project,moved);renameSync(replacement,project);}child.stdin.end('release');}});child.stderr.on('data',bytes=>stderr+=bytes);
  const[code,signal]=await complete;assert.equal(signal,null,stderr);
  if(corrupt){assert.equal(phase,'verify');assert.equal(code,1,stderr);assert.deepEqual(JSON.parse(stdout.slice(6)),{code:'REF_STATE_UNKNOWN'});assert.equal(has(moved),false);break;}
  assert.equal(code,0,stderr);assert.equal(stdout,'ready\n'+candidate+'\n');assert.equal(has(moved),phase==='import');assert.equal(has(project),false);
 }
 assert.equal(git(root,['--git-dir',moved,'show-ref']),before);assert.deepEqual(readFileSync(bundle),accepted);assert.equal(process.cwd(),hostCwd);
});
