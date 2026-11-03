import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { spawnReferencesFence } from '../scripts/architecture/rules/fence-rules.mjs';

function inspect(expression) {
  const source = ts.createSourceFile('case.ts', expression, ts.ScriptTarget.Latest, true);
  return spawnReferencesFence(source.statements[0].expression);
}
for (const expression of [
  `spawn('defence-tool', ['fence'], {stdio: [0,1,2]})`,
  `spawn('node', [], {label: 'fence', fence: undefined})`,
  `spawnWithPrivateInputs(node, argv, {note: 'fence'})`,
  `spawn(node, argv, {stdio: fencedStdio([0,1,2])})`,
  `spawn(node, argv, {/* fence */ stdio: [0,1,2]})`,
]) test(`001. No propagation proof from ${expression}`, () => assert.equal(inspect(expression), false));
for (const expression of [
  'spawn(node, argv, {stdio: [0,1,2,fence]})',
  'spawn(node, argv, {stdio: fencedStdio([0,1,2], run.fence)})',
  'spawnOwnedRpc(node, argv, env, fence)',
]) test(`002. Fence value references count in ${expression}`, () => assert.equal(inspect(expression), true));

for (const method of ['spawnSync', 'execFileSync', 'fork'])
  test(`003. Remaining gate regressions: ${method} descendants with explicit env:{} retain the local test guard`, () => {
    const guard = new URL('../scripts/local-test-guard.mjs', import.meta.url).href;
    const nested = `import {spawnSync} from 'node:child_process';\ntry { spawnSync('systemctl',['--version']); console.error('ESCAPED'); process.exitCode=9; } catch(e) { if(!String(e).includes('BLOCKED')) throw e; console.log('BLOCKED'); }`;
    const parent = `import cp from 'node:child_process'; const args=['--input-type=module','-e',${JSON.stringify(nested)}];\n` +
      (method === 'spawnSync' ? `const r=cp.spawnSync(process.execPath,args,{env:{},encoding:'utf8'}); process.stdout.write(r.stdout); process.stderr.write(r.stderr); process.exitCode=r.status ?? 8;`
        : method === 'execFileSync' ? `process.stdout.write(cp.execFileSync(process.execPath,args,{env:{},encoding:'utf8'}));`
          : `const c=cp.fork('-e',[${JSON.stringify(nested)}],{execArgv:['--input-type=module'],env:{},silent:true}); c.stdout.pipe(process.stdout); c.stderr.pipe(process.stderr); c.once('exit',code=>{process.exitCode=code ?? 8;});`);
    const result = spawnSync(process.execPath, [`--import=${guard}`, '--input-type=module', '-e', parent], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'BLOCKED');
  });


for (const method of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'fork'])
  test(`004. Remaining gate regressions: ${method} direct Node descendants preserve the declared environment and still refuse shell/manager execution`, () => {
    const guard = new URL('../scripts/local-test-guard.mjs', import.meta.url).href;
    const nested = `import assert from 'node:assert/strict'; import {spawnSync} from 'node:child_process';
      assert.throws(()=>spawnSync('systemctl',['--version']), /BLOCKED/);
      assert.throws(()=>spawnSync('/bin/sh',['-c','echo forbidden']), /BLOCKED/);
      assert.equal(Object.hasOwn(process.env,'NODE_OPTIONS'),false,'the backstop must not forge an environment-policy violation');
      assert.equal(process.env.DECLARED,'keep'); console.log('GUARDED_ARGV');`;
    const parent = `import cp from 'node:child_process'; const args=['--input-type=module','-e',${JSON.stringify(nested)}]; const options={env:{DECLARED:'keep'},encoding:'utf8'};\n` +
      (method === 'spawnSync' ? `const r=cp.spawnSync(process.execPath,args,options); process.stdout.write(r.stdout); process.stderr.write(r.stderr); process.exitCode=r.status ?? 8;`
        : method === 'execFileSync' ? `process.stdout.write(cp.execFileSync(process.execPath,args,options));`
          : method === 'execFile' ? `cp.execFile(process.execPath,args,options,(error,stdout,stderr)=>{process.stdout.write(stdout);process.stderr.write(stderr);process.exitCode=error?8:0;});`
            : method === 'spawn' ? `const c=cp.spawn(process.execPath,args,options); c.stdout.pipe(process.stdout);c.stderr.pipe(process.stderr);c.once('exit',code=>{process.exitCode=code ?? 8;});`
              : `const c=cp.fork('-e',[${JSON.stringify(nested)}],{execArgv:['--input-type=module'],env:{DECLARED:'keep'},silent:true});c.stdout.pipe(process.stdout);c.stderr.pipe(process.stderr);c.once('exit',code=>{process.exitCode=code ?? 8;});`);
    const result = spawnSync(process.execPath, [`--import=${guard}`, '--input-type=module', '-e', parent], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'GUARDED_ARGV');
  });

test("005. Direct Node propagation preserves unrelated caller NODE_OPTIONS exactly", () => {
  const guard = new URL('../scripts/local-test-guard.mjs', import.meta.url).href;
  const nested = `import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
    assert.equal(process.env.NODE_OPTIONS,'--no-warnings');assert.throws(()=>spawnSync('systemctl',['--version']), /BLOCKED/);console.log('PRESERVED');`;
  const parent = `import {execFileSync} from 'node:child_process';process.stdout.write(execFileSync(process.execPath,['--input-type=module','-e',${JSON.stringify(nested)}],{env:{NODE_OPTIONS:'--no-warnings'},encoding:'utf8'}));`;
  const result = spawnSync(process.execPath, [`--import=${guard}`, '--input-type=module', '-e', parent], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'PRESERVED');
});
