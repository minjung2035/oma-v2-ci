/** Actual shared integration preparation, owner settlement and recovery roots. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {closeSync,mkdirSync,mkdtempSync,openSync,readFileSync,readdirSync,realpathSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {inspect} from 'node:util';
import {GitRepository} from '@oma/git/repository';
import {collectPreparedIntegrations} from '@oma/git/integration-preparation';
import {TreeLease,treeQuiescence} from '@oma/storage/tree-lease';
import {observeMacDeveloperTools} from '@oma/platform-mac/developer-tools';
import {PreparationExecutor} from '@oma/process/preparation';

for(const disposition of ['accepted','discarded','registration-refused','renamed-during-prepare','active-owner','collector'])test(`001. Integration directory replacement preserves original-only ${disposition} effects`,{timeout:90000},async t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-integration-directory-'))),project=join(root,'project.git'),moved=join(root,'moved.git'),operation='op-'+randomUUID(),ref='refs/oma/prepared/'+operation;
 let fd,owner,helper;
 t.after(()=>{helper?.release();owner?.discardUnaccepted();if(fd!==undefined)closeSync(fd);rmSync(root,{recursive:true});});
 try{
  let executable='/usr/bin/git';
  if(process.platform==='darwin'){const executor=new PreparationExecutor();executable=(await observeMacDeveloperTools(root,command=>executor.run(command,t.signal))).git;}
  const env={PATH:'/usr/bin:/bin',HOME:root,TMPDIR:root,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'};
  const git=(repository,args,input)=>{const r=spawnSync(executable,['--git-dir',repository,...args],{env,input,encoding:'utf8',timeout:5000});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
  git(project,['init','-q','--bare']);
  const tree=(a,b)=>{const blob=value=>git(project,['hash-object','-w','--stdin'],value);return git(project,['mktree'],`100644 blob ${blob(a)}\ta\n100644 blob ${blob(b)}\tb\n`);};
  const base=git(project,['commit-tree',tree('old-a','old-b'),'-m','base']),candidate=git(project,['commit-tree',tree('new-a','old-b'),'-p',base,'-m','candidate']),main=git(project,['commit-tree',tree('old-a','new-b'),'-p',base,'-m','main']);
  git(project,['update-ref','refs/heads/main',main]);const cwd=process.cwd();fd=openSync(project,'r');
  const execution={executable,directories:new Map([[project,fd]])},repository=new GitRepository({stateRoot:root,projectGit:project,contextGit:join(root,'context.git'),worldDir:join(root,'world'),society:'demo'},{submissions:()=>[]},null,execution);
  let replacement;
  const replace=()=>{
   renameSync(project,moved);git(project,['init','-q','--bare']);
   const empty=git(project,['mktree'],''),commit=git(project,['commit-tree',empty,'-m','replacement']);git(project,['update-ref',ref,commit]);replacement=git(project,['show-ref']);
   mkdirSync(join(project,'oma-preparations'));writeFileSync(join(project,'oma-preparations',operation+'.lease'),'replacement lease');
  };
  if(disposition!=='renamed-during-prepare')replace();
  const refused=new Error('fixture refused prepared ref registration');
  const pending=repository.review.prepareIntegration(operation,base,candidate,main,value=>{
   if(disposition==='registration-refused')throw refused;owner=value;if(disposition==='renamed-during-prepare')replace();
  });
  if(disposition==='registration-refused'){
   await assert.rejects(pending,error=>error===refused);assert.equal(git(moved,['for-each-ref','--format=%(refname)','refs/oma/prepared']), '');
  }else{
   const prepared=await pending;assert.ok(owner);assert.equal(prepared.preparedRef,ref);assert.equal(prepared.reusable,true);assert.equal(git(moved,['rev-parse',ref]),prepared.candidate);
   assert.equal(git(moved,['show',prepared.candidate+':a']),'new-a');assert.equal(git(moved,['show',prepared.candidate+':b']),'new-b');
   assert.equal(git(moved,['show','-s','--format=%P',prepared.candidate]),main+' '+candidate);
   const leasePath=join(moved,'oma-preparations',operation);
   if(disposition==='collector'){
    owner.retainForOperation();helper=TreeLease.take(leasePath);
    collectPreparedIntegrations(project,()=>null,execution);assert.equal(git(moved,['rev-parse',ref]),prepared.candidate);assert.equal(treeQuiescence(leasePath).kind,'active');
    helper.release();helper=undefined;collectPreparedIntegrations(project,()=>null,execution);
    assert.equal(git(moved,['for-each-ref','--format=%(refname)','refs/oma/prepared']), '');assert.deepEqual(readdirSync(join(moved,'oma-preparations')),[]);
   }else{
    if(disposition==='active-owner'){
     helper=TreeLease.take(leasePath);assert.throws(()=>owner.discardUnaccepted(),error=>error.code==='REF_STATE_UNKNOWN');assert.equal(git(moved,['rev-parse',ref]),prepared.candidate);helper.release();helper=undefined;
    }
    // Settlement owns independent cursors and outlives the caller's root FD.
    closeSync(fd);fd=undefined;
    if(disposition==='accepted'||disposition==='renamed-during-prepare'){owner.retainForOperation();assert.equal(git(moved,['rev-parse',ref]),prepared.candidate);}
    else{owner.discardUnaccepted();assert.equal(git(moved,['for-each-ref','--format=%(refname)','refs/oma/prepared']), '');}
   }
  }
  assert.equal(git(moved,['rev-parse','refs/heads/main']),main);assert.equal(git(project,['show-ref']),replacement);
  assert.equal(readFileSync(join(project,'oma-preparations',operation+'.lease'),'utf8'),'replacement lease');assert.equal(process.cwd(),cwd);
 }catch(error){console.error(inspect(error,{depth:null,maxArrayLength:128,maxStringLength:8192}));throw error;}
});
