import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {ExecutionJournal} from '@oma/storage/execution-journal';
import {residentRootfsPath,prepareResidentRootfs,hostSystemLayout} from '@oma/platform-linux/resident-rootfs';
import {snapshotIntegrationPolicy} from '@oma/domain/integration-policy';
import {ExecutionRuntime} from '#oma-test/app/runtime/execution-runtime';
import {CandidateChecks} from '#oma-test/app/runtime/candidate-checks';
import {readResult} from '@oma/tool-files';
const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_AUTHOR_NAME:'Test',GIT_AUTHOR_EMAIL:'test@example.invalid',GIT_COMMITTER_NAME:'Test',GIT_COMMITTER_EMAIL:'test@example.invalid'};
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'oma-pipeline-')),source=join(root,'source');mkdirSync(source);
 const git=(...args)=>execFileSync('/usr/bin/git',args,{cwd:source,env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q');writeFileSync(join(source,'source.txt'),'original\n');git('add','.');git('commit','-qm','initial');const candidate=git('rev-parse','HEAD'),projectGit=join(root,'project.git');git('clone','-q','--bare',source,projectGit);
 const paths={stateRoot:root,projectGit,contextGit:join(root,'context.git'),worldDir:join(root,'world'),society:'test',checkNode:process.execPath,checkAssetsDir:resolve('.')};
 prepareResidentRootfs(residentRootfsPath(root),hostSystemLayout(),process.getuid(),process.getgid());ExecutionJournal.initialize(root);const executions=new ExecutionRuntime(root);
 const checks=new CandidateChecks(paths,(cmd,sig,auth,fds,prepared)=>executions.run('candidate',cmd,sig,auth,fds,undefined,prepared),undefined,undefined,()=>executions.confirmDead('candidate'));
 t.after(async()=>{await executions.close();rmSync(root,{recursive:true});});
 return {root,candidate,checks,executions,receipts:()=>readdirSync(join(root,'checks')).map(id=>({directory:join(root,'checks',id),...JSON.parse(readFileSync(join(root,'checks',id,'receipt.json'),'utf8'))}))};
}
const step=(id,script,deadlineMs)=>({id,argv:['/opt/oma-node/node','-e',script],cwd:'.',env:{},...(deadlineMs===undefined?{}:{deadlineMs})});
const check=(setupSteps,checkSteps)=>snapshotIntegrationPolicy({maxWorkers:2,policyRevision:'pipeline',protectedPaths:[],checks:[{id:'pipeline:v2',argv:['oma-pipeline-v2'],env:{},pipeline:{version:2,setupSteps,checkSteps,env:{},toolchainDigest:'a'.repeat(64),cachePolicy:{kind:'off'}}}]}).checks[0];
test('P2 native shared pipeline: fresh retry, setup dependency, separate logs, tracked generation and private receipts',{timeout:30000},async t=>{
 const f=fixture(t);const policy=check([step('setup',`const fs=require('node:fs'),a=require('node:assert/strict');a.equal(fs.existsSync('node_modules'),false);fs.mkdirSync('node_modules');fs.writeFileSync('node_modules/dependency','installed');fs.writeFileSync(process.env.HOME+'/owned','home');fs.writeFileSync('source.txt','generated\\n');process.stdout.write('setup log');`)],[step('check',`const fs=require('node:fs'),a=require('node:assert/strict');a.equal(fs.readFileSync('node_modules/dependency','utf8'),'installed');a.equal(fs.readFileSync(process.env.HOME+'/owned','utf8'),'home');a.throws(()=>fs.openSync('/proc/'+process.ppid+'/fd/6','w'));process.stdout.write(JSON.stringify({kind:'pipeline-end',passed:false})+'\\n');process.stderr.write('check log');`)]);
 let auth=0;await f.checks.run(f.candidate,policy,undefined,()=>auth++,'attempt-one');await f.checks.run(f.candidate,policy,undefined,()=>auth++,'attempt-two');assert.equal(auth,4);
 const receipts=f.receipts();assert.equal(receipts.length,2);assert.deepEqual(new Set(receipts.map(r=>r.attempt)),new Set(['attempt-one','attempt-two']));
 for(const r of receipts){assert.equal(r.status,'succeeded');assert.equal(r.scopeConfirmedDead,true);assert.equal(r.steps.length,4);assert.ok(r.tracked.bytes>0);assert.match(readResult(r.directory,r.tracked.reference).text,/generated/);assert.match(readResult(r.directory,r.steps[3].stdout.reference).text,/pipeline-end/);}
});
test('P2 native step timeout stops pipeline and proves whole scope death before fresh retry',{timeout:30000},async t=>{
 const f=fixture(t),p=check([step('timeout',`require('node:child_process').spawn('/bin/sleep',['60'],{detached:true,stdio:'ignore'});setInterval(()=>{},1000);`,200)],[step('never',`throw Error('must not run')`)]);
 await assert.rejects(f.checks.run(f.candidate,p,undefined,()=>{}),{code:'CHECK_TIMEOUT'});assert.equal(f.executions.confirmDead('candidate'),true);const [r]=f.receipts();assert.equal(r.status,'failed');assert.equal(r.code,'CHECK_TIMEOUT');assert.equal(r.steps.length,2);
 await f.checks.run(f.candidate,check([], [step('fresh',`require('node:assert/strict').equal(require('node:fs').existsSync('node_modules'),false)`)]),undefined,()=>{});
});
test('P2 native npm cache: restore verified downloads into a private cache; cache hit still runs all checks',{timeout:30000},async t=>{
 const f=fixture(t);const {createHash}=await import('node:crypto');const {publicDownloads,downloadCacheKey,ensureDownloadCache,fillDownloadCache}=await import('@oma/git/download-cache');const {nodeToolchainMounts}=await import('@oma/domain/resident-paths');
 const packageDir=join(f.root,'tar-source','package');mkdirSync(packageDir,{recursive:true});writeFileSync(join(packageDir,'package.json'),JSON.stringify({name:'oma-cache-proof',version:'1.0.0',main:'index.js'}));writeFileSync(join(packageDir,'index.js'),'module.exports=42');
 const tar=execFileSync('/usr/bin/tar',['-czf','-','-C',join(f.root,'tar-source'),'package']);const integrity='sha512-'+createHash('sha512').update(tar).digest('base64');
 const lock=Buffer.from(JSON.stringify({name:'proof',version:'1.0.0',lockfileVersion:3,packages:{'':{name:'proof',version:'1.0.0',dependencies:{'oma-cache-proof':'1.0.0'}},'node_modules/oma-cache-proof':{version:'1.0.0',resolved:'https://registry.npmjs.org/oma-cache-proof/-/oma-cache-proof-1.0.0.tgz',integrity}}}));
 const source=join(f.root,'source'),git=(...args)=>execFileSync('/usr/bin/git',args,{cwd:source,env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();writeFileSync(join(source,'package.json'),JSON.stringify({name:'proof',version:'1.0.0',dependencies:{'oma-cache-proof':'1.0.0'}}));writeFileSync(join(source,'package-lock.json'),lock);git('add','.');git('commit','-qm','dependencies');const candidate=git('rev-parse','HEAD');git('--git-dir',join(f.root,'project.git'),'fetch','-q',source,candidate);
 const policy=check([{id:'install',argv:['npm','ci','--offline','--ignore-scripts','--no-audit','--no-fund'],cwd:'.',env:{}}],[step('use',`require('node:assert/strict').equal(require('oma-cache-proof'),42)`)]);
 const pipeline={...policy.pipeline,cachePolicy:{kind:'npm-downloads',trustScope:'test',lockfile:'package-lock.json'}},selected={...policy,pipeline};
 const npm=nodeToolchainMounts(process.execPath).find(([,target])=>target.endsWith('/npm'))[0],manager='npm@'+JSON.parse(readFileSync(join(npm,'package.json'),'utf8')).version;
 const key=downloadCacheKey(join(f.root,'project.git'),pipeline,lock,manager),root=ensureDownloadCache(f.root,key);await fillDownloadCache(root,key,publicDownloads(lock),async()=>new Response(tar));
 try { await f.checks.run(candidate,selected,undefined,()=>{}); } catch (error) { for (const r of f.receipts()) for (const step of r.steps) if (step.stderr) t.diagnostic(readResult(r.directory,step.stderr.reference).text); throw error; } const [receipt]=f.receipts();assert.equal(receipt.status,'succeeded');assert.equal(receipt.cache.state,'hit');assert.equal(receipt.steps.length,4);
});
