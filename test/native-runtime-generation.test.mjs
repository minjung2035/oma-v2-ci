/** Whole installed payload, private Node and the actual scope owner. This is
 * independent of product Actor admission and startup/orphan recovery. */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMacRuntimeGeneration } from "#oma-test/app/runtime/mac-runtime-generation";
import { deploymentDigest } from "#oma-test/app/runtime/deployment-manifest";
import { ExecutionCoordinator } from "@oma/process/owned-execution";
import { copyInstalledProduct } from "../dist/test/fixtures/installation.js";

test("001. Actual installed generation seals dependencies and private Node until its complete scope returns", { timeout: 240000 }, async t => {
  if (process.platform !== "darwin") {
    assert.throws(() => createMacRuntimeGeneration({ libdir: "/unused", node: process.execPath, deploymentDigest: "0".repeat(64) }, "/unused"),
      { code: "UNSUPPORTED_PROFILE" }); return;
  }
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oma-runtime-generation-"))), source = join(root, "source"), work = join(root, "work");
  let previous = performance.now();
  const phase = name => { const now = performance.now(); t.diagnostic(JSON.stringify({ phase: name, elapsedMs: now - previous })); previous = now; };
  mkdirSync(work, { mode: 0o700 });
  let generation, owner; const rows = [];
  t.after(async () => { await owner?.drain(); generation?.close(); rmSync(root, { recursive: true }); });
  copyInstalledProduct(realpathSync(fileURLToPath(new URL("../", import.meta.url))), source);
  phase("fixture-installation");
  const entry = join(source, "apps/oma/dist/generation-probe.mjs");
  writeFileSync(entry, `import assert from 'node:assert/strict';
import {closeSync,openSync,readFileSync,linkSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {darwinOwnedEntryFlags,setDarwinUserImmutable} from '@oma/native/darwin-file-flags';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const paths=[process.execPath,root+'packages/native/dist/darwin-file-flags.js',root+'node_modules/koffi/index.js',root];
for(const path of paths){const fd=openSync(path,'r');try{
 assert.equal(darwinOwnedEntryFlags(fd)&2,2);assert.throws(()=>setDarwinUserImmutable(fd,false),{code:'EPERM'});
}finally{closeSync(fd)}}
assert.throws(()=>openSync(paths[2],'r+'),{code:'EPERM'});
assert.throws(()=>linkSync(paths[2],process.env.HOME+'/code-alias'),{code:'EPERM'});
const require=createRequire(import.meta.url);assert.ok(require.resolve('koffi').startsWith(root));
assert.equal(readFileSync(process.env.HOME+'/.node_modules/oma-generation-escape/index.js','utf8'),'module.exports="forbidden"');
assert.throws(()=>require('oma-generation-escape'),{code:'MODULE_NOT_FOUND'});
const child=spawnSync('node',['--no-global-search-paths','--version'],{encoding:'utf8'});
assert.equal(child.error,undefined);assert.equal(child.status,0,child.stderr);assert.equal(child.stdout.trim(),process.version);
writeFileSync(process.env.HOME+'/control','ordinary write');
console.log(JSON.stringify({sealedEntries:paths.length,globalFallbackRefused:true,privateDependency:true,privateNodeCommand:true,control:true}));
`);
  const fallback = join(work, ".node_modules/oma-generation-escape"); mkdirSync(fallback, { recursive: true });
  writeFileSync(join(fallback, "index.js"), 'module.exports="forbidden"');
  const installation = { libdir: source, node: realpathSync(process.execPath), deploymentDigest: deploymentDigest(source) };
  phase("source-digest");
  generation = createMacRuntimeGeneration(installation, root);
  phase("generation-construction");
  const command = { executable: installation.node, argv: [entry], env: { HOME: work, TMPDIR: work, PATH: dirname(generation.node) + ":/usr/bin:/bin" }, cwd: work,
    timeoutMs: 30000, stdoutBytes: 4096, stderrBytes: 8192 };
  const policy = { readable: [], writable: [{ path: work, kind: "directory" }], denied: [], executable: [],
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
  let prematureReturn;
  const result = await owner.run({ slot: "generation", async launch() {
    const scope = await generation.launchNode(command, {}, policy);
    try { generation.close(); } catch (error) { prematureReturn = error; }
    return scope;
  }, authorize() {} });
  phase("scope-execution-and-return");
  assert.equal(prematureReturn?.code, "RUN_TERMINATION_UNKNOWN");
  assert.equal(result.kind, "exited", result.stderr.toString()); assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.deepEqual(JSON.parse(result.stdout), { sealedEntries: 4, globalFallbackRefused: true, privateDependency: true, privateNodeCommand: true, control: true });
  assert.equal(existsSync(join(work, "control")), true); assert.equal(existsSync(join(work, "code-alias")), false);
  assert.deepEqual(rows, []); assert.equal(deploymentDigest(source), installation.deploymentDigest);
  generation.close(); assert.equal(existsSync(generation.root), false);
  phase("generation-collection");
  generation.close(); assert.equal(existsSync(generation.root), false);
  assert.equal(deploymentDigest(source), installation.deploymentDigest);
});
