/** Context revision writes and readiness share one retained world directory. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {closeSync,fchmodSync,fstatSync,mkdirSync,mkdtempSync,openSync,readFileSync,readdirSync,readlinkSync,realpathSync,renameSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {publishContextRevision,verifyContextRevision} from '@oma/storage/context-snapshot';
import {GitRepository} from '@oma/git/repository';
import {observeMacDeveloperTools} from '@oma/platform-mac/developer-tools';
import {PreparationExecutor,preparationShutdownBarrier} from '@oma/process/preparation';
import {removeOwnedTree} from '@oma/storage/directory';

for(const format of ['sha1','sha256'])for(const binding of ['bound','retained-on-demand'])test(`001. Context snapshot ${format} ${binding} survives source and world replacement and verifies the original revision`,{timeout:60000},async t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-context-snapshot-directory-'))),world=join(root,'world'),source=join(root,'source'),context=join(root,'context.git'),fds=[];
 t.after(async()=>{await preparationShutdownBarrier();for(const fd of fds)closeSync(fd);removeOwnedTree(root);});
 mkdirSync(world);mkdirSync(source);mkdirSync(join(source,'decisions'));
 const documents=[['GOAL.md','original goal\n'],['decisions/0001.md','original decision\n']];
 for(const [path,bytes] of documents)writeFileSync(join(source,path),bytes);
 const entries=documents.map(([path,bytes])=>({path,bytes:Buffer.byteLength(bytes),sha256:createHash('sha256').update(bytes).digest('hex')}));
 let executable='/usr/bin/git';if(process.platform==='darwin'){const owner=new PreparationExecutor();executable=(await observeMacDeveloperTools(root,command=>owner.run(command,t.signal))).git;}
 const env={PATH:'/usr/bin:/bin',HOME:root,TMPDIR:root,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'};
 const git=(args,input)=>{const r=spawnSync(executable,['--git-dir',context,...args],{env,input,encoding:'utf8',timeout:5000});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 git(['init','-q','--bare','--object-format='+format]);
 const goal=git(['hash-object','-w','--stdin'],documents[0][1]),decision=git(['hash-object','-w','--stdin'],documents[1][1]);
 const decisions=git(['mktree'],`100644 blob ${decision}\t0001.md\n`),tree=git(['mktree'],`100644 blob ${goal}\tGOAL.md\n040000 tree ${decisions}\tdecisions\n`),candidate=git(['commit-tree',tree,'-m','snapshot']);
 const contextFd=openSync(context,'r'),worldFd=openSync(world,'r'),sourceFd=openSync(source,'r');fds.push(contextFd,worldFd,sourceFd);let opens=0;
 const execution={executable,directories:new Map([[context,contextFd],...(binding==='bound'?[[world,worldFd]]:[])]),directory:path=>{if(path!==world)return undefined;opens++;return worldFd;}};
 const repository=new GitRepository({stateRoot:root,projectGit:join(root,'project.git'),contextGit:context,worldDir:world,society:'demo'},{submissions:()=>[]},null,execution);
 renameSync(world,world+'-moved');mkdirSync(world);writeFileSync(join(world,'sentinel'),'world replacement');
 renameSync(source,source+'-moved');mkdirSync(source);writeFileSync(join(source,'GOAL.md'),'source replacement');
 fchmodSync(worldFd,0);
 publishContextRevision(world,candidate,entries,sourceFd,{directoryFd:worldFd});
 assert.equal(fstatSync(worldFd).mode&0o700,0o700);
 const revision=join(world+'-moved','context','revisions',candidate);
 for(const [path,bytes] of documents)assert.equal(readFileSync(join(revision,path),'utf8'),bytes);
 assert.equal(readlinkSync(join(world+'-moved','context','current')),`revisions/${candidate}`);
 assert.equal(repository.snapshotReady({candidate,entries,base:null,goalMail:false}),true);
 publishContextRevision(world,candidate,entries,sourceFd,{directoryFd:worldFd});verifyContextRevision(revision,entries,true);
 assert.deepEqual(readdirSync(join(world+'-moved','context','revisions')),[candidate]);
 assert.deepEqual(readdirSync(world),['sentinel']);assert.equal(readFileSync(join(world,'sentinel'),'utf8'),'world replacement');assert.equal(readFileSync(join(source,'GOAL.md'),'utf8'),'source replacement');
 assert.equal(opens,binding==='bound'?0:1);
});
