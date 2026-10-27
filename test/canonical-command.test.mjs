/** GIT-004: the canonical observer's ls-tree scratch is answered as typed
 * evidence, never a thrown failure past the runner boundary. The runner opens
 * the stdout spool synchronously (`runProcessSync`), so a starved descriptor
 * table surfaces here: the observation answers `unknown` with the error on
 * its evidence, and the made `oma-ls-tree-*` directory is given back rather
 * than leaked into tmp.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Script } from 'node:vm';
import ts from 'typescript';
import * as errors from "@oma/domain/errors";
import * as policies from "@oma/process/policies";
import * as realRun from "@oma/process/run";
import * as utf8 from "@oma/domain/utf8";
import * as observe from "@oma/git/observe";
import * as identifiers from "@oma/domain/identifiers";

const code = ts.transpileModule(
  fs.readFileSync(process.env.OMA_CANONICAL_COMMAND_SOURCE ?? 'packages/git/src/canonical-command.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
function load(changes = {}) {
  const module = { exports: {} };
  const dependencies = {
    'node:fs': fs, 'node:os': os, 'node:path': path,
    "@oma/process/policies": policies, '@oma/domain/errors': errors, "@oma/process/run": realRun,
    '@oma/domain/utf8': utf8, './observe.js': observe,
    '@oma/domain/identifiers': identifiers, ...changes };
  new Script(code).runInNewContext({ module, exports: module.exports, Buffer, process,
    require(name) { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; } });
  return module.exports;
}

test('GIT-004: a canonical ls-tree spool that cannot be opened answers typed evidence and gives its scratch back', t => {
  const scratchOwner = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-spool-fault-'));
  t.after(() => fs.rmSync(scratchOwner, { recursive: true, force: true }));
  const made = [];
  const fsWrap = { ...fs, mkdtempSync(prefix) {
    const dir = fs.mkdtempSync(path.join(scratchOwner, path.basename(prefix))); made.push(dir); return dir;
  } };
  // The runner opens the spool before the child exists, so the starvation is
  // a synchronous open failure -- exactly what a descriptor-exhausted
  // `openSync` reports from inside `runProcessSync`.
  const starvation = Object.assign(new Error('the spool could not be opened'), { code: 'EMFILE' });
  const run = { ...realRun, runProcessSync(spec) {
    if (spec.stdoutSpool !== undefined) throw starvation;
    return realRun.runProcessSync(spec);
  } };
  const api = load({ 'node:fs': fsWrap, "@oma/process/run": run });
  const observation = api.createCanonicalObserver().gitlinks('/repo', 'a'.repeat(40));
  assert.equal(observation.kind, 'unknown', 'a failed observation is evidence, not a throw');
  // The injected error is this realm's; the module under test re-wraps it in
  // its own realm's Error, so the failure is named by its message, not by
  // reference identity.
  assert.match(String(observation.evidence.error), /the spool could not be opened/);
  assert.equal(observation.evidence.status, null);
  assert.equal(observation.evidence.signal, null);
  assert.equal(observation.evidence.stdout, null);
  assert.equal(observation.evidence.stderr, null);
  assert.equal(made.length, 1, 'the scratch directory was made before the spool failed');
  assert.equal(fs.existsSync(made[0]), false, 'the failed observation gave its scratch back');
  assert.deepEqual(fs.readdirSync(scratchOwner), [], 'no scratch residue owned by this invocation');
});

test('GIT-004: a canonical ls-tree scratch whose run completes disposes on the observation boundary', () => {
  const made = [];
  const fsWrap = { ...fs, mkdtempSync(prefix) { const dir = fs.mkdtempSync(prefix); made.push(dir); return dir; } };
  const api = load({ 'node:fs': fsWrap });
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-canonical-'));
  try {
    // A real empty repository answers the enumeration whole: the scratch was
    // made, the observation consumed the spool, dispose removed the directory.
    const init = realRun.runProcessSync({ executable: '/usr/bin/git',
      argv: ['init', '-q', '--bare', repository], env: {}, timeoutMs: 30000, stdoutBytes: 4096, stderrBytes: 4096 });
    assert.equal(init.kind === 'exited' && init.exitCode === 0, true);
    const commit = 'a'.repeat(40);
    const observation = api.createCanonicalObserver().gitlinks(repository, commit);
    // ls-tree of a missing commit is a nonzero exit -- an unknown observation
    // -- but the run completed, so the scratch was handed to the observation
    // and its dispose ran on the boundary.
    assert.equal(observation.kind, 'unknown');
    assert.equal(observation.evidence.error, undefined);
    assert.equal(made.length, 1);
    assert.equal(fs.existsSync(made[0]), false, 'dispose gave the scratch back');
  } finally { fs.rmSync(repository, { recursive: true, force: true }); }
});
