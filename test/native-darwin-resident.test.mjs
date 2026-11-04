/** Actual App Resident composition with a small trusted fixture receiver.
 * This does not bypass the product guard or prove product Runner/Worker admission. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,symlinkSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {Store} from '@oma/storage';
import {ExecutionJournal} from '@oma/storage/execution-journal';
import {DEPLOYMENT_LAYOUT} from '@oma/domain/deployment';
import {actorSocketPathAt} from '@oma/domain/paths';
import {createMachBrokerTransport} from '@oma/platform-mac/mach-transport';
import {bundledJobHelper} from '@oma/native/darwin-job-launch';
import {bundledSeatbeltHelper} from '@oma/platform-mac/seatbelt';
import {launchDarwinJobScope} from '@oma/process/darwin-execution';
import {defaultHostConfig} from '@oma/config/defaults';
import {withAsyncCleanup} from '@oma/native/cleanup';
import {createMacRuntimeGeneration} from '#oma-test/app/runtime/mac-runtime-generation';
import {deploymentDigest} from '#oma-test/app/runtime/deployment-manifest';
import {ExecutionRuntime} from '#oma-test/app/runtime/execution-runtime';
import {createNativeResidents} from '#oma-test/app/runtime/native-residents';
import {newSessionBirth,publishSessionBirth} from '#oma-test/app/runtime/session-mode';
import {makeValidAgent,ALL_CAPS} from '../dist/test/fixtures/spec.js';

test('001. Darwin App Resident binds its actual private Node child to FD 6 and one preallocated incarnation endpoint',{timeout:60000},async t=>{
 if(process.platform!=='darwin'){
  await assert.rejects(launchDarwinJobScope({executable:process.execPath,argv:[],env:{},timeoutMs:null,stdoutBytes:0,stderrBytes:0}),e=>e.cause?.code==='UNSUPPORTED_PROFILE');
  return;
 }
 const parent=realpathSync(mkdtempSync(join(tmpdir(),'oma-mac-resident-'))),root=join(parent,'demo'),source=join(parent,'installation');mkdirSync(root);
 let runtime,generation,units,store,listener,timer;
 t.after(async()=>{clearTimeout(timer);
  await withAsyncCleanup(()=>units?.close(),()=>runtime?.close());
  if(listener)await new Promise((resolve,reject)=>{try{listener.close(resolve);}catch(e){reject(e);}});
  generation?.close();store?.close();rmSync(parent,{recursive:true});
 });
 mkdirSync(join(source,'node_modules/@oma'),{recursive:true});const packages={'':{name:'resident-fixture'}};
 for(const workspace of DEPLOYMENT_LAYOUT.workspaces){
  mkdirSync(join(source,workspace.root,'dist'),{recursive:true});
  writeFileSync(join(source,workspace.root,'package.json'),JSON.stringify({name:workspace.name,version:'0.1.0',type:'module',exports:{'.':'./dist/index.js'}}));
  writeFileSync(join(source,workspace.root,'dist/index.js'),'export {};\n');
  symlinkSync(join(source,workspace.root),join(source,'node_modules',workspace.name));packages['node_modules/'+workspace.name]={resolved:workspace.root,link:true};
 }
 writeFileSync(join(source,'package.json'),JSON.stringify({name:'resident-fixture',type:'module'}));
 writeFileSync(join(source,'package-lock.json'),JSON.stringify({lockfileVersion:3,packages}));writeFileSync(join(source,DEPLOYMENT_LAYOUT.schema),'fixture bytes');
 for(const [path,actual]of[['job-helper/oma-job-helper',bundledJobHelper()],['seatbelt/oma-seatbelt',bundledSeatbeltHelper()]]){
  const file=join(source,'packages/native/dist',path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,readFileSync(actual),{mode:0o500});
 }
 const entry=join(source,'apps/oma/dist/entry/runner.js');mkdirSync(dirname(entry));
 writeFileSync(entry,`import{Socket}from'node:net';const socket=new Socket({fd:6,readable:true,writable:true});socket.on('error',()=>{});
 socket.write(JSON.stringify({pid:process.pid,node:process.execPath,entry:process.argv[1],profile:process.env.OMA_PROFILE_HEX,model:process.env.OMA_MODEL_PROFILE_HEX})+'\\n');setInterval(()=>{},1000);`);
 const installation={libdir:source,node:realpathSync(process.execPath),deploymentDigest:deploymentDigest(source)};
 generation=createMacRuntimeGeneration(installation,parent);ExecutionJournal.initialize(root);runtime=new ExecutionRuntime(root,launchDarwinJobScope);await runtime.recover();
 publishSessionBirth(root,newSessionBirth(root,'society',process.cwd(),'collaboration-v1'));
 store=new Store(join(root,'runtime.sqlite'));store.transaction(tx=>tx.insertAgent(makeValidAgent('alice',{capabilities:ALL_CAPS.filter(c=>c!=='context.publish')})));
 const config=defaultHostConfig({society:'demo',...installation});config.agentProfiles.p=config.agentProfiles.resident;config.modelProfiles.md=config.modelProfiles.worker;
 const transport=createMachBrokerTransport(15),runRoot=join(root,'run');let bound,resolve,reject;
 const received=new Promise((yes,no)=>{resolve=yes;reject=no;});void received.catch(()=>{});
 units=createNativeResidents(store,runtime,{stateRoot:root,runRoot,society:'demo',configPath:join(root,'config.json')},config,(socket,peer)=>{
  bound=peer;let line='';socket.on('error',reject);socket.on('data',bytes=>{line+=bytes;if(line.includes('\n'))resolve(JSON.parse(line.slice(0,line.indexOf('\n'))));});socket.resume();
 },()=>{},actor=>store.getAgent(actor)?.incarnation??null,{environment:{HOME:root,TMPDIR:root,PATH:'/usr/bin:/bin'},darwin:{launchNode:generation.launchNode,reservePeer:transport.reservePeer}});
 timer=setTimeout(()=>reject(new Error('private Resident did not reach the actual Host channel')),20000);
 await units.start('alice',false);const value=await received;clearTimeout(timer);
 assert.equal(value.node,generation.node);assert.equal(value.entry,join(generation.root,'apps/oma/dist/entry/runner.js'));
 assert.equal(bound.pid,value.pid);assert.equal(bound.uid,process.getuid());assert.equal(bound.alive(),true);assert.equal(bound.inheritedRunner.actor,'alice');
 const rows=ExecutionJournal.inspect(root);assert.equal(rows.length,1);assert.equal(rows[0].witness.kind,'darwin-resource-coalition');
 assert.equal(bound.inheritedRunner.invocationId,rows[0].execution.replaceAll('-',''));assert.equal(units.scopeRoot('alice'),null);assert.deepEqual(units.scopeIdentity('alice'),rows[0].witness);
 assert.equal(bound.inScope(rows[0].witness),true);
 assert.equal(bound.inScope({...rows[0].witness,coalitionId:String(BigInt(rows[0].witness.coalitionId)+1n)}),false);
 assert.equal(bound.inScope({...rows[0].witness,bootId:'00000000-0000-4000-8000-000000000000'}),false);
 assert.equal(Buffer.from(value.profile,'hex').toString(),'p');assert.equal(Buffer.from(value.model,'hex').toString(),'md');
 const incarnation=store.getAgent('alice').incarnation,path=actorSocketPathAt(runRoot,'alice',incarnation+1);
 assert.throws(()=>transport.reservePeer(path),{code:'BROKER_UNAVAILABLE'});
 ({listener}=transport.openListener(()=>assert.fail('fixture receiver did not open a Worker channel')));
 listener.on('error',reject);const ready=once(listener,'listening');listener.listen(path);await ready;
 await units.stop('alice',incarnation);assert.equal(bound.alive(),false);assert.equal(bound.inScope(rows[0].witness),false);assert.equal(runtime.confirmDead('resident:alice'),true);assert.deepEqual(ExecutionJournal.inspect(root),[]);
 assert.equal(store.getAgent('alice').incarnation,incarnation,'physical endpoint preparation cannot advance current Run authority');
});
