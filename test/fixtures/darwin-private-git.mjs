/** Actual App Git owners, one immutable generation and actual journal scopes.
 * Called inside the whole-generation qualification to avoid a second cold copy. */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,openSync,closeSync,readSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {ExecutionJournal} from '@oma/storage/execution-journal';
import {QuarantineImporter} from '@oma/git/quarantine';
import {snapshotIntegrationPolicy} from '@oma/domain/integration-policy';
import {exportRefForRequestKey} from '@oma/domain/derived';
import {launchDarwinJobScope} from '@oma/process/darwin-execution';
import {ExecutionRuntime} from '#oma-test/app/runtime/execution-runtime';
import {CandidateChecks} from '#oma-test/app/runtime/candidate-checks';
import {quarantineExecution} from '#oma-test/app/runtime/quarantine-execution';
import {withAsyncCleanup,cleanupAll} from '@oma/native/cleanup';
import {observeMacDeveloperTools} from '@oma/platform-mac/developer-tools';
import {preparePipelineCache} from '#oma-test/app/runtime/pipeline-cache';
import {readResult} from '@oma/tool-files';
import {inspect} from 'node:util';
import {observeDarwinCoalitionPopulation} from '@oma/native/audit-session';

export async function verifyDarwinGitRuntime(generation,installation,root,signal){
 assert.equal(process.platform,'darwin');mkdirSync(root,{mode:0o700});
 const source=join(root,'source'),project=join(root,'project.git');mkdirSync(source);
 const env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',HOME:root,TMPDIR:root,
  GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',
  GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'};
 const git=(cwd,...argv)=>{const r=spawnSync('/usr/bin/git',argv,{cwd,env,encoding:'utf8',timeout:10000});
  assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 git(source,'init','-q');writeFileSync(join(source,'exact.txt'),'private generation checkout\r\n');
 writeFileSync(join(source,'package-lock.json'),JSON.stringify({lockfileVersion:3,packages:{}}));
 git(source,'add','.');git(source,'commit','-qm','base');const base=git(source,'rev-parse','HEAD');
 git(root,'clone','-q','--bare',source,project);const before=git(root,'--git-dir',project,'show-ref');
 const paths={stateRoot:root,projectGit:project,contextGit:join(root,'context.git'),worldDir:join(root,'world'),society:'demo',
  checkNode:installation.node,checkAssetsDir:installation.libdir,ownerSignal:signal};
 ExecutionJournal.initialize(root);const runtime=new ExecutionRuntime(root,launchDarwinJobScope);
 const originals=['candidate-check.js','quarantine.js','download-cache.js'].map(name=>{const path=join(installation.libdir,'apps/oma/dist/entry',name);return{path,bytes:readFileSync(path)};});
 const launches=[],results=[];
 const launch=async(command,options,policy)=>{
  assert.ok(originals.some(file=>file.path===command.argv[0]));
  assert.equal(policy!==undefined,command.argv[0]!==originals[2].path);
  const scope=await generation.launchNode(command,options,policy);
  if(command.argv[0]===originals[0].path)void scope.result.then(result=>{
   try{console.error(JSON.stringify({phase:'private-candidate-terminal',pipeline:JSON.parse(command.argv[1]).pipeline!==undefined,
    witness:scope.witness,kind:result.kind,exitCode:result.exitCode,signal:result.signal,
    stdout:result.stdout.toString().slice(0,8192),stderr:result.stderr.toString().slice(0,8192)}));}catch{/* diagnostics do not change the owned outcome */}
  },error=>{try{console.error(inspect(error,{depth:null,maxArrayLength:128,maxStringLength:8192}));}catch{/* keep the original rejection */}});
  launches.push({entry:command.argv[0],witness:scope.witness});return scope;
 };
 let bundleFd;
 await withAsyncCleanup(async()=>{
  await runtime.recover();
  for(const file of originals)writeFileSync(file.path,"throw new Error('mutable original installation was executed');\n");
  const temporary=join(root,'cache-home');mkdirSync(temporary,{mode:0o700});
  const tools=await observeMacDeveloperTools(temporary,command=>runtime.run('preparation',command,signal,()=>{}));
  const cachePipeline={version:2,setupSteps:[],checkSteps:[{id:'unused',argv:['/bin/false'],cwd:'.',env:{}}],env:{},
   toolchainDigest:'b'.repeat(64),cachePolicy:{kind:'npm-downloads',trustScope:'private-runtime',lockfile:'package-lock.json'}};
  const cacheExecution={git:tools.git,environment:{HOME:temporary,TMPDIR:temporary,DEVELOPER_DIR:tools.developer,GIT_EXEC_PATH:tools.execPath},
   run:(command,cancel)=>runtime.run('preparation',command,cancel,()=>{},[],undefined,undefined,
    command.executable===installation.node?(source,options)=>launch(source,options):undefined)};
  const rebuilt=await preparePipelineCache(paths,base,cachePipeline,signal,cacheExecution);
  assert.equal(rebuilt?.state,'rebuilt');assert.deepEqual(rebuilt.files,[]);
  const hit=await preparePipelineCache(paths,base,cachePipeline,signal,cacheExecution);
  assert.equal(hit?.state,'hit');assert.equal(hit.root,rebuilt.root);assert.equal(launches.length,1);
  assert.equal(runtime.confirmDead('preparation'),true);assert.deepEqual(ExecutionJournal.inspect(root),[]);
  const checks=new CandidateChecks(paths,async(command,cancel,authorize,fds,prepared,physical)=>{
   const result=await runtime.run('candidate',command,cancel,authorize,fds,undefined,prepared,physical);
   results.push(result);return result;
  },undefined,signal,()=>runtime.confirmDead('candidate'),undefined,launch);
  const currentCandidate=()=>{
   const last=launches.at(-1),row=ExecutionJournal.inspect(root).find(row=>row.slot==='candidate');
   return last?.entry===originals[0].path&&row?.witness?.kind==='darwin-resource-coalition'&&
    row.witness.bootId===last.witness.bootId&&row.witness.coalitionId===last.witness.coalitionId;
  };
  const projectStat=statSync(project,{bigint:true}),projectIdentity={dev:String(projectStat.dev),ino:String(projectStat.ino)};
  const exact=snapshotIntegrationPolicy({maxWorkers:6,policyRevision:'private-runtime',protectedPaths:[],checks:[{id:'exact',env:{},
   argv:[installation.node,'-e',`const a=require('node:assert/strict'),f=require('node:fs');
    a.equal(f.readFileSync('exact.txt','utf8'),'private generation checkout\\r\\n');
    try{const s=f.fstatSync(7,{bigint:true});a.notDeepEqual({dev:String(s.dev),ino:String(s.ino)},${JSON.stringify(projectIdentity)});}
    catch(error){if(error.code!=='EBADF')throw error;}
    a.throws(()=>f.readFileSync(${JSON.stringify(originals[0].path)}),e=>['EPERM','EACCES'].includes(e.code));
    process.stdout.write('private-check');`]}]}).checks[0];
  let authorized=0;await checks.run(base,exact,signal,()=>{if(currentCandidate())authorized++;});
  assert.equal(authorized,2);assert.equal(results.at(-1).stdout.toString(),'private-check');
  assert.equal(runtime.confirmDead('candidate'),true);assert.deepEqual(ExecutionJournal.inspect(root),[]);
  const step=(id,script)=>({id,argv:[installation.node,'-e',script],cwd:'.',env:{}});
  const pipeline=snapshotIntegrationPolicy({maxWorkers:6,policyRevision:'protected-pipeline',protectedPaths:[],checks:[{
   id:'protected-pipeline',argv:['oma-pipeline-v2'],env:{},pipeline:{version:2,toolchainDigest:'a'.repeat(64),env:{},cachePolicy:{kind:'off'},
    setupSteps:[step('setup',`const f=require('node:fs');f.mkdirSync('node_modules');f.writeFileSync('node_modules/proof','installed');f.writeFileSync('exact.txt','generated');`)],
    checkSteps:[step('check',`require('node:assert/strict').equal(require('node:fs').readFileSync('node_modules/proof','utf8'),'installed');process.stdout.write('protected pipeline check');`)]}
  }]}).checks[0];
  try{await checks.run(base,pipeline,signal,()=>{},'protected-pipeline');}
  catch(error){
   try{console.error(JSON.stringify({phase:'protected-pipeline',stderr:results.at(-1)?.stderr.toString().slice(0,8192),
     journal:ExecutionJournal.inspect(root),lastWitness:launches.at(-1)?.witness,
     population:launches.at(-1)?.witness?observeDarwinCoalitionPopulation(launches.at(-1).witness):'not-acquired'}));}
   catch(diagnostic){console.error(inspect(diagnostic,{depth:null}));}
   // Log before the test-worker Error serializer drops nested AggregateError
   // entries. The primary exception and cleanup outcome remain unchanged.
   console.error(inspect(error,{depth:null,maxArrayLength:128,maxStringLength:8192}));throw error;
  }
  const receiptDirectory=join(root,'checks',readdirSync(join(root,'checks'))[0]),receipt=JSON.parse(readFileSync(join(receiptDirectory,'receipt.json'),'utf8'));
  assert.equal(receipt.status,'succeeded');assert.equal(receipt.scopeConfirmedDead,true);assert.equal(receipt.steps.length,4);
  assert.ok(receipt.tracked.bytes>0);assert.match(readResult(receiptDirectory,receipt.tracked.reference).text,/generated/);
  assert.equal(readResult(receiptDirectory,receipt.steps[3].stdout.reference).text,'protected pipeline check');
  assert.equal(runtime.confirmDead('candidate'),true);assert.deepEqual(ExecutionJournal.inspect(root),[]);
  const refused=new Error('revoked after immutable checkout');authorized=0;
  await assert.rejects(checks.run(base,exact,signal,()=>{if(currentCandidate()&&++authorized===2)throw refused;}),e=>e===refused);
  assert.equal(authorized,2);assert.equal(runtime.confirmDead('candidate'),true);
  assert.equal(git(root,'--git-dir',project,'show-ref'),before);assert.deepEqual(ExecutionJournal.inspect(root),[]);
  assert.deepEqual(readdirSync(join(root,'staging')),[]);

  writeFileSync(join(source,'new.txt'),'accepted bundle bytes');git(source,'add','.');git(source,'commit','-qm','next');
  const candidate=git(source,'rev-parse','HEAD'),ref=exportRefForRequestKey('private-runtime');git(source,'update-ref',ref,candidate);
  const bundle=join(root,'accepted.bundle');git(source,'bundle','create',bundle,ref,'^'+base);
  const bytes=readFileSync(bundle);bundleFd=openSync(bundle,'r');const advanced=Buffer.alloc(5);assert.equal(readSync(bundleFd,advanced),5);
  const has=oid=>{const r=spawnSync('/usr/bin/git',['--git-dir',project,'cat-file','-e',oid+'^{commit}'],{env,timeout:10000});
   assert.equal(r.error,undefined);assert.equal(r.signal,null);return r.status===0;};
  assert.equal(has(candidate),false);const physical=quarantineExecution(paths,runtime,launch);let phases=0;
  const importer=new QuarantineImporter(paths,has,{slotState:physical.slotState,async execute(request,authorize){
   assert.equal(request.phase,phases++===0?'verify':'import');
   const result=await physical.execute(request,authorize);
   assert.equal(has(candidate),request.phase==='import');assert.equal(git(root,'--git-dir',project,'show-ref'),before);
   return result;
  }});
  authorized=0;await importer.importBundle(bundleFd,candidate,ref,[base],()=>authorized++);
  assert.equal(phases,2);assert.ok(authorized>=2);assert.equal(has(candidate),true);
  const next=Buffer.alloc(1);assert.equal(readSync(bundleFd,next),1);assert.equal(next[0],bytes[5]);
  assert.deepEqual(readFileSync(bundle),bytes);assert.deepEqual(ExecutionJournal.inspect(root),[]);
  assert.equal(runtime.confirmDead('quarantine'),true);assert.deepEqual(readdirSync(join(root,'staging')),[]);
  assert.equal(launches.length,6);assert.ok(launches.every(row=>row.witness.kind==='darwin-resource-coalition'));
 },async()=>{
  await withAsyncCleanup(()=>runtime.close(),()=>cleanupAll([
   ()=>{if(bundleFd!==undefined)closeSync(bundleFd);},...originals.map(file=>()=>writeFileSync(file.path,file.bytes)),
  ]));
 }).catch(error=>{
  // Capture the complete cause tree in its original process, including tool
  // discovery/cache preparation and cleanup, before test-worker serialization.
  try{console.error(inspect(error,{depth:null,maxArrayLength:128,maxStringLength:8192}));}catch{/* retain the primary failure */}
  try{
   const journal=ExecutionJournal.inspect(root);
   console.error(JSON.stringify({phase:'private-git-owned-failure',journal,
    populations:journal.map(row=>({slot:row.slot,witness:row.witness,
     population:row.witness?.kind==='darwin-resource-coalition'?observeDarwinCoalitionPopulation(row.witness):'not-acquired'}))}));
  }catch(diagnostic){try{console.error(inspect(diagnostic,{depth:null}));}catch{/* retain the primary failure */}}
  throw error;
 });
}
