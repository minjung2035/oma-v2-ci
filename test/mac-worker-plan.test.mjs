/** Exercise the shared Pi planner with an explicit host-layout recipe. No OS
 * identity is replaced and no syscall result is supplied by this test. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { residentOptions } from '../dist/test/fixtures/resident.js';
import { planPiSpawn } from '@oma/engine/pi-spawn-plan';
import { macResidentPathView } from '@oma/platform-mac/path-view';
import { residentSeatbelt } from '@oma/platform-mac/resident-sandbox';
import { residentEngineEffects } from '#oma-test/app/engine/resident-effects';

test('Mac Worker shared Pi plan retains physical CLI, session, package, relay and egress paths', () => {
  const libdir = '/opt/한 글자 oma', options = residentOptions('/private/var/oma-state', libdir);
  options.confinement.host.pi = join(libdir, 'engine.js');
  options.confinement.host.packages = '/opt/oma-packages';
  options.confinement.inference = { socketHostPath: '/private/var/relay.sock', provider: 'fixture', model: 'model', placeholder: 'relay-placeholder' };
  options.confinement.egress = { socketHostPath: '/private/var/egress.sock' };
  let prepared;
  const adapter = {
    pathView: macResidentPathView,
    residentPlan(host, lease, directories, env, inference, egress) {
      prepared = residentSeatbelt(host, lease, directories, env, { inference, egress });
      return { command: prepared.command.executable, args: [...prepared.command.argv], cwd: prepared.command.cwd,
        env: prepared.command.env, privateInputs: prepared.privateInputs };
    },
    spawn() { throw new Error('pure planner test must not start a process'); },
  };
  const plan = planPiSpawn(adapter, options), dirs = options.confinement.directories;
  assert.equal(plan.args[1], options.confinement.host.pi);
  assert.equal(plan.args[plan.args.indexOf('--session-dir') + 1], dirs.sessions);
  assert.equal(plan.args[plan.args.indexOf('-e') + 1], options.paths.coreExtension);
  assert.equal(plan.env.OMA_CLI, join(libdir, 'apps/oma/dist/cli.js'));
  assert.equal(plan.env.OMA_INFERENCE_SOCKET, options.confinement.inference.socketHostPath);
  assert.equal(plan.env.OMA_EGRESS_PROXY_SOCKET, options.confinement.egress.socketHostPath);
  assert.equal(plan.env.OMA_PACKAGE_STORE, options.confinement.host.packages);
  assert.equal(plan.env.OMA_BATCH_VIEW, dirs.view); assert.equal(plan.env.OMA_AGENT_HOME, dirs.home);
  assert.equal(plan.env.OMA_INFERENCE_KEY, 'relay-placeholder'); assert.equal(plan.env.OMA_TOOL_SCOPE, 'sandbox');
  assert.equal(plan.privateInputs, prepared.privateInputs);
  assert.ok(!plan.args.includes('/workspace')); assert.ok(!plan.args.includes('/opt/oma'));
  assert.equal(macResidentPathView(options.confinement.host, options.confinement.lease, dirs)
    .sessionPathToHost(join(dirs.sessions, 'session.jsonl')), join(dirs.sessions, 'session.jsonl'));
});

if (process.platform === 'darwin') test('Mac Worker product composition refuses spawn while native gates remain open', () => {
  assert.throws(() => residentEngineEffects.sandbox.spawn({ command: '/must-not-execute', args: [], cwd: '/tmp', env: {},
    privateInputs: [{ fd: 3, bytes: Buffer.from('not an approved live scope') }] }), { code: 'UNSUPPORTED_PROFILE' });
});
