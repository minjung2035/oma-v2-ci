import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { join } from "node:path";
import ts from "typescript";

const source = readFileSync(new URL('../scripts/verify-lane.mjs', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('verify-lane.mjs', source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
const declaration = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'packageScript');
assert.ok(declaration);
function runner(scripts, responses = []) {
  const calls = []; let now = 0;
  const run = runInNewContext(`(${declaration.getText(parsed)})`, {
    readFileSync: () => JSON.stringify({ scripts }), root: '/repo', join, process: { execPath: '/node' },
    performance: { now: () => now },
    command: async (...args) => { calls.push(args); now += 1000; return responses.shift() ?? { code: 0, signal: null, error: null }; },
  });
  return { run, calls };
}

test('AV-31: verification package scripts use direct argv from the manifest and share one bounded budget', async () => {
  const r = runner({ architecture: 'npm run inventory && node scripts/check.mjs', inventory: 'node scripts/inventory.mjs', typecheck: 'tsc -p tsconfig.json --noEmit' });
  await r.run('architecture', 'architecture', 10);
  await r.run('typecheck', 'typecheck', 10);
  assert.deepEqual(r.calls.map(([command, argv, label, seconds]) => [command, Array.from(argv), label, seconds]), [
    ['/node', ['scripts/inventory.mjs'], 'architecture-1', 10],
    ['/node', ['scripts/check.mjs'], 'architecture-2', 9],
    ['/node', ['/repo/node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--noEmit'], 'typecheck', 10],
  ]);
});

test('AV-31: shell syntax, unsupported commands, missing scripts and cycles never reach a child', async () => {
  for (const scripts of [{ test: 'node script.mjs; systemctl' }, { test: 'sh -c echo' }, { test: 'node "quoted.mjs"' },
    { test: 'npm run test' }, { test: 'npm run absent' }, { test: 'node script.mjs | cat' }, { test: 'node $(echo)' }]) {
    const r = runner(scripts);
    await assert.rejects(r.run('test', 'test', 10));
    assert.equal(r.calls.length, 0);
  }
});

test('AV-31: a failed command or exhausted script budget cannot launch later checks', async () => {
  const scripts = { test: 'node first.mjs && node second.mjs' };
  const r = runner(scripts, [{ code: 7, signal: null }]);
  assert.equal((await r.run('test', 'test', 10)).code, 7);
  assert.equal(r.calls.length, 1);
  const expired = runner(scripts);
  await assert.rejects(expired.run('test', 'test', 1), /exceeded its deadline/);
  assert.equal(expired.calls.length, 1);
});
