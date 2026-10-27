import { residentRootfsPath } from "@oma/platform-linux/resident-rootfs";
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readSync, renameSync, openSync, closeSync, rmSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { ExecutionJournal } from '@oma/storage/execution-journal';
import { prepareResidentRootfs, hostSystemLayout } from '@oma/platform-linux/resident-rootfs';
import { snapshotIntegrationPolicy } from '@oma/domain/integration-policy';
import { exportRefForRequestKey } from '@oma/domain/derived';
import { ExecutionRuntime } from '#oma-test/app/runtime/execution-runtime';
import { CandidateChecks } from '#oma-test/app/runtime/candidate-checks';
import { quarantineExecution } from '#oma-test/app/runtime/quarantine-execution';
import { QuarantineImporter } from '@oma/git/quarantine';
import { gitSandbox } from '@oma/platform-linux/git-sandbox';
import { runnerScope } from '@oma/platform-linux/runner-scope';

assert.equal(process.platform, 'linux');
const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 'Native test', GIT_AUTHOR_EMAIL: 'native@example.invalid', GIT_COMMITTER_NAME: 'Native test', GIT_COMMITTER_EMAIL: 'native@example.invalid' };
function git(cwd, ...args) { return execFileSync('/usr/bin/git', args, { cwd, env: gitEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'oma-native-git-')), source = join(root, 'source'); mkdirSync(source);
  git(source, 'init', '-q'); writeFileSync(join(source, 'exact.txt'), 'committed\r\n$literal\n');
  git(source, 'add', '.'); git(source, 'commit', '-qm', 'native candidate'); const candidate = git(source, 'rev-parse', 'HEAD');
  const projectGit = join(root, 'project.git'); git(root, 'clone', '-q', '--bare', source, projectGit);
  const paths = { stateRoot: root, projectGit, contextGit: join(root, 'context.git'), worldDir: join(root, 'world'), society: 'demo',
     checkNode: process.execPath, checkAssetsDir: resolve('.') };
  prepareResidentRootfs(residentRootfsPath(paths.stateRoot), hostSystemLayout(), process.getuid(), process.getgid());
  ExecutionJournal.initialize(root); const executions = new ExecutionRuntime(root);
  t.after(async () => { await executions.close(); rmSync(root, { recursive: true }); });
  const checks = new CandidateChecks(paths, (command, signal, authorize, fds, prepared) => executions.run('candidate', command, signal, authorize, fds, undefined, prepared));
  return { root, source, candidate, paths, executions, checks };
}
function check(argv) { return snapshotIntegrationPolicy({ policyRevision: 'native-test', protectedPaths: [], checks: [{ id: 'exact', argv, env: {} }] }).checks[0]; }
test('native candidate: actual exact checkout, read-only canonical mount and private status closed on exec', { timeout: 20000 }, async t => {
  const f = fixture(t); let authorized = 0;
  await f.checks.run(f.candidate, check(['/opt/oma-node/node', '-e', `const a=require('node:assert/strict'),fs=require('node:fs');
    a.equal(process.cwd(),'/workspace'); a.equal(fs.readFileSync('exact.txt','utf8'),'committed\\r\\n$literal\\n');
    a.throws(()=>fs.writeFileSync('/git/project.git/forbidden','no'),{code:'EROFS'});
    a.throws(()=>fs.writeSync(6,'forged'),{code:'EBADF'}); a.equal(fs.existsSync(${JSON.stringify(f.root)}),false);`]), undefined, () => authorized++);
  assert.equal(authorized, 2); assert.equal(f.executions.confirmDead('candidate'), true);
  assert.equal(git(f.paths.projectGit, 'rev-parse', 'HEAD'), f.candidate);
});
test('native candidate: check-controlled stderr cannot forge a setup refusal', { timeout: 20000 }, async t => {
  const f = fixture(t);
  await assert.rejects(f.checks.run(f.candidate, check(['/bin/sh', '-c', 'echo OMA_ERROR=UNSUPPORTED_PROFILE >&2; exit 125']), undefined, () => {}), { code: 'CHECK_FAILED' });
  assert.equal(f.executions.confirmDead('candidate'), true);
});
test('native candidate: SIGKILL after exact checkout preserves canonical refs and permits a fresh retry', { timeout: 30000 }, async t => {
  const f = fixture(t), before = git(f.paths.projectGit, 'show-ref');
  const denied = new Error('killed after checkout and before final exec'); let calls = 0;
  const exact = check(['/opt/oma-node/node', '-e', "require('node:assert/strict').equal(require('node:fs').readFileSync('exact.txt','utf8'),'committed\\r\\n$literal\\n')"]);
  await assert.rejects(f.checks.run(f.candidate, exact, undefined, () => {
    if (++calls !== 2) return;
    const entries = ExecutionJournal.inspect(f.root);
    assert.equal(entries.length, 1); assert.equal(entries[0].slot, 'candidate');
    process.kill(entries[0].witness.pid, 'SIGKILL'); throw denied;
  }), error => {
    if (error !== denied) {
      const describe = error => ({ name: error?.name, message: error?.message, code: error?.code,
        errors: error instanceof AggregateError ? error.errors.map(describe) : undefined });
      t.diagnostic(JSON.stringify(describe(error)));
    }
    return error === denied;
  });
  assert.equal(calls, 2); assert.equal(f.executions.confirmDead('candidate'), true);
  assert.equal(git(f.paths.projectGit, 'show-ref'), before);
  await f.checks.run(f.candidate, exact, undefined, () => {});
  assert.equal(git(f.paths.projectGit, 'show-ref'), before);
  assert.equal(f.executions.confirmDead('candidate'), true);
});
test('native candidate: option-shaped environment values remain literal through namespace controls', { timeout: 20000 }, async t => {
  const f = fixture(t);
  const literal = snapshotIntegrationPolicy({ policyRevision: 'literal-env', protectedPaths: [], checks: [{ id: 'literal',
    argv: ['/opt/oma-node/node', '-e', "const a=require('node:assert/strict');a.equal(process.env.RESERVED,'--info-fd');a.equal(process.env.BOUNDARY,'--');"],
    env: { RESERVED: '--info-fd', BOUNDARY: '--' } }] }).checks[0];
  await f.checks.run(f.candidate, literal, undefined, () => {});
});
test('native candidate: revocation after exact checkout refuses the final exec gate', { timeout: 20000 }, async t => {
  const f = fixture(t); let authorizations = 0, output = '';
  const checks = new CandidateChecks(f.paths, async (command, signal, authorize, fds, prepared) => {
    const result = await f.executions.run('candidate', command, signal, authorize, fds, undefined, prepared);
    output += result.stdout.toString(); return result;
  });
  const denied = new Error('authority revoked while trusted checkout was running');
  await assert.rejects(checks.run(f.candidate, check(['/opt/oma-node/node', '-e', "process.stdout.write('FORBIDDEN')"]), undefined, () => {
    if (++authorizations === 2) throw denied;
  }), error => error === denied);
  assert.equal(authorizations, 2); assert.equal(output, ''); assert.equal(f.executions.confirmDead('candidate'), true);
});
test('native candidate: actual gitlink refusal and revoked authority cannot run the check', { timeout: 20000 }, async t => {
  const f = fixture(t);
  const denied = new Error('current authority revoked');
  await assert.rejects(f.checks.run(f.candidate, check(['/bin/true']), undefined, () => { throw denied; }), error => error === denied);
  git(f.source, 'update-index', '--add', '--cacheinfo', `160000,${f.candidate},dep`); git(f.source, 'commit', '-qm', 'gitlink');
  const linked = git(f.source, 'rev-parse', 'HEAD'); git(f.paths.projectGit, 'fetch', '-q', f.source, linked);
  await assert.rejects(f.checks.run(linked, check(['/bin/true']), undefined, () => {}), { code: 'UNSUPPORTED_PROFILE' });
  assert.equal(f.executions.confirmDead('candidate'), true);
});
test('native quarantine: actual verify then import preserves canonical refs and rejects a mismatched candidate', { timeout: 30000 }, async t => {
  const f = fixture(t), beforeRefs = git(f.paths.projectGit, 'show-ref');
  writeFileSync(join(f.source, 'new.txt'), 'new object'); git(f.source, 'add', '.'); git(f.source, 'commit', '-qm', 'export');
  const candidate = git(f.source, 'rev-parse', 'HEAD'), ref = exportRefForRequestKey('native-test');
  git(f.source, 'update-ref', ref, candidate); const bundle = join(f.root, 'input.bundle'); git(f.source, 'bundle', 'create', bundle, ref);
  const has = oid => { try { git(f.paths.projectGit, 'cat-file', '-e', `${oid}^{commit}`); return true; } catch { return false; } };
  assert.equal(has(candidate), false);
  const physical = quarantineExecution(f.paths, f.executions);
  const importer = new QuarantineImporter(f.paths, has, { confirmDead: physical.confirmDead, async execute(request, authorize) {
    const result = await physical.execute(request, authorize);
    if (result.exitCode !== 0) t.diagnostic(readFileSync(`/proc/self/fd/${request.stderrFd}`, 'utf8'));
    return result;
  } });
  const acceptedBytes = readFileSync(bundle);
  const fd = openSync(bundle, 'r'); t.after(() => closeSync(fd)); let authorized = 0;
  await importer.importBundle(fd, candidate, ref, [], () => authorized++);
  assert.equal(authorized, 2); assert.equal(has(candidate), true); assert.equal(git(f.paths.projectGit, 'show-ref'), beforeRefs);
  const first = Buffer.alloc(1); assert.equal(readSync(fd, first, 0, 1, null), 1);
  assert.equal(first.toString(), '#', 'the verifier must not consume the caller cursor');
  const heldBundle = join(f.root, 'held.bundle'); renameSync(bundle, heldBundle);
  writeFileSync(bundle, 'replaced pathname must not retarget the accepted capability');
  await importer.importBundle(fd, candidate, ref, [], () => authorized++);
  assert.equal(authorized, 4); assert.deepEqual(readFileSync(heldBundle), acceptedBytes);
  assert.equal(git(f.paths.projectGit, 'show-ref'), beforeRefs);
  const mismatched = openSync(heldBundle, 'r');
  try { await assert.rejects(importer.importBundle(mismatched, f.candidate, ref, [], () => {}), { code: 'BUNDLE_INVALID' }); }
  finally { closeSync(mismatched); }
  assert.equal(f.executions.confirmDead('quarantine'), true);
  assert.deepEqual(readdirSync(join(f.root, 'staging')), []);
});
test('native quarantine: explicit view preserves quoted Unicode and newline canonical paths with real prerequisites', { timeout: 30000 }, async t => {
  const f = fixture(t), beforeRefs = git(f.paths.projectGit,'show-ref');
  writeFileSync(join(f.source,'next.txt'),'thin bundle requires canonical objects'); git(f.source,'add','.'); git(f.source,'commit','-qm','thin next');
  const candidate=git(f.source,'rev-parse','HEAD'), ref=exportRefForRequestKey('quoted-view');
  git(f.source,'update-ref',ref,candidate); const bundle=join(f.root,'quoted.bundle'); git(f.source,'bundle','create',bundle,ref,`^${f.candidate}`);
  const prefix='/native 한 글자 "quoted\nview', view={git:'/usr/bin/git',project:prefix+'/project.git',root:prefix+'/quarantine',bundle:prefix+'/frozen.bundle'};
  for (const path of [view.project,view.root]) mkdirSync(join(residentRootfsPath(f.paths.stateRoot),path.slice(1)),{recursive:true});
  writeFileSync(join(residentRootfsPath(f.paths.stateRoot),view.bundle.slice(1)),'');
  const has=oid=>{try{git(f.paths.projectGit,'cat-file','-e',`${oid}^{commit}`);return true}catch{return false}};
  const execution={confirmDead:()=>f.executions.confirmDead('quarantine'),async execute(request,authorize){
    const input={phase:request.phase,candidate:request.candidate,exportRef:request.exportRef,prerequisites:request.prerequisites};
    const command=gitSandbox({rootfs:residentRootfsPath(f.paths.stateRoot),node:f.paths.checkNode,libdir:f.paths.checkAssetsDir},input);
    const args=command.argv.map(value=>value==='/quarantine'?view.root:value==='/git/project.git'?view.project:value==='/bundle/input.bundle'?view.bundle:value);
    const temporary=request.phase==='verify'?view.root+'/tmp':'/tmp';
    args[args.length-1]=JSON.stringify({...input,view:{...view,temporary}});
    const result=await f.executions.run('quarantine',{...command,argv:args},undefined,authorize,
      [request.bundleFd,request.leaseFd,request.rootFd,request.projectFd],request.stderrFd);
    if(result.exitCode!==0)t.diagnostic(readFileSync(`/proc/self/fd/${request.stderrFd}`,'utf8'));
    return result;
  }};
  const importer=new QuarantineImporter(f.paths,has,execution),fd=openSync(bundle,'r');
  try { await importer.importBundle(fd,candidate,ref,[f.candidate],()=>{}); } finally { closeSync(fd); }
  assert.equal(has(candidate),true); assert.equal(git(f.paths.projectGit,'show-ref'),beforeRefs);
  assert.equal(f.executions.confirmDead('quarantine'),true); assert.deepEqual(readdirSync(join(f.root,'staging')),[]);
});
test('native quarantine: a real live scope between phases retains staging and prevents promotion until scope death', {timeout:30000},async t=>{
  const f=fixture(t),beforeRefs=git(f.paths.projectGit,'show-ref');
  writeFileSync(join(f.source,'blocked.txt'),'not promoted while a scope remains');git(f.source,'add','.');git(f.source,'commit','-qm','blocked candidate');
  const candidate=git(f.source,'rev-parse','HEAD'),ref=exportRefForRequestKey('between-phases'),bundle=join(f.root,'blocked.bundle');
  git(f.source,'update-ref',ref,candidate);git(f.source,'bundle','create',bundle,ref);
  const has=oid=>{try{git(f.paths.projectGit,'cat-file','-e',oid+'^{commit}');return true}catch{return false}};
  const physical=quarantineExecution(f.paths,f.executions),phases=[],controller=new AbortController();let held,arm=true;
  const importer=new QuarantineImporter(f.paths,has,{confirmDead:physical.confirmDead,async execute(request,authorize){
    phases.push(request.phase);const result=await physical.execute(request,authorize);
    if(request.phase==='verify'&&arm&&result.exitCode===0){
      arm=false;
      held=await f.executions.begin('quarantine',()=>runnerScope({executable:process.execPath,argv:['-e','setInterval(()=>{},1000)'],
        env:{PATH:'/usr/bin:/bin'},timeoutMs:null,stdoutBytes:0,stderrBytes:65536}),controller.signal,()=>{},()=>{});
      assert.equal(f.executions.confirmDead('quarantine'),false);assert.equal(ExecutionJournal.inspect(f.root).length,1);
    }
    return result;
  }});
  const fd=openSync(bundle,'r');t.after(async()=>{controller.abort();await held?.stop();closeSync(fd);});
  await assert.rejects(importer.importBundle(fd,candidate,ref,[],()=>{}),{code:'RUN_TERMINATION_UNKNOWN'});
  assert.deepEqual(phases,['verify']);assert.equal(has(candidate),false);assert.equal(git(f.paths.projectGit,'show-ref'),beforeRefs);
  assert.ok(readdirSync(join(f.root,'staging')).some(name=>name.startsWith('quarantine-ns-')));
  await held.stop();assert.equal(f.executions.confirmDead('quarantine'),true);
  await importer.importBundle(fd,candidate,ref,[],()=>{});
  assert.deepEqual(phases,['verify','verify','import']);assert.equal(has(candidate),true);
  assert.equal(git(f.paths.projectGit,'show-ref'),beforeRefs);assert.deepEqual(readdirSync(join(f.root,'staging')),[]);
});
