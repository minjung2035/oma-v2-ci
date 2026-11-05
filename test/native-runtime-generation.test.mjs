/** Whole installed payload, private Node and the actual scope owner. This is
 * independent of product Actor admission and startup/orphan recovery. */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync, readFileSync, symlinkSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { createMacRuntimeGeneration, prepareMacRuntimeGeneration } from "#oma-test/app/runtime/mac-runtime-generation";
import { deploymentDigest } from "#oma-test/app/runtime/deployment-manifest";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
import { bundledJobHelper } from "@oma/platform-mac/job-launch";
import { bundledSeatbeltHelper } from "@oma/platform-mac/seatbelt";
import { ExecutionCoordinator } from "@oma/process/owned-execution";
import { copyInstalledProduct } from "../dist/test/fixtures/installation.js";
import { verifyDarwinGitRuntime } from "./fixtures/darwin-private-git.mjs";
import { ExecutionJournal } from "@oma/storage/execution-journal";
import { launchDarwinJobScope } from "@oma/platform-mac/job-scope";
import { withAsyncCleanup } from "@oma/native/cleanup";
import { ExecutionRuntime } from "#oma-test/app/runtime/execution-runtime";
import { withProtectedMacNode } from "#oma-test/app/runtime/mac-protected-node";

test("001. Actual installed generation seals dependencies and private Node until its complete scope returns", { timeout: 240000 }, async t => {
  if (process.platform !== "darwin") {
    assert.throws(() => createMacRuntimeGeneration({ libdir: "/unused", node: process.execPath, deploymentDigest: "0".repeat(64) }, "/unused"),
      { code: "UNSUPPORTED_PROFILE" }); return;
  }
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oma-runtime-generation-"))), source = join(root, "source"), work = join(root, "work");
  let previous = performance.now();
  const phase = name => { const now = performance.now(); t.diagnostic(JSON.stringify({ phase: name, elapsedMs: now - previous })); previous = now; };
  mkdirSync(work, { mode: 0o700 });
  let generation, owner, pin, heartbeat, preparing, selectedScope; const stopPreparation = new AbortController(); let ticks = 0; const rows = [];
  t.after(async () => { clearInterval(heartbeat); stopPreparation.abort();
    if (preparing) await preparing.then(value => { generation ??= value; }, error => { if (error?.code !== "CANCELLED_BEFORE_COMMIT") throw error; });
    await owner?.drain(); pin?.close(); generation?.close(); rmSync(root, { recursive: true }); });
  try {
  copyInstalledProduct(realpathSync(fileURLToPath(new URL("../", import.meta.url))), source);
  phase("fixture-installation");
  const entry = join(source, "apps/oma/dist/generation-probe.mjs");
  writeFileSync(entry, `import assert from 'node:assert/strict';
import {closeSync,openSync,readFileSync,linkSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {darwinOwnedEntryFlags,setDarwinUserImmutable} from '@oma/native/darwin-file-flags';
import {protectPipelineSupervisor} from '@oma/native/control-socket';
protectPipelineSupervisor();
const root=fileURLToPath(new URL('../../../',import.meta.url));
const paths=[process.execPath,root+'packages/native/dist/darwin-file-flags.js',root+'node_modules/koffi/index.js',root];
for(const path of paths){const fd=openSync(path,'r');try{
 assert.equal(darwinOwnedEntryFlags(fd)&2,2);assert.throws(()=>setDarwinUserImmutable(fd,false),{code:'EPERM'});
}finally{closeSync(fd)}}
assert.throws(()=>openSync(paths[2],'r+'),{code:'EPERM'});
assert.throws(()=>linkSync(paths[2],process.env.HOME+'/code-alias'),{code:'EPERM'});
const require=createRequire(import.meta.url);assert.ok(require.resolve('koffi').startsWith(root));
assert.throws(()=>readFileSync(${JSON.stringify(entry)},'utf8'),e=>['EPERM','EACCES'].includes(e.code));
assert.equal(readFileSync(process.env.HOME+'/.node_modules/oma-generation-escape/index.js','utf8'),'module.exports="forbidden"');
assert.throws(()=>require('oma-generation-escape'),{code:'MODULE_NOT_FOUND'});
const child=spawnSync('node',['--no-global-search-paths','--version'],{encoding:'utf8'});
assert.equal(child.error,undefined);assert.equal(child.status,0,child.stderr);assert.equal(child.stdout.trim(),process.version);
writeFileSync(process.env.HOME+'/control','ordinary write');
console.log(JSON.stringify({pid:process.pid,sealedEntries:paths.length,globalFallbackRefused:true,privateDependency:true,privateNodeCommand:true,control:true}));
`);
  const fallback = join(work, ".node_modules/oma-generation-escape"); mkdirSync(fallback, { recursive: true });
  writeFileSync(join(fallback, "index.js"), 'module.exports="forbidden"');
  const installation = { libdir: source, node: realpathSync(process.execPath), deploymentDigest: deploymentDigest(source) };
  phase("source-digest");
  heartbeat = setInterval(() => ticks++, 1);
  ExecutionJournal.initialize(root);const preparationOwner=new ExecutionRuntime(root,launchDarwinJobScope);
  const preparationSignal=AbortSignal.any([stopPreparation.signal,t.signal]);
  preparing = withAsyncCleanup(async()=>{
    await preparationOwner.recover();
    return withProtectedMacNode(installation.node,root,preparationOwner,preparationSignal,()=>{},
      node=>{phase('protected-node-preparation');return prepareMacRuntimeGeneration(installation,root,preparationSignal,node);});
  },()=>preparationOwner.close());
  generation = await preparing;
  assert.ok(ticks > 0, "preparation must service the event loop while building the actual whole installation");
  phase("generation-construction");
  const command = { executable: installation.node, argv: [entry], env: { HOME: work, TMPDIR: work, PATH: dirname(generation.node) + ":/usr/bin:/bin" }, cwd: work,
    timeoutMs: 30000, stdoutBytes: 4096, stderrBytes: 8192 };
  const policy = { readable: [{ path: source, kind: "directory" }], writable: [{ path: work, kind: "directory" }], denied: [], executable: [],
    unixSockets: [], machServices: [], environmentKeys: ["HOME", "TMPDIR", "PATH"] };
  owner = new ExecutionCoordinator({ entries: () => rows.map(row => ({ ...row })), reserve(slot) {
    const row = { slot, execution: "probe", witness: null }; rows.push(row);
    return { execution: row.execution, publish(witness) { row.witness = witness; }, retire() { rows.splice(rows.indexOf(row), 1); } };
  }, retire() { throw new Error("unexpected recovery"); } }, () => ({ kind: "unavailable" }));
  const refuse = async (input, policyInput) => {
    await assert.rejects(owner.run({ slot: "invalid-generation", launch: () => generation.launchNode(input, {}, policyInput),
      authorize() { throw new Error("invalid generation input reached release"); } }), { code: "UNSUPPORTED_PROFILE" });
    assert.deepEqual(rows, []);
  };
  for (const invalid of [{ ...command, argv: ["--eval", "forbidden"] }, { ...command, env: { ...command.env, NODE_OPTIONS: "--eval=forbidden" } }])
    await refuse(invalid, policy);
  await refuse(command, { ...policy, writable: [{ path: root, kind: "directory" }] });
  await refuse(command, { ...policy, readable: [{ path: source, kind: "directory" }], nodePreload: entry });
  await refuse(command, { ...policy, readable: [{ path: source + "/../work", kind: "directory" }] });
  let prematureReturn;
  const result = await owner.run({ slot: "generation", signal: t.signal, async launch() {
    const scope = selectedScope = await generation.launchNode(command, { imageDigests: { helper: "0".repeat(64), images: [] } }, policy);
    try { generation.close(); } catch (error) { prematureReturn = error; }
    await assert.rejects(generation.closeAsync(), { code: "RUN_TERMINATION_UNKNOWN" });
    return scope;
  }, authorize() { pin = selectedScope.pinChild(); assert.equal(pin.alive(), true); } });
  phase("scope-execution-and-return");
  assert.equal(prematureReturn?.code, "RUN_TERMINATION_UNKNOWN");
  assert.equal(result.kind, "exited", result.stderr.toString()); assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.deepEqual(JSON.parse(result.stdout), { pid: pin.pid, sealedEntries: 4, globalFallbackRefused: true, privateDependency: true, privateNodeCommand: true, control: true });
  assert.equal(pin.alive(), false); pin.close();
  assert.equal(existsSync(join(work, "control")), true); assert.equal(existsSync(join(work, "code-alias")), false);
  assert.deepEqual(rows, []); assert.equal(deploymentDigest(source), installation.deploymentDigest);
  await verifyDarwinGitRuntime(generation, installation, join(work, "git"), t.signal);
  phase("private-git-candidate-and-quarantine");
  const beforeClose = ticks; await generation.closeAsync(); assert.ok(ticks > beforeClose); assert.equal(existsSync(generation.root), false);
  phase("generation-collection");
  generation.close(); assert.equal(existsSync(generation.root), false);
  assert.equal(deploymentDigest(source), installation.deploymentDigest);
  } catch (error) {
    const observation = read => { try { return read(); } catch (failure) { return { unobserved: inspect(failure, { depth: null }) }; } };
    // Serialize here, before the test worker's Error clone truncates nested
    // AggregateError members. An observation never replaces the failure.
    t.diagnostic(JSON.stringify({ phase: "whole-generation-failure", error: inspect(error, { depth: null, maxArrayLength: null }),
      population: observation(() => selectedScope?.population()), journal: rows,
      preparationJournal: observation(() => ExecutionJournal.inspect(root)) }));
    throw error;
  }
});

for (const mismatch of ['helper','seatbelt']) test(`002. Generation refuses the Host ${mismatch} image when its bytes differ from the trusted installation`, {timeout:60000}, async t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-generation-helper-binding-'))),source=join(root,'source'),rows=[];
 let generation,owner;t.after(async()=>{await owner?.drain();generation?.close();rmSync(root,{recursive:true});});
 mkdirSync(join(source,'node_modules/@oma'),{recursive:true});const packages={'':{name:'binding-fixture'}};
 for(const workspace of DEPLOYMENT_LAYOUT.workspaces){
  mkdirSync(join(source,workspace.root,'dist'),{recursive:true});
  writeFileSync(join(source,workspace.root,'package.json'),JSON.stringify({name:workspace.name,version:'0.1.0',type:'module',exports:{'.':'./dist/index.js'}}));
  writeFileSync(join(source,workspace.root,'dist/index.js'),'export {};\n');
  symlinkSync(join(source,workspace.root),join(source,'node_modules',workspace.name));
  packages['node_modules/'+workspace.name]={resolved:workspace.root,link:true};
 }
 writeFileSync(join(source,'package.json'),JSON.stringify({name:'binding-fixture',type:'module'}));
 writeFileSync(join(source,'package-lock.json'),JSON.stringify({lockfileVersion:3,packages}));
 writeFileSync(join(source,DEPLOYMENT_LAYOUT.schema),'fixture bytes');
 for(const [kind,path,actual] of [['helper','job-helper/oma-job-helper',bundledJobHelper()],['seatbelt','seatbelt/oma-seatbelt',bundledSeatbeltHelper()]]){
  const file=join(source,'packages/native/dist',path);mkdirSync(dirname(file),{recursive:true});
  writeFileSync(file,kind===mismatch||process.platform!=='darwin'?Buffer.from('different trusted fixture bytes'):readFileSync(actual),{mode:0o500});
 }
 const entry=join(source,'apps/oma/dist/binding-probe.mjs');writeFileSync(entry,"throw Error('must not execute')");
 const installation={libdir:source,node:realpathSync(process.execPath),deploymentDigest:deploymentDigest(source)};
 if(process.platform!=='darwin')return assert.throws(()=>createMacRuntimeGeneration(installation,root),{code:'UNSUPPORTED_PROFILE'});
 if(mismatch==='helper'){
  const cancellation=new AbortController();let observedPartial=false;
  const watch=setInterval(()=>{if(readdirSync(root).some(name=>name.startsWith('.oma-runtime-'))){observedPartial=true;cancellation.abort();}},1);
  try{await assert.rejects(prepareMacRuntimeGeneration(installation,root,cancellation.signal),{code:'CANCELLED_BEFORE_COMMIT'});}
  finally{clearInterval(watch);}
  assert.equal(observedPartial,true);assert.deepEqual(readdirSync(root).filter(name=>name.startsWith('.oma-runtime-')),[]);
  assert.equal(deploymentDigest(source),installation.deploymentDigest);
 }
 generation=createMacRuntimeGeneration(installation,root);
 owner=new ExecutionCoordinator({entries:()=>rows.map(row=>({...row})),reserve(slot){const row={slot,execution:'binding',witness:null};rows.push(row);
  return {execution:row.execution,publish(witness){row.witness=witness;},retire(){rows.splice(rows.indexOf(row),1);}};},retire(){throw Error('unexpected recovery');}},()=>({kind:'unavailable'}));
 const command={executable:installation.node,argv:[entry],env:{HOME:root,TMPDIR:root},cwd:root,timeoutMs:10000,stdoutBytes:64,stderrBytes:1024};
 const policy=mismatch==='helper'?undefined:{readable:[],writable:[],denied:[],executable:[{path:installation.node,kind:'file'}],unixSockets:[],machServices:[],environmentKeys:['HOME','TMPDIR']};
 await assert.rejects(owner.run({slot:'helper-binding',launch:()=>generation.launchNode(command,{},policy),authorize(){assert.fail('unbound helper reached authority');}}),{code:'UNSUPPORTED_PROFILE'});
 assert.deepEqual(rows,[]);generation.close();assert.equal(existsSync(generation.root),false);
 assert.equal(deploymentDigest(source),installation.deploymentDigest);
});
