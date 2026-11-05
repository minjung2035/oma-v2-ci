/** Actual shared Host observations and CAS effects, after replacing the
 * canonical pathname. This does not qualify unrelated filesystem writers. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {closeSync,mkdtempSync,openSync,realpathSync,renameSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {GitRepository} from '@oma/git/repository';
import {authorizeCanonicalNoop,canonicalCommitGraph,canonicalCommitRange,canonicalPublishedRefs,canonicalRevertCommit,createCanonicalObserver,createCanonicalRef} from '@oma/git/canonical-command';

for(const format of['sha1','sha256'])test(`001. Host canonical ${format} observations, CAS and revert retain the original directory`,t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-canonical-directory-'))),project=join(root,'project.git'),moved=join(root,'moved.git'),replacement=join(root,'replacement.git');
 let fd;t.after(()=>{if(fd!==undefined)closeSync(fd);rmSync(root,{recursive:true});});
 const env={PATH:'/usr/bin:/bin',HOME:root,TMPDIR:root,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',
  GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'};
 const git=(repository,args,input)=>{const r=spawnSync('/usr/bin/git',['--git-dir',repository,...args],{env,input,encoding:'utf8',timeout:5000});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 for(const p of[project,replacement])git(p,['init','-q','--bare','--object-format='+format]);
 t.diagnostic('actual Git: '+git(project,['--version']));
 const baseTree=git(project,['mktree'],''),base=git(project,['commit-tree',baseTree,'-m','base']);
 const blob=git(project,['hash-object','-w','--stdin'],'candidate bytes'),tree=git(project,['mktree'],`100644 blob ${blob}\tfile\n`),candidate=git(project,['commit-tree',tree,'-p',base,'-m','candidate']);
 git(project,['update-ref','refs/heads/main',base]);
 fd=openSync(project,'r');const cwd=process.cwd(),execution={executable:'/usr/bin/git',directories:new Map([[project,fd]])};
 const repository=new GitRepository({stateRoot:root,projectGit:project,contextGit:join(root,'context.git'),worldDir:join(root,'world'),society:'demo'}, {submissions:()=>[]},null,execution);
 renameSync(project,moved);renameSync(replacement,project);
 assert.equal(repository.integration.main().value,base);
 assert.equal(repository.integration.ancestry(base,candidate).value,true);
 assert.deepEqual(repository.integration.changedPaths(base,candidate).value,[{status:'A',path:'file'}]);
 assert.deepEqual(repository.integration.gitlinks(candidate).value,[]);
 assert.deepEqual(repository.integration.compareAndSwap(base,candidate),{kind:'candidate',oid:candidate});
 assert.equal(repository.integration.main().value,candidate);
 assert.deepEqual(repository.integration.compareAndSwap('f'.repeat(candidate.length),base),{kind:'third',oid:candidate});
 const observer=createCanonicalObserver(execution.executable,execution),ref='refs/oma/published/held';
 assert.deepEqual(createCanonicalRef(observer,project,ref,candidate,execution),{after:{kind:'candidate',oid:candidate},created:true});
 assert.deepEqual(createCanonicalRef(observer,project,ref,candidate,execution),{after:{kind:'candidate',oid:candidate},created:false});
 assert.equal(authorizeCanonicalNoop(observer,project,'refs/oma/noop/held',candidate,execution).value,candidate);
 assert.deepEqual([...canonicalPublishedRefs(project,execution)],[[ref,candidate]]);
 assert.deepEqual(canonicalCommitRange(project,base,candidate,execution),[candidate]);
 assert.deepEqual(canonicalCommitGraph(project,[candidate],execution).get(candidate),[base]);
 const reverted=canonicalRevertCommit(project,{mergeBase:candidate,main:candidate,base,message:'revert',society:'demo'},execution);
 assert.equal(git(moved,['rev-parse',reverted+'^{tree}']),baseTree);
 assert.equal(git(moved,['rev-parse','refs/heads/main']),candidate);
 assert.equal(git(project,['for-each-ref']), '');
 assert.equal(createCanonicalObserver().ref(project,'refs/heads/main').kind,'absent');
 assert.equal(process.cwd(),cwd);
});

for(const format of['sha1','sha256'])for(const scenario of['independent','conflict','already-reverted'])test(`002. Canonical ${format} revert preserves its recorded base with ${scenario} main`,t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-revert-base-'))),repository=join(root,'project.git');t.after(()=>rmSync(root,{recursive:true}));
 const env={PATH:'/usr/bin:/bin',HOME:root,TMPDIR:root,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'};
 const git=(args,input)=>{const r=spawnSync('/usr/bin/git',['--git-dir',repository,...args],{env,input,encoding:'utf8',timeout:5000});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 git(['init','-q','--bare','--object-format='+format]);
 const tree=entries=>git(['mktree'],Object.entries(entries).map(([name,content])=>`100644 blob ${git(['hash-object','-w','--stdin'],content)}\t${name}\n`).join(''));
 const commit=(value,parent,label)=>git(['commit-tree',value,...(parent?['-p',parent]:[]),'-m',label]);
 const base=commit(tree({file:'old\n'}),undefined,'base'),applied=commit(tree({file:'applied\n'}),base,'applied');
 const entries={file:scenario==='conflict'?'later conflict\n':scenario==='already-reverted'?'old\n':'applied\n',other:'independent later work\n'},main=commit(tree(entries),applied,'later main');
 git(['update-ref','refs/heads/main',main]);const before=git(['show-ref']),input={mergeBase:applied,main,base,message:'revert applied',society:'demo'};
 if(scenario==='conflict')assert.throws(()=>canonicalRevertCommit(repository,input),error=>error.code==='REVERT_CONFLICT'&&error.details.paths.includes('file'));
 else if(scenario==='already-reverted')assert.throws(()=>canonicalRevertCommit(repository,input),error=>error.code==='INVALID_REQUEST');
 else{const result=canonicalRevertCommit(repository,input);assert.equal(git(['rev-parse',result+'^{tree}']),tree({file:'old\n',other:entries.other}));assert.equal(git(['rev-list','--parents','-n','1',result]),result+' '+main);}
 assert.equal(git(['show-ref']),before);
});
