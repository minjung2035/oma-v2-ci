/** Actual review diff preparation, accepted reads and unaccepted cleanup. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {closeSync,mkdirSync,mkdtempSync,openSync,readFileSync,readdirSync,realpathSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,basename} from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {GitRepository} from '@oma/git/repository';
import {observeMacDeveloperTools} from '@oma/platform-mac/developer-tools';
import {PreparationExecutor} from '@oma/process/preparation';
import {inspect} from 'node:util';

for(const disposition of['accepted','discarded','registration-refused','renamed-during-prepare'])test(`001. Review directory replacement preserves original-only ${disposition} artifacts`,{timeout:60000},async t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-review-directory-'))),project=join(root,'project.git'),moved=join(root,'moved.git');let fd,owner;
 t.after(()=>{if(owner)owner.discardUnaccepted();if(fd!==undefined)closeSync(fd);rmSync(root,{recursive:true});});
 try{
  let executable='/usr/bin/git';
  if(process.platform==='darwin'){const executor=new PreparationExecutor();executable=(await observeMacDeveloperTools(root,command=>executor.run(command,t.signal))).git;}
  const env={PATH:'/usr/bin:/bin',HOME:root,TMPDIR:root,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'};
  const git=(repository,args,input)=>{const r=spawnSync(executable,['--git-dir',repository,...args],{env,input,encoding:'utf8',timeout:5000});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
  git(project,['init','-q','--bare']);
  const tree=text=>{const blob=git(project,['hash-object','-w','--stdin'],text);return git(project,['mktree'],`100644 blob ${blob}\tfile\n`);};
  const base=git(project,['commit-tree',tree('old\n'),'-m','base']),candidate=git(project,['commit-tree',tree('original-only review bytes\n'),'-p',base,'-m','candidate']);
  git(project,['update-ref','refs/heads/main',base]);const refs=git(project,['show-ref']),cwd=process.cwd();fd=openSync(project,'r');
  const paths={stateRoot:root,projectGit:project,contextGit:join(root,'context.git'),worldDir:join(root,'world'),society:'demo'},repository=new GitRepository(paths,{submissions:()=>[]},null,{executable,directories:new Map([[project,fd]])});
  const replace=()=>{renameSync(project,moved);mkdirSync(project);};if(disposition!=='renamed-during-prepare')replace();
  const refused=new Error('fixture refused preaccept registration');
  const pending=repository.review.prepareDiff('op-'+randomUUID(),base,candidate,value=>{if(disposition==='registration-refused')throw refused;owner=value;if(disposition==='renamed-during-prepare')replace();});
  if(disposition==='registration-refused'){await assert.rejects(pending,error=>error===refused);assert.deepEqual(readdirSync(join(moved,'oma-results')),[]);assert.deepEqual(readdirSync(project),[]);}
  else{
   const prepared=await pending;assert.ok(owner);assert.ok(prepared.diff.bytes>0);assert.match(prepared.preview.toString(),/original-only review bytes/);assert.deepEqual(readdirSync(project),[]);
   mkdirSync(join(project,'oma-results'));const replacement=join(project,'oma-results',basename(owner.path));writeFileSync(replacement,'replacement must remain');
   if(disposition==='accepted'||disposition==='renamed-during-prepare'){
    owner.retainForOperation();repository.integration.verifyDiff(prepared.diff);
    assert.match(repository.readDiffPatch(prepared.diff).toString(),/original-only review bytes/);
    assert.deepEqual(repository.readDiffRecord(prepared.diff).paths,[{status:'M',path:'file'}]);
    repository.withReviewSourceRecord(base,candidate,source=>{
     assert.match(readFileSync(source.patch.path,'utf8'),/original-only review bytes/);assert.equal(source.paths.length,1);assert.equal(source.paths[0].path,'file');
     source.withBlob(source.paths[0].after.oid,file=>{assert.equal(readFileSync(file.path,'utf8'),'original-only review bytes\n');});
    });
    const unbound=new GitRepository(paths,{submissions:()=>[]});assert.throws(()=>unbound.readDiffPatch(prepared.diff),error=>error.code==='STORE_CORRUPT');
   }else{owner.discardUnaccepted();assert.deepEqual(readdirSync(join(moved,'oma-results')),[]);}
   assert.equal(readFileSync(replacement,'utf8'),'replacement must remain');
  }
  assert.equal(git(moved,['show-ref']),refs);assert.equal(process.cwd(),cwd);
 }catch(error){console.error(inspect(error,{depth:null,maxArrayLength:128,maxStringLength:8192}));throw error;}
});
