/** Shared candidate business commands consume the setup process's held
 * canonical cwd. This is not a scope, role or whole-product qualification. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {closeSync,mkdirSync,mkdtempSync,openSync,realpathSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';

test('001. Actual shared candidate checkout reads its held canonical root after a different repository replaces its name',{timeout:15000},async t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-candidate-root-'))),source=join(root,'source'),project=join(root,'project.git'),replacement=join(root,'replacement.git'),workspace=join(root,'workspace');
 mkdirSync(source);mkdirSync(workspace);
 const env={PATH:'/usr/bin:/bin',HOME:root,TMPDIR:root,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',
  GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'};
 const git=(cwd,args)=>{const r=spawnSync('/usr/bin/git',args,{cwd,env,encoding:'utf8',timeout:5000});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 git(source,['init','-q']);writeFileSync(join(source,'canary'),'held canonical bytes');git(source,['add','.']);git(source,['commit','-qm','base']);
 const candidate=git(source,['rev-parse','HEAD']);git(root,['clone','-q','--bare',source,project]);git(root,['init','-q','--bare',replacement]);
 const fd=openSync(project,'r'),before=process.cwd();let child;
 t.after(()=>{if(child?.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');closeSync(fd);rmSync(root,{recursive:true});});
 const input={candidate,argv:[process.execPath,'-e',"require('node:assert/strict').equal(require('node:fs').readFileSync('canary','utf8'),'held canonical bytes');process.stdout.write('held-candidate');"],
  view:{project,workspace,git:'/usr/bin/git'}};
 const script=`import{readFileSync,closeSync}from'node:fs';import{enterDirectory}from ${JSON.stringify(import.meta.resolve('@oma/native/files'))};
import{executeCandidateCheck}from ${JSON.stringify(import.meta.resolve('@oma/git/candidate-check'))};
process.stdout.write('ready\\n');readFileSync(0);enterDirectory(3);closeSync(3);await executeCandidateCheck(JSON.parse(process.argv[1]),()=>{},undefined,'.');`;
 child=spawn(process.execPath,['--input-type=module','-e',script,JSON.stringify(input)],{env,stdio:['pipe','pipe','pipe',fd]});
 let stdout='',stderr='';const complete=once(child,'close');child.stdout.on('data',bytes=>{stdout+=bytes;if(stdout==='ready\n'){
  renameSync(project,project+'.moved');renameSync(replacement,project);child.stdin.end('release');}});child.stderr.on('data',bytes=>stderr+=bytes);
 const[code,signal]=await complete;assert.equal(signal,null,stderr);assert.equal(code,0,stderr);assert.equal(stdout,'ready\nheld-candidate');
 assert.equal(process.cwd(),before);assert.notEqual(spawnSync('/usr/bin/git',['--git-dir',project,'cat-file','-e',candidate],{env}).status,0);
});
