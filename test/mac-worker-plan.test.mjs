/** Exercise the actual App Mac sandbox port with the shared Pi planner.
 * No OS identity or syscall result is replaced. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DEPLOYMENT_LAYOUT} from '@oma/domain/deployment';
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
test("001. Mac Worker shared Pi plan retains physical session, package, relay and egress paths without a model CLI",()=>{
  const {options}=fixture(),sandbox=macResidentSandbox(tools),plan=planPiSpawn(sandbox,options),dirs=options.confinement.directories;
  assert.equal(plan.args[1],"--no-global-search-paths");assert.equal(plan.args[2],options.confinement.host.pi);
  assert.equal(plan.args[plan.args.indexOf('--session-dir')+1],dirs.sessions);
  assert.equal(plan.args[plan.args.indexOf('-e')+1],options.paths.coreExtension);
  assert.equal(plan.env.OMA_CLI,undefined);
  assert.equal(plan.env.OMA_INFERENCE_SOCKET,options.confinement.inference.socketHostPath);
  assert.equal(plan.env.OMA_EGRESS_PROXY_SOCKET,options.confinement.egress.socketHostPath);
  assert.equal(plan.env.OMA_PACKAGE_STORE,options.confinement.host.packages);
  assert.equal(plan.env.OMA_BATCH_VIEW,dirs.view);assert.equal(plan.env.OMA_AGENT_HOME,dirs.home);
  assert.equal(plan.env.OMA_INFERENCE_KEY,'relay-placeholder');assert.equal(plan.env.OMA_TOOL_SCOPE,'sandbox');
  assert.equal(plan.env.GIT_EXEC_PATH,tools.execPath);
  assert.equal(plan.env.DEVELOPER_DIR,tools.developer);
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
test("002. Mac Worker App port refuses missing tools and snapshots the observed installation",()=>{
  const {options}=fixture();
  assert.throws(()=>planPiSpawn(macResidentSandbox(undefined),options),{code:'UNSUPPORTED_PROFILE'});
  const changing={...tools},sandbox=macResidentSandbox(changing);changing.git='/human/git';changing.execPath='/human/helpers';
  const plan=planPiSpawn(sandbox,options);assert.equal(plan.env.GIT_EXEC_PATH,tools.execPath);
  assert.equal(plan.env.DEVELOPER_DIR,tools.developer);
  assert.ok(!Buffer.from(plan.privateInputs[0].bytes).subarray(16).toString().includes('/human/'));
});
test("003. Mac Worker App port refuses selected developer roots overlapping writable actor state",()=>{
  const {options}=fixture(),dev=join(options.confinement.directories.workspace,'Xcode.app/Contents/Developer');
  const overlapping=describeMacDeveloperTools(dev,`${dev}/usr/bin/git`,`${dev}/usr/libexec/git-core`);
  assert.throws(()=>planPiSpawn(macResidentSandbox(overlapping),options),{code:'UNSUPPORTED_PROFILE'});
});
if(process.platform==='linux')test("004. Linux Worker composition refuses a Mac installation launch",()=>{
  assert.throws(()=>createResidentEngineEffects(tools),{code:'UNSUPPORTED_PROFILE'});
});
if(process.platform==='darwin')test("005. Mac Worker product composition refuses a spawn with no private profile owner",()=>{
  assert.throws(()=>residentEngineEffects.sandbox.spawn({command:'/must-not-execute',args:[],cwd:'/tmp',env:{}}),{code:'UNSUPPORTED_PROFILE'});
});

test("003. Private Node keeps the selected distribution's package managers and fixed preload",()=>{
  const {options}=fixture(),host=options.confinement.host;
  host.node='/private/oma-runtime/.oma-node-bin/node';host.toolchainNode='/opt/selected-node/bin/node';
  const plan=planPiSpawn(macResidentSandbox(tools),options),profile=Buffer.from(plan.privateInputs[0].bytes).subarray(16).toString();
  const path=plan.env.PATH.split(':');assert.equal(path[0],'/private/oma-runtime/.oma-node-bin');
  assert.equal(path[1],'/opt/selected-node/bin');assert.ok(path.indexOf(options.confinement.directories.home+'/.local/bin')>1);
  for(const tool of ['npm','npx','corepack'])assert.ok(profile.includes(JSON.stringify('/opt/selected-node/bin/'+tool)));
  assert.ok(profile.includes(JSON.stringify('/opt/selected-node/lib/node_modules/npm')));
  assert.ok(!profile.includes('(subpath "/opt/selected-node/bin")'));
  assert.equal(plan.env.NODE_OPTIONS,`--import=${pathToFileURL(join(host.libdir,DEPLOYMENT_LAYOUT.clientPreload)).href}`);
  host.toolchainNode=join(host.stateRoot,'agents','alice','home','bin','node');
  assert.throws(()=>planPiSpawn(macResidentSandbox(tools),options),{code:'UNSUPPORTED_PROFILE'});
  host.toolchainNode='relative-node';assert.throws(()=>planPiSpawn(macResidentSandbox(tools),options),{code:'UNSUPPORTED_PROFILE'});
});
