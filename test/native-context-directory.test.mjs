/** Canonical context facts/CAS retain their original repository capability. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {closeSync,mkdirSync,mkdtempSync,openSync,readFileSync,realpathSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {GitRepository} from '@oma/git/repository';
import {contextStagingPathAt} from '@oma/domain/paths';
import {observeMacDeveloperTools} from '@oma/platform-mac/developer-tools';
import {PreparationExecutor,preparationShutdownBarrier} from '@oma/process/preparation';
import {TreeLease} from '@oma/storage/tree-lease';
import {inspect} from 'node:util';

for(const format of ['sha1','sha256'])for(const mode of ['bound','retained-on-demand'])test(`001. Context ${format} ${mode} observations, accepted bytes and CAS preserve the original directory`,{timeout:60000},async t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-context-directory-'))),context=join(root,'context.git'),moved=context+'-moved';let fd,opens=0;
 t.after(()=>{if(fd!==undefined)closeSync(fd);rmSync(root,{recursive:true});});
 let executable='/usr/bin/git';if(process.platform==='darwin'){const owner=new PreparationExecutor();executable=(await observeMacDeveloperTools(root,command=>owner.run(command,t.signal))).git;}
 const env={PATH:'/usr/bin:/bin',HOME:root,TMPDIR:root,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'};
 const git=(repository,args,input)=>{const result=spawnSync(executable,['--git-dir',repository,...args],{env,input,encoding:'utf8',timeout:5000});assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);return result.stdout.trim();};
 git(context,['init','-q','--bare','--object-format='+format]);
 const tree=(goal,rationale)=>{const blob=bytes=>git(context,['hash-object','-w','--stdin'],bytes);return git(context,['mktree'],`100644 blob ${blob(goal)}\tGOAL.md\n100644 blob ${blob(rationale)}\tRATIONALE.md\n`);};
 const goal='original context goal\n',rationale='preserved rationale\n',base=git(context,['commit-tree',tree('old goal\n',rationale),'-m','base']),candidate=git(context,['commit-tree',tree(goal,rationale),'-p',base,'-m','candidate']),changed=git(context,['commit-tree',tree(goal,'changed rationale\n'),'-p',base,'-m','bad goal-only']);
 git(context,['update-ref','refs/heads/main',base]);const cwd=process.cwd();
 const retain=repository=>{if(repository!==context)return undefined;if(fd===undefined){fd=openSync(context,'r');opens++;}return fd;};
 const execution=mode==='bound'?{executable,directories:new Map([[context,retain(context)]])}:{executable,directories:new Map(),directory:retain};
 const repository=new GitRepository({stateRoot:root,projectGit:join(root,'project.git'),contextGit:context,worldDir:join(root,'world'),society:'demo'},{submissions:()=>[]},null,execution);
 assert.equal(repository.context.current(),base);assert.equal(repository.context.observedObjectFormat(),format);
 renameSync(context,moved);git(context,['init','-q','--bare','--object-format='+format]);
 assert.equal(repository.context.current(),base);assert.equal(repository.context.observedObjectFormat(),format);repository.context.assertGoalOnly(candidate,base);assert.throws(()=>repository.context.assertGoalOnly(changed,base),error=>error.code==='INVALID_REQUEST');
 const id='op-'+randomUUID(),entries=[['GOAL.md',goal],['RATIONALE.md',rationale]].map(([path,bytes])=>({path,bytes:Buffer.byteLength(bytes),sha256:createHash('sha256').update(bytes).digest('hex')}));
 const operation={id,kind:'context.publish',plan:{base,candidate,entries,goalMail:true,stagingPath:contextStagingPathAt(root,id)}};
 repository.context.ensureCandidate(operation);assert.throws(()=>repository.context.ensureCandidate({...operation,plan:{...operation.plan,entries:[{...entries[0],sha256:'0'.repeat(64)},entries[1]]}}),error=>error.code==='STORE_CORRUPT');
 assert.deepEqual(repository.context.compareAndSwap(base,candidate),{kind:'candidate',oid:candidate});assert.equal(repository.context.current(),candidate);assert.equal(git(moved,['rev-parse','refs/heads/main']),candidate);assert.equal(git(context,['for-each-ref']),'');assert.equal(opens,1);assert.equal(process.cwd(),cwd);
});

for(const replacement of ['after-preparation','before-preparation'])test(`002. Context preparation keeps its canonical persistence barrier with replacement ${replacement}`,{timeout:90000},async t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-new-context-directory-'))),context=join(root,'context.git'),staging=join(root,'stage'),tree=join(staging,'input');let fd,opens=0;
 t.after(async()=>{await preparationShutdownBarrier();if(fd!==undefined)closeSync(fd);rmSync(root,{recursive:true});});
 try{
  let executable='/usr/bin/git';if(process.platform==='darwin'){const owner=new PreparationExecutor();executable=(await observeMacDeveloperTools(root,command=>owner.run(command,t.signal))).git;}
  const retain=repository=>{if(repository!==context)return undefined;if(fd!==undefined)return fd;try{fd=openSync(context,'r');opens++;return fd;}catch(error){if(error.code==='ENOENT')return undefined;throw error;}};
  const repository=new GitRepository({stateRoot:root,projectGit:join(root,'project.git'),contextGit:context,worldDir:join(root,'world'),society:'demo'},{submissions:()=>[]},null,{executable,directories:new Map(),directory:retain});
  assert.equal(repository.context.current(),null);assert.equal(opens,0);mkdirSync(staging,{mode:0o700});mkdirSync(tree,{mode:0o700});TreeLease.take(staging).release();
  const bytes=Buffer.from('new held context\n'),entries=[{path:'GOAL.md',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}];writeFileSync(join(tree,'GOAL.md'),bytes);
  if(replacement==='before-preparation'){
   const initialized=spawnSync(executable,['--git-dir',context,'init','-q','--bare'],{env:{PATH:'/usr/bin:/bin',HOME:root,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'},encoding:'utf8',timeout:5000});assert.equal(initialized.status,0,initialized.stderr);
   assert.equal(repository.context.current(),null);assert.equal(opens,1);
   renameSync(context,context+'-moved');writeFileSync(context,'replacement is not a repository\n');
  }
  const candidate=await repository.context.prepareCandidate(tree,entries,null);assert.equal(opens,1);assert.deepEqual(repository.context.compareAndSwap(null,candidate),{kind:'candidate',oid:candidate});
  if(replacement==='after-preparation'){renameSync(context,context+'-moved');mkdirSync(context,{mode:0o700});}
  else assert.equal(readFileSync(context,'utf8'),'replacement is not a repository\n');
  assert.equal(repository.context.current(),candidate);repository.context.assertGoalOnly(candidate,null);assert.equal(repository.context.observedObjectFormat(),'sha1');assert.equal(opens,1);
 }catch(error){t.diagnostic(inspect(error,{depth:null,maxArrayLength:null}));throw error;}
});
