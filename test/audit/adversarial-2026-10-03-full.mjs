import { createReconcileModule } from "#oma-test/app/broker/reconcile-composition";
/** Full-audit REQUIRED-behavior oracles. Only disposable local fixtures.
 * Current defects intentionally fail; restore builtin hooks and close every
 * test-owned descriptor even after an assertion fails. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { prepareContextStream } from '../../dist/src/storage/context-stream.js';
import { contextStagingPathAt } from '../../dist/src/storage/paths.js';
import { treeQuiescence, leasePathOf } from '../../dist/src/storage/tree-lease.js';
import { generateOperationId } from "@oma/native/identity";
import { collectUnacceptedArtifacts } from "@oma/storage/preaccept-collection";
import { ReconcileModule } from "@oma/reconcile";
import { Store, StoreError } from '../../dist/src/store.js';
import { requestHash } from '../../dist/src/hash.js';
import { GitObserver } from "@oma/git/observe";
import { observed } from "@oma/domain/git-facts";
import { CAPABILITIES } from '../../dist/src/domain/capabilities.js';
import { resolvedSpecDigest } from '../../dist/src/domain/spec-identity.js';

test('AV-20261003-18: context opener failure must release the already acquired tree lease', async t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'oma-audit-context-lease-'));
  const id = generateOperationId();
  const body = Buffer.from('fixture goal\n');
  const sha256 = createHash('sha256').update(body).digest('hex');
  const entries = [{ path: 'GOAL.md', bytes: body.length, sha256 }];
  const descriptor = { bytes: body.length, sha256, mediaType: 'application/vnd.oma.context-v1' };
  const leasePath = leasePathOf(contextStagingPathAt(root, id));
  const original = fs.openSync;
  let injected = 0;
  const ownedDescriptors = () => fs.readdirSync('/proc/self/fd').flatMap(name => {
    try { return fs.readlinkSync('/proc/self/fd/' + name) === leasePath ? [Number(name)] : []; }
    catch { return []; }
  });
  try {
    fs.openSync = (...args) => {
      const stack = new Error().stack;
      if (stack.includes('acquireStagingRoot') && !stack.includes('TreeLease.take')) {
        injected++;
        throw Object.assign(new Error('injected parent open failure after lease acquisition'), { code: 'EMFILE' });
      }
      return original(...args);
    };
    syncBuiltinESMExports();
    await assert.rejects(prepareContextStream(root, id, entries, descriptor,
      (async function* () { yield body; })()), { code: 'EMFILE' });
    fs.openSync = original;
    syncBuiltinESMExports();
    assert.equal(injected, 1);
    const quiescence = treeQuiescence(contextStagingPathAt(root, id));
    const leaked = ownedDescriptors();
    t.diagnostic(JSON.stringify({ injected, leakedDescriptors: leaked.length, quiescence }));
    assert.deepEqual({ leakedDescriptors: leaked.length, quiescence },
      { leakedDescriptors: 0, quiescence: { kind: 'quiescent' } },
      'a rejected preparation returns no lease owner to the caller');
  } finally {
    fs.openSync = original;
    syncBuiltinESMExports();
    for (const fd of ownedDescriptors()) fs.closeSync(fd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AV-20261003-19: unaccepted .prepare-* revision trees must have a startup owner', async t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'oma-audit-context-prepare-'));
  try {
    const candidate = 'a'.repeat(64);
    const opid = generateOperationId();
    const residue = join(root, 'world', 'context', 'revisions', `.prepare-${candidate}-${opid}`);
    fs.mkdirSync(join(residue, 'decisions'), { recursive: true });
    fs.writeFileSync(join(residue, 'GOAL.md'), 'goal\n');
    fs.writeFileSync(join(residue, 'decisions', 'x.md'), 'x\n');
    const nothingAccepted = { getOperationById: () => null };
    const result = collectUnacceptedArtifacts(root, nothingAccepted);
    const accounted = [...result.removed, ...result.kept.map(entry => entry.path)];
    t.diagnostic(JSON.stringify({ residue, removed: result.removed, kept: result.kept }));
    assert.ok(accounted.includes(residue),
      'startup collection must see unaccepted .prepare-* residue under world/context/revisions');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AV-20261003-20: startup must contain a recoverable non-mail failure like the sweep does', async t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'oma-audit-startup-wedge-'));
  const store = new Store(join(root, 'runtime.sqlite'));
  try {
    const payload = { agent: 'a' };
    const plan = {
      kind: 'agent.start', agent: 'a', previousIncarnation: 0,
      desired: 'enabled', remainingOperations: [],
    };
    const spec = {
      name: 'a', modelProfile: 'md',
      resources: {
        memoryBytes: 3221225472, tasks: 128, cpuQuotaPercent: 200,
        tmpBytes: 1048576, workspaceBytes: 1048576, stagingBytes: 1048576,
        checkTimeoutSeconds: 30,
      },
      from: '0'.repeat(40), brief: 'audit fixture', profile: 'p',
      capabilities: [...CAPABILITIES],
    };
    const id = generateOperationId();
    store.transaction(() => {
      store.insertAgent({
        name: 'a', specHash: resolvedSpecDigest(spec), role: 'resident',
        desired: 'stopped', incarnation: 0, profile: 'p', createdBy: null,
        specJson: JSON.stringify(spec),
      });
      store.insertOperation({
        id, actor: 'a', requestKey: 'k-startup-wedge-1',
        requestHash: requestHash('agent.start', payload),
        kind: 'agent.start', payloadJson: JSON.stringify(payload),
        planJson: JSON.stringify(plan),
      });
    });
    const lifecycle = {
      reconcileAction: () => { throw new StoreError('REF_STATE_UNKNOWN', 'fixture: persistent recovery unknown'); },
      reconcileSociety: () => { throw new StoreError('REF_STATE_UNKNOWN', 'fixture'); },
      reconcileCreate: async () => { throw new StoreError('REF_STATE_UNKNOWN', 'fixture'); },
    };
    const units = { stop: () => {}, confirmDead: () => true };
    const reconcile = createReconcileModule(store, {}, null, null, units, lifecycle, {
      projectGit: join(root, 'repos', 'project.git'),
      hasGoal: () => true, activationAllowed: () => true,
    });
    // The same pending operation through the periodic path is contained per-op.
    await assert.doesNotReject(reconcile.sweep());
    // Required behavior: startup retains the same failure the same way instead of
    // letting it kill the process before the broker can open.
    await assert.doesNotReject(reconcile.startup(),
      'startup must not die on a recoverable unknown for a non-mail operation kind');
  } finally {
    try { store.close(); } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AV-20261003-25: an unrepresentable candidate name must not read as store corruption', t => {
  const repo = fs.mkdtempSync(join(tmpdir(), 'oma-audit-nonutf8-'));
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HOME: repo };
  const runGit = args => spawnSync('/usr/bin/git', args, { env });
  try {
    assert.equal(runGit(['-C', repo, 'init', '-q']).status, 0);
    runGit(['-C', repo, 'config', 'user.email', 'audit@example.invalid']);
    runGit(['-C', repo, 'config', 'user.name', 'audit']);
    fs.writeFileSync(join(repo, 'good.md'), 'y\n');
    assert.equal(runGit(['-C', repo, 'add', '-A']).status, 0);
    assert.equal(runGit(['-C', repo, 'commit', '-qm', 'base']).status, 0);
    const base = runGit(['-C', repo, 'rev-parse', 'HEAD']).stdout.toString().trim();
    const bad = Buffer.concat([Buffer.from(join(repo, 'bad-')), Buffer.from([0xff]), Buffer.from('.md')]);
    fs.writeFileSync(bad, 'x\n');
    assert.equal(runGit(['-C', repo, 'add', '-A']).status, 0);
    assert.equal(runGit(['-C', repo, 'commit', '-qm', 'next']).status, 0);
    const candidate = runGit(['-C', repo, 'rev-parse', 'HEAD']).stdout.toString().trim();
    const observer = new GitObserver(args => {
      const r = runGit(args);
      return { status: r.status, signal: r.signal, error: r.error, stdout: r.stdout, stderr: r.stderr };
    });
    const observation = observer.changedPaths(join(repo, '.git'), base, candidate);
    t.diagnostic(JSON.stringify({ kind: observation.kind, reason: observation.reason }));
    // Required behavior: a name outside the grammar is a candidate-scope refusal,
    // never durable-store corruption — the latter raises the society-wide fence.
    assert.notEqual(observation.kind, 'corrupt',
      'unrepresentable candidate name must not classify as store corruption');
    if (observation.kind !== 'present') {
      assert.throws(() => observed(observation, 'changed paths'),
        error => error instanceof StoreError && error.code !== 'STORE_CORRUPT');
    }
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
