// Reproduces an OPEN finding; exit 0 means the defect was observed with its control.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
const repository = fileURLToPath(new URL('../../../', import.meta.url));
const load = name => import(pathToFileURL(path.join(repository, 'dist/src', name)));
const { provisionSociety } = await load('runtime/provision.js');
const { runGitText } = await load('process/policies.js');
const { integrationPolicyFromConfig, snapshotIntegrationPolicy, assertSupportedIntegration } = await load('git/integration-policy.js');
const { defaultHostConfig } = await load('config/defaults.js');
const { validateConfig } = await load('config.js');
const { CandidateChecks } = await load('runtime/candidate-checks.js');
const { runProcess } = await load('process/run.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-audit-check-'));
const stateRoot = path.join(root, 'society'), project = path.join(root, 'project');
const results = [];
fs.mkdirSync(project);
fs.writeFileSync(path.join(project, 'source.txt'), 'audit native candidate\n');
const config = defaultHostConfig({ society: 'audit', node: process.execPath, libdir: repository,
  rootfs: path.join(stateRoot, 'rootfs'), deploymentDigest: 'a'.repeat(64) });
const resources = { ...config.agentProfiles.resident.resources, memoryBytes: 256 * 1024 * 1024, tasks: 128,
  cpuQuotaPercent: 100, checkTimeoutSeconds: 10 };
try {
  provisionSociety(stateRoot, { projectDir: project });
  const candidate = runGitText(['--git-dir', path.join(stateRoot, 'repos/project.git'), 'rev-parse', 'main']).stdout.trim();
  const paths = { stateRoot, projectGit: path.join(stateRoot, 'repos/project.git'),
    contextGit: path.join(stateRoot, 'repos/context.git'), society: 'audit', worldDir: path.join(stateRoot, 'world'),
    checkRootfs: path.join(stateRoot, 'rootfs'), checkNode: process.execPath, checkAssetsDir: repository, quarantineTmpBytes: 1 };
  for (const [name, memoryBytes, argv] of [
    ['baseline', resources.memoryBytes, ['/bin/true']],
    ['unaligned-memory', resources.memoryBytes + 1, ['/bin/true']],
    ['verbose-success', resources.memoryBytes, ['/bin/sh', '-c', 'head -c 1048577 /dev/zero; exit 0']],
  ]) {
    const check = snapshotIntegrationPolicy({ policyRevision: 'audit', protectedPaths: [], checks: [
      { id: name, argv, env: {}, timeoutSeconds: resources.checkTimeoutSeconds,
        resources: { ...resources, memoryBytes } }] }).checks[0];
    let native;
    const owner = new CandidateChecks(paths, async spec => {
      native = await runProcess(spec);
      return native;
    });
    try { await owner.run(candidate, check); results.push({ name, result: 'succeeded', memoryBytes, kind: native.kind, exitCode: native.exitCode }); }
    catch (error) { results.push({ name, result: 'refused', code: error.code, message: error.message, memoryBytes,
      kind: native?.kind, exitCode: native?.exitCode, stdoutBytes: native?.stdout.length,
      stdoutTruncated: native?.stdoutTruncated, stderr: native?.stderr.toString('utf8') }); }
  }
  const large = structuredClone(config);
  large.integration.checks = [{ id: 'long', argv: ['/bin/true'], env: {}, resources: { ...resources, checkTimeoutSeconds: 2147484 } }];
  validateConfig(large);
  try { assertSupportedIntegration(snapshotIntegrationPolicy(integrationPolicyFromConfig(large.integration))); }
  catch (error) { results.push({ name: 'config-executor-deadline', validated: true, code: error.code, message: error.message }); }
} finally { fs.rmSync(root, { recursive: true, force: true }); }
assert.equal(results.find(item => item.name === 'baseline')?.result, 'succeeded', 'native positive control must run');
assert.equal(results.find(item => item.name === 'unaligned-memory')?.exitCode, 125, 'kernel-rounding gate must refuse');
assert.equal(results.find(item => item.name === 'unaligned-memory')?.code, 'CHECK_FAILED');
assert.equal(results.find(item => item.name === 'verbose-success')?.kind, 'output-limited');
assert.equal(results.find(item => item.name === 'verbose-success')?.code, 'REF_STATE_UNKNOWN');
assert.equal(results.find(item => item.name === 'config-executor-deadline')?.code, 'UNSUPPORTED_PROFILE');
console.log(JSON.stringify(results, null, 2));
