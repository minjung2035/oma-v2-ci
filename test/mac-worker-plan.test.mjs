/** Exercise the actual App Mac sandbox port with the shared Pi planner.
 * No OS identity or syscall result is replaced. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {residentOptions} from '../dist/test/fixtures/resident.js';
import {planPiSpawn} from '@oma/engine/pi-spawn-plan';
import {describeMacDeveloperTools} from '@oma/protocol/mac-developer-tools';
import {macResidentSandbox,createResidentEngineEffects,residentEngineEffects} from '#oma-test/app/engine/resident-effects';
const developer='/Applications/한 글자 Xcode.app/Contents/Developer';
const tools=describeMacDeveloperTools(developer,`${developer}/usr/bin/git`,`${developer}/usr/libexec/git-core`);
function fixture(){
  const libdir='/opt/한 글자 oma',options=residentOptions('/private/var/oma-state',libdir);
  options.confinement.host.pi=join(libdir,'engine.js');options.confinement.host.packages='/opt/oma-packages';
  options.confinement.inference={socketHostPath:'/private/var/relay.sock',provider:'fixture',model:'model',placeholder:'relay-placeholder'};
  options.confinement.egress={socketHostPath:'/private/var/egress.sock'};
  return {libdir,options};
}
test('Mac Worker shared Pi plan retains physical CLI, session, package, relay and egress paths',()=>{
  const {libdir,options}=fixture(),sandbox=macResidentSandbox(tools),plan=planPiSpawn(sandbox,options),dirs=options.confinement.directories;
  assert.equal(plan.args[1],options.confinement.host.pi);
  assert.equal(plan.args[plan.args.indexOf('--session-dir')+1],dirs.sessions);
  assert.equal(plan.args[plan.args.indexOf('-e')+1],options.paths.coreExtension);
  assert.equal(plan.env.OMA_CLI,join(libdir,'apps/oma/dist/cli.js'));
  assert.equal(plan.env.OMA_INFERENCE_SOCKET,options.confinement.inference.socketHostPath);
  assert.equal(plan.env.OMA_EGRESS_PROXY_SOCKET,options.confinement.egress.socketHostPath);
  assert.equal(plan.env.OMA_PACKAGE_STORE,options.confinement.host.packages);
  assert.equal(plan.env.OMA_BATCH_VIEW,dirs.view);assert.equal(plan.env.OMA_AGENT_HOME,dirs.home);
  assert.equal(plan.env.OMA_INFERENCE_KEY,'relay-placeholder');assert.equal(plan.env.OMA_TOOL_SCOPE,'sandbox');
  assert.equal(plan.env.GIT_EXEC_PATH,tools.execPath);
  assert.ok(plan.env.PATH.split(':').includes(`${developer}/usr/bin`));
  assert.ok(plan.env.PATH.split(':').includes(`${developer}/Toolchains/XcodeDefault.xctoolchain/usr/bin`));
  assert.equal(plan.privateInputs.length,1);assert.equal(plan.privateInputs[0].fd,3);
  const profile=Buffer.from(plan.privateInputs[0].bytes).subarray(16).toString();
  assert.ok(profile.includes(`(allow file-read* (subpath ${JSON.stringify(tools.contents)}))`));
  assert.ok(!profile.includes(`(allow file-write* (subpath ${JSON.stringify(tools.contents)}))`));
  assert.ok(!profile.includes('(subpath "/Applications")'));
  assert.ok(!plan.args.includes('/workspace'));assert.ok(!plan.args.includes('/opt/oma'));
  assert.equal(sandbox.pathView(options.confinement.host,options.confinement.lease,dirs)
    .sessionPathToHost(join(dirs.sessions,'session.jsonl')),join(dirs.sessions,'session.jsonl'));
});
test('Mac Worker App port refuses missing tools and snapshots the observed installation',()=>{
  const {options}=fixture();
  assert.throws(()=>planPiSpawn(macResidentSandbox(undefined),options),{code:'UNSUPPORTED_PROFILE'});
  const changing={...tools},sandbox=macResidentSandbox(changing);changing.git='/human/git';changing.execPath='/human/helpers';
  const plan=planPiSpawn(sandbox,options);assert.equal(plan.env.GIT_EXEC_PATH,tools.execPath);
  assert.ok(!Buffer.from(plan.privateInputs[0].bytes).subarray(16).toString().includes('/human/'));
});
test('Mac Worker App port refuses selected developer roots overlapping writable actor state',()=>{
  const {options}=fixture(),dev=join(options.confinement.directories.workspace,'Xcode.app/Contents/Developer');
  const overlapping=describeMacDeveloperTools(dev,`${dev}/usr/bin/git`,`${dev}/usr/libexec/git-core`);
  assert.throws(()=>planPiSpawn(macResidentSandbox(overlapping),options),{code:'UNSUPPORTED_PROFILE'});
});
if(process.platform==='linux')test('Linux Worker composition refuses a Mac installation launch',()=>{
  assert.throws(()=>createResidentEngineEffects(tools),{code:'UNSUPPORTED_PROFILE'});
});
if(process.platform==='darwin')test('Mac Worker product composition refuses spawn while native gates remain open',()=>{
  assert.throws(()=>residentEngineEffects.sandbox.spawn({command:'/must-not-execute',args:[],cwd:'/tmp',env:{},
    privateInputs:[{fd:3,bytes:Buffer.from('not an approved live scope')}]}),{code:'UNSUPPORTED_PROFILE'});
});
