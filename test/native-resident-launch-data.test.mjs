/** App launch composition over actual Linux namespace/pidfd/control effects.
 * The receiver is a fixture program, not the product Runner or a Mac scope.
 * No process identity, ownership observation or kernel result is replaced. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {Store} from '@oma/storage';
import {ExecutionJournal} from '@oma/storage/execution-journal';
import {ExecutionRuntime} from '#oma-test/app/runtime/execution-runtime';
import {createNativeResidents} from '#oma-test/app/runtime/native-residents';
import {defaultHostConfig} from '@oma/config/defaults';
import {describeMacDeveloperTools,decodeMacDeveloperToolsHex} from '@oma/protocol/mac-developer-tools';
import {withAsyncCleanup} from '@oma/native/cleanup';
import {makeValidAgent} from '../dist/test/fixtures/spec.js';
assert.equal(process.platform,'linux','launch data tests use the actual Linux backend');
const developer='/Applications/한 글자 Xcode.app/Contents/Developer';
const observed=describeMacDeveloperTools(developer,`${developer}/usr/bin/git`,`${developer}/usr/libexec/git-core`);
for(const explicit of [false,true])test(`native launch data: ${explicit?'explicit observed tools replace ambient data':'ambient tools are absent without explicit launch data'}`,{timeout:20000},async t=>{
  const root=mkdtempSync(join(tmpdir(),'oma-launch-data-'));ExecutionJournal.initialize(root);
  const executions=new ExecutionRuntime(root);await executions.recover();
  const store=new Store(join(root,'runtime.sqlite'));store.transaction(tx=>tx.insertAgent(makeValidAgent()));
  const libdir=join(root,'installation'),entry=join(libdir,'apps/oma/dist/entry/runner.js');mkdirSync(dirname(entry),{recursive:true});
  writeFileSync(entry,`import {Socket} from 'node:net';
    const socket=new Socket({fd:6,readable:true,writable:true});socket.on('error',()=>{});
    socket.write(JSON.stringify({present:Object.hasOwn(process.env,'OMA_DEVELOPER_TOOLS_HEX'),
      tools:process.env.OMA_DEVELOPER_TOOLS_HEX??null,profile:process.env.OMA_PROFILE_HEX,model:process.env.OMA_MODEL_PROFILE_HEX})+'\\n');
    setInterval(()=>{},1000);`);
  const config=defaultHostConfig({society:'demo',node:process.execPath,libdir,deploymentDigest:'a'.repeat(64)});
  config.agentProfiles.p=config.agentProfiles.resident;config.modelProfiles.md=config.modelProfiles.worker;
  const environment={PATH:process.env.PATH,OMA_DEVELOPER_TOOLS_HEX:'ambient-forged',OMA_PROFILE_HEX:'ambient-profile'},changing={...observed};
  let answer,fail;const received=new Promise((resolve,reject)=>{answer=resolve;fail=reject;});
  let peer,timer,toolsReads=0;
  const launch={environment};
  if(explicit)Object.defineProperty(launch,"developerTools",{get(){toolsReads++;return changing;}});
  const units=createNativeResidents(store,executions,{stateRoot:root,runRoot:join(root,'run'),society:'demo',configPath:join(root,'config.json')},
    config,(socket,bound)=>{
      peer=bound;assert.equal(bound.alive(),true);assert.equal(bound.uid,process.getuid());assert.equal(bound.inheritedRunner.actor,'alice');
      let line='';socket.on('data',bytes=>{line+=bytes;if(line.includes('\n'))answer(JSON.parse(line.slice(0,line.indexOf('\n'))));});
      socket.on('error',fail);socket.resume();
    },()=>{},actor=>store.getAgent(actor)?.incarnation??null,launch);
  t.after(async()=>{clearTimeout(timer);await withAsyncCleanup(()=>units.close(),()=>executions.close());store.close();rmSync(root,{recursive:true,force:true});});
  changing.git='/human/replaced-git';changing.execPath='/human/replaced-helpers';environment.OMA_DEVELOPER_TOOLS_HEX='ambient-later';
  timer=setTimeout(()=>fail(new Error('actual inherited receiver did not report its launch environment')),10000);
  await units.start('alice',false);const value=await received;clearTimeout(timer);
  const entries=ExecutionJournal.inspect(root);assert.equal(entries.length,1);assert.equal(entries[0].slot,'resident:alice');
  assert.ok(entries[0].witness.pid>1);assert.equal(units.scopeRoot('alice').pid,entries[0].witness.pid);
  assert.equal(value.present,explicit);assert.equal(toolsReads,explicit?1:0);
  if(explicit)assert.deepEqual(decodeMacDeveloperToolsHex(value.tools),observed);else assert.equal(value.tools,null);
  assert.equal(Buffer.from(value.profile,'hex').toString(),'p');assert.equal(Buffer.from(value.model,'hex').toString(),'md');
  await units.stop('alice',1);assert.equal(executions.confirmDead('resident:alice'),true);assert.equal(peer.alive(),false);
  assert.deepEqual(ExecutionJournal.inspect(root),[]);
});
