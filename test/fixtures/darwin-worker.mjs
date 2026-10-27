/** Actual Pi/bootstrap/CLI/tool observations on Darwin. The production client
 * preload and native guards stay intact: an unresolved guard is a failed
 * attempt, never a skip or a successful boot. Direct-child closure below is
 * not arbitrary-descendant death, exact-file binding or Broker authorization. */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,realpathSync,existsSync,symlinkSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {resolvePiRuntime} from '@oma/engine/pi-runtime';
import {planPiSpawn} from '@oma/engine/pi-spawn-plan';
import {PiRpcClient} from '@oma/engine/pi-rpc';
import {macResidentSandbox} from '#oma-test/app/engine/resident-effects';
import {observeMacDeveloperTools} from '@oma/platform-mac/developer-tools';
import {spawnWithPrivateInputs} from '@oma/process/async';
import {runProcessSync} from '@oma/process/run';
import {GIT_ENV} from '@oma/process/policies';
import {DEPLOYMENT_LAYOUT} from '@oma/domain/deployment';
import {actorSocketPathAt,agentRootPathAt,workspacePathAt,runnerSessionDirPathAt,runnerViewPathAt} from '@oma/domain/paths';
import {decodeRunLease} from '@oma/protocol/run-lease';
import {withAsyncCleanup} from '@oma/native/cleanup';
assert.equal(process.platform,'darwin','Worker observations require the actual Darwin kernel');
const mode=process.argv[2];assert.ok(['worker-bootstrap','worker-tools'].includes(mode));
const root=realpathSync(process.cwd()),libdir=realpathSync(fileURLToPath(new URL('../../',import.meta.url))),node=realpathSync(process.execPath);
const stateRoot=join(root,'한 글자 "state'),runRoot=join(root,'run'),actor='alice',society='fixture',temporary=join(root,'owner-tmp');mkdirSync(temporary);
// This disposable observer owns its actual direct children; product bootstrap
// uses the leased, journaled preparation owner instead of this explicit port.
const tools=await observeMacDeveloperTools(temporary,async command=>runProcessSync(command));
const dirs={workspace:workspacePathAt(stateRoot,actor),home:join(agentRootPathAt(stateRoot,actor),'home'),
  archive:join(stateRoot,'mail/archive'),workerArchive:join(stateRoot,'mail/workers'),selfMail:join(stateRoot,'mail/inboxes',actor),
  view:runnerViewPathAt(stateRoot,actor),world:join(stateRoot,'world'),projectGit:join(stateRoot,'repos/project.git'),
  projectMirror:join(stateRoot,'repos/project-mirror.git'),sessions:runnerSessionDirPathAt(stateRoot,actor)};
for(const path of [...Object.values(dirs),join(dirs.archive,'cur'),join(dirs.workerArchive,'cur'),join(dirs.home,'.local/bin'),join(dirs.home,'.local/share'),join(dirs.home,'.run')])mkdirSync(path,{recursive:true,mode:0o700});
const socket=actorSocketPathAt(runRoot,actor,1);mkdirSync(dirname(socket),{recursive:true,mode:0o700});
const lease=decodeRunLease({actor,incarnation:1,socketHostPath:socket},{actor,runRoot});
const secret=join(root,'human-secret'),other=join(stateRoot,'agents/bob/home');mkdirSync(other,{recursive:true});
for(const path of [dirs.projectGit,dirs.world,dirs.archive])writeFileSync(join(path,'readonly-canary'),'shared readable bytes');
writeFileSync(secret,'host-only canary');writeFileSync(join(other,'secret'),'other-actor canary');symlinkSync(other,join(dirs.workspace,'other-alias'));
const runtime=resolvePiRuntime({stateRoot,libdir,node});
const limits={frameBytes:1<<20,idleStreamSeconds:60,receiptWaitSeconds:30,batchMaxMessages:24,
  mailBodyBytes:1<<20,addresses:64,contextBytes:1<<20,bundleBytes:1<<20};
const options={actor,society,limits,profile:{provider:'pi',model:'current',inferenceSeconds:600,prompt:'',extensions:[]},
  paths:{piCommand:runtime.executable,piArgs:runtime.args,piAgentDir:runtime.agentDir,coreExtension:join(libdir,DEPLOYMENT_LAYOUT.extension),
    cli:join(libdir,DEPLOYMENT_LAYOUT.cli),workspace:dirs.workspace,sessionDir:dirs.sessions,agentHome:dirs.home,
    mailArchive:join(dirs.archive,'cur'),workerArchive:join(dirs.workerArchive,'cur'),projectGit:dirs.projectGit,batchView:dirs.view,socket},
  confinement:{host:{libdir,node,pi:runtime.bundle,piModeArgs:[],stateRoot,runRoot,limits,
    hidden:DEPLOYMENT_LAYOUT.productSurface.map(path=>({path,kind:/\.[jt]s$/.test(path)?'file':'dir'}))},lease,directories:dirs}};
const prior=join(dirs.sessions,'2026-01-01T00-00-00-000Z_prior.jsonl'),sessionId='0190f000-0000-7000-8000-000000000001';
writeFileSync(prior,JSON.stringify({type:'session',version:3,id:sessionId,timestamp:'2026-01-01T00:00:00.000Z',cwd:dirs.workspace})+'\n');
const plan=planPiSpawn(macResidentSandbox(tools),options);
assert.equal(plan.env.HOME,dirs.home);assert.equal(plan.env.GIT_EXEC_PATH,tools.execPath);
assert.equal(plan.env.OMA_CLI,join(libdir,DEPLOYMENT_LAYOUT.cli));assert.ok(plan.env.NODE_OPTIONS.includes('client-preload.js'));
assert.equal(plan.privateInputs.length,1);assert.equal(plan.privateInputs[0].fd,3);
const profileDigest=createHash('sha256').update(plan.privateInputs[0].bytes).digest('hex');
const probe=join(dirs.workspace,'worker-tools.mjs');
writeFileSync(probe,`import assert from 'node:assert/strict';import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {spawnSync} from 'node:child_process';
const {dirs,secret,other,tools,libdir}=JSON.parse(process.argv[2]);
assert.equal(process.platform,'darwin');assert.equal(process.cwd(),dirs.workspace);assert.equal(process.env.HOME,dirs.home);
const denied=fn=>assert.throws(fn,e=>['EACCES','EPERM'].includes(e.code));
denied(()=>readFileSync(secret));denied(()=>readFileSync(other+'/secret'));denied(()=>readFileSync('other-alias/secret'));
for(const path of [dirs.projectGit,dirs.world,dirs.archive])assert.equal(readFileSync(path+'/readonly-canary','utf8'),'shared readable bytes');
for(const path of [dirs.projectGit,dirs.world,dirs.archive,libdir])denied(()=>writeFileSync(path+'/forbidden','no'));
for(const path of [dirs.workspace,dirs.home,dirs.sessions])writeFileSync(path+'/own-canary','own bytes');
function run(file,args,code=0){const r=spawnSync(file,args,{env:process.env,encoding:'utf8',timeout:10000,maxBuffer:65536,killSignal:'SIGKILL'});
 assert.equal(r.error,undefined,file+': '+r.stderr);assert.equal(r.signal,null,file+': '+r.stderr);assert.equal(r.status,code,file+': '+r.stderr);return r;}
assert.equal(run('git',['--exec-path']).stdout.trim(),tools.execPath);run('git',['--version']);run('npm',['--version']);
run('git',['init','-q']);writeFileSync('literal.txt','exact\\r\\n$literal\\n');run('git',['add','literal.txt']);run('git',['commit','-qm','actor commit']);
assert.equal(run('git',['log','-1','--format=%an']).stdout.trim(),'alice');
const cli=run('oma',['--help'],2);assert.match(cli.stderr,/usage:/);assert.match(cli.stderr,/oma status/);
writeFileSync('own-script.sh','#!/bin/sh\\nprintf "own-script\\\\n"\\n',{mode:0o755});assert.equal(run('./own-script.sh',[]).stdout,'own-script\\n');
writeFileSync('own-native.c','int main(void){return 0;}');run('cc',['own-native.c','-o','own-native']);run('./own-native',[]);
console.log(JSON.stringify({git:true,npm:true,cli:true,ownScript:true,ownNativeBuild:true,privateReadsDenied:true,sharedWritesDenied:true}));`);
const quote=value=>"'"+value.replaceAll("'","'\"'\"'")+"'";
const command=[quote(node),quote(probe),quote(JSON.stringify({dirs,secret,other,tools,libdir}))].join(' ');
const child=spawnWithPrivateInputs(plan.command,plan.args,plan.cwd,plan.env,plan.privateInputs);
let stderr='',spawnError;const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
child.on('error',error=>{spawnError=error;});child.stderr.on('data',bytes=>{stderr+=bytes.toString();if(Buffer.byteLength(stderr)>65536)child.kill('SIGKILL');});
const rpc=new PiRpcClient(child,limits),deadline=setTimeout(()=>child.kill('SIGKILL'),90000);
async function request(message){
  let unsubscribe=()=>{},timer;const response=new Promise((resolve,reject)=>{
    unsubscribe=rpc.onEvent(event=>{if(event.type==='response'&&event.id===message.id){
      if(event.success===true)resolve(event.data);else reject(new Error('actual Pi RPC refused '+JSON.stringify(event)));}});
    timer=setTimeout(()=>reject(new Error('actual Pi RPC deadline: '+message.type+'; '+stderr)),40000);
    void rpc.completion.then(()=>reject(new Error('actual Pi ended before '+message.type+'; '+stderr)));
  });void response.catch(()=>{});
  try{await rpc.send(message);return await response;}finally{clearTimeout(timer);unsubscribe();}
}
let result;
await withAsyncCleanup(async()=>{
  const state=await request({id:'initial-state',type:'get_state'});assert.equal(state.sessionFile,prior);assert.equal(state.sessionId,sessionId);
  result={rpcStdin:true,exactSessionResumed:true,physicalPaths:true,productionPreload:true};
  if(mode==='worker-tools'){
    const executed=await request({id:'actual-tools',type:'bash',command,excludeFromContext:true});
    assert.equal(executed.exitCode,0,executed.output+'\n'+stderr);assert.equal(executed.cancelled,false);assert.equal(executed.truncated,false);
    assert.deepEqual(JSON.parse(executed.output.trim()),{git:true,npm:true,cli:true,ownScript:true,ownNativeBuild:true,privateReadsDenied:true,sharedWritesDenied:true});
    for(const path of [dirs.workspace,dirs.home,dirs.sessions])assert.equal(readFileSync(join(path,'own-canary'),'utf8'),'own bytes');
    assert.ok(existsSync(join(dirs.workspace,'own-native')));assert.ok(readFileSync(prior,'utf8').includes('bashExecution'));
    result={...result,git:true,npm:true,cli:true,ownScript:true,ownNativeBuild:true,privateReadsDenied:true,sharedWritesDenied:true};
  }
},async()=>{
  clearTimeout(deadline);rpc.close();if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
  const forced=setTimeout(()=>child.kill('SIGKILL'),5000);try{await closed;}finally{clearTimeout(forced);}
});
assert.equal(spawnError,undefined);assert.equal(readFileSync(secret,'utf8'),'host-only canary');assert.equal(readFileSync(join(other,'secret'),'utf8'),'other-actor canary');
console.log(JSON.stringify({case:mode,worker:{...result,selectedDeveloperTools:tools,profileDigest,directChildClosed:true}}));
