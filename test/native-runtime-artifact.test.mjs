/** Cache metadata is not role/death evidence. The Darwin case uses a real
 * killed producer, detached scope descendants and fresh journal recovery. */
import test from'node:test';import assert from'node:assert/strict';
import{closeSync,constants,fstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync,existsSync,copyFileSync,readdirSync}from'node:fs';
import{tmpdir}from'node:os';import{join}from'node:path';import{fileURLToPath}from'node:url';import{spawn}from'node:child_process';import{once}from'node:events';import{setTimeout as delay}from'node:timers/promises';
import{openDirectory}from'@oma/native/files';
import{setDarwinUserImmutable,darwinOwnedEntryFlags}from'@oma/native/darwin-file-flags';
import{prepareMacRuntimeGeneration}from'#oma-test/app/runtime/mac-runtime-generation';
import{ExecutionJournal}from'@oma/storage/execution-journal';
import{observeDarwinCoalitionPopulation}from'@oma/native/audit-session';
import{launchDarwinJobScope}from'@oma/process/darwin-execution';
import{ExecutionRuntime}from'#oma-test/app/runtime/execution-runtime';
import{collectRuntimeArtifacts,writeRuntimeArtifactOwner,readRuntimeArtifactOwner,GENERATION_OWNER,retainRuntimeArtifact}from'#oma-test/app/runtime/mac-runtime-artifact';
import{deploymentDigest}from'#oma-test/app/runtime/deployment-manifest';
import{minimalRuntime}from'./fixtures/minimal-runtime.mjs';
const name='.oma-runtime-00000000-0000-4000-8000-000000000001';
test('001. Actual artifact metadata binds the held parent/root and refuses a copied claim without changing its bytes',t=>{
 const parent=realpathSync(mkdtempSync(join(tmpdir(),'oma-artifact-owner-'))),root=join(parent,name),other=join(parent,'other');mkdirSync(root,{mode:0o700});mkdirSync(other,{mode:0o700});
 const p=openDirectory(parent),r=openDirectory(root),o=openDirectory(other);t.after(()=>{closeSync(o);closeSync(r);closeSync(p);rmSync(parent,{recursive:true});});
 writeRuntimeArtifactOwner(p,r,name,'a'.repeat(64),{files:[GENERATION_OWNER,'.oma-node-bin/node'],directories:['.oma-node-bin'],links:[]});
 const value=readRuntimeArtifactOwner(p,r,name);assert.equal(value.root.ino,String(fstatSync(r,{bigint:true}).ino));
 const marker=join(root,GENERATION_OWNER),before=readFileSync(marker);copyFileSync(marker,join(other,GENERATION_OWNER));
 assert.throws(()=>readRuntimeArtifactOwner(p,o,name),{code:'RUN_TERMINATION_UNKNOWN'});assert.deepEqual(readFileSync(marker),before);
 const release=retainRuntimeArtifact(r);assert.throws(()=>retainRuntimeArtifact(r),{code:'RUN_TERMINATION_UNKNOWN'});release();release();retainRuntimeArtifact(r)();
});
async function bounded(promise,milliseconds,label){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),milliseconds);})]);}finally{clearTimeout(timer);}}
for(const mode of ['preparing','running'])test(`002. Fresh Darwin recovery drains a killed ${mode} generation producer before unsealing only its recorded disposable tree`,{timeout:90000},async t=>{
 if(process.platform!=='darwin')return assert.rejects(collectRuntimeArtifacts('/unused'),{code:'UNSUPPORTED_PROFILE'});
 const parent=realpathSync(mkdtempSync(join(tmpdir(),'oma-artifact-recovery-'))),state=join(parent,'state'),cache=join(parent,'cache'),work=join(parent,'work');for(const p of[state,cache,work])mkdirSync(p,{mode:0o700});ExecutionJournal.initialize(state);
 const code=`import{spawn}from'node:child_process';import{writeFileSync}from'node:fs';const daemon=spawn(process.execPath,['-e',"require('node:fs').writeFileSync(process.env.HOME+'/descendant',String(process.pid));setInterval(()=>{},1000)"],{detached:true,stdio:'ignore',env:process.env});daemon.unref();writeFileSync(process.env.HOME+'/entered',String(process.pid));setInterval(()=>{},1000);`;
 const{installation}=minimalRuntime(join(parent,'source'),code),fixture=fileURLToPath(new URL('./fixtures/darwin-generation-crash.mjs',import.meta.url));
 const child=spawn(process.execPath,[fixture,installation.libdir,installation.node,installation.deploymentDigest,state,cache,work,mode],{stdio:['ignore','pipe','pipe']});let output='',errors='',controller,report;
 const closed=once(child,'close');void closed.catch(()=>{});child.stdout.on('data',b=>{output+=b;});child.stderr.on('data',b=>{errors+=b;});
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await closed;
  if(!controller)controller=new ExecutionRuntime(state,launchDarwinJobScope);
  await controller.recover();await controller.close();
  const cleanup=new ExecutionRuntime(state,launchDarwinJobScope);await cleanup.recoverAndMaintain(()=>collectRuntimeArtifacts(cache));await cleanup.close();rmSync(parent,{recursive:true});
 });
 const until=performance.now()+30000;while(!output.includes('\n')||(mode==='running'?!existsSync(join(work,'descendant')):readdirSync(cache).length===0)){assert.ok(performance.now()<until,errors||'generation child did not start');if(child.exitCode!==null)assert.fail(errors);await delay(5);}
 report=JSON.parse(output.slice(0,output.indexOf('\n')));assert.equal(report.kind,mode);if(mode==='preparing')report.root=join(cache,readdirSync(cache)[0]);assert.equal(existsSync(report.root),true);if(report.witness)assert.deepEqual(ExecutionJournal.inspect(state)[0].witness,report.witness);
 child.kill('SIGKILL');const status=await bounded(closed,15000,'producer SIGKILL did not join');assert.deepEqual(status,[null,'SIGKILL']);if(mode==='preparing'){const remaining=readdirSync(cache);assert.equal(remaining.length,1);report.root=join(cache,remaining[0]);}assert.equal(existsSync(report.root),true);
 controller=new ExecutionRuntime(state,launchDarwinJobScope);let collected=false;
 await controller.recoverAndMaintain(async()=>{if(report.witness)assert.equal(observeDarwinCoalitionPopulation(report.witness),'empty');assert.deepEqual(ExecutionJournal.inspect(state),[]);await collectRuntimeArtifacts(cache);collected=true;});
 assert.equal(collected,true);assert.equal(existsSync(report.root),false);if(report.witness)assert.equal(observeDarwinCoalitionPopulation(report.witness),'empty');
 assert.equal(deploymentDigest(installation.libdir),installation.deploymentDigest);
});


test('003. Darwin collection refuses a still-retained generation and leaves immutable bytes in place',{timeout:60000},async t=>{
 if(process.platform!=='darwin')return assert.rejects(collectRuntimeArtifacts('/unused'),{code:'UNSUPPORTED_PROFILE'});
 const parent=realpathSync(mkdtempSync(join(tmpdir(),'oma-live-generation-'))),state=join(parent,'state'),cache=join(parent,'cache');mkdirSync(state,{mode:0o700});mkdirSync(cache,{mode:0o700});ExecutionJournal.initialize(state);
 const runtime=new ExecutionRuntime(state,launchDarwinJobScope),{installation}=minimalRuntime(join(parent,'source'),'export {};');let generation,refused=false;
 t.after(async()=>{await generation?.closeAsync();if(refused)await assert.rejects(runtime.close(),{code:'RUN_TERMINATION_UNKNOWN'});else await runtime.close();rmSync(parent,{recursive:true});});
 generation=await prepareMacRuntimeGeneration(installation,cache);const bytes=readFileSync(join(generation.root,GENERATION_OWNER));
 await assert.rejects(runtime.recoverAndMaintain(()=>collectRuntimeArtifacts(cache)),{code:'RUN_TERMINATION_UNKNOWN'});refused=true;
 const fd=openDirectory(generation.root);try{assert.equal(darwinOwnedEntryFlags(fd)&2,2);}finally{closeSync(fd);}
 assert.deepEqual(readFileSync(join(generation.root,GENERATION_OWNER)),bytes);
});
test('004. Darwin collection inspects every entry before unsealing and preserves an unrecognized file',{timeout:30000},async t=>{
 if(process.platform!=='darwin')return assert.rejects(collectRuntimeArtifacts('/unused'),{code:'UNSUPPORTED_PROFILE'});
 const parent=realpathSync(mkdtempSync(join(tmpdir(),'oma-unknown-generation-'))),state=join(parent,'state'),cache=join(parent,'cache'),root=join(cache,name);mkdirSync(state,{mode:0o700});mkdirSync(cache,{mode:0o700});mkdirSync(root,{mode:0o700});ExecutionJournal.initialize(state);
 const runtime=new ExecutionRuntime(state,launchDarwinJobScope),p=openDirectory(cache),r=openDirectory(root);let refused=false;
 t.after(async()=>{setDarwinUserImmutable(r,false);closeSync(r);closeSync(p);if(refused)await assert.rejects(runtime.close(),{code:'RUN_TERMINATION_UNKNOWN'});else await runtime.close();rmSync(parent,{recursive:true});});
 writeRuntimeArtifactOwner(p,r,name,'a'.repeat(64),{files:[GENERATION_OWNER,'.oma-node-bin/node'],directories:['.oma-node-bin'],links:[]});writeFileSync(join(root,'foreign.txt'),'preserve these bytes');setDarwinUserImmutable(r,true);
 await assert.rejects(runtime.recoverAndMaintain(()=>collectRuntimeArtifacts(cache)),{code:'RUN_TERMINATION_UNKNOWN'});refused=true;
 assert.equal(darwinOwnedEntryFlags(r)&2,2);assert.equal(readFileSync(join(root,'foreign.txt'),'utf8'),'preserve these bytes');
});
