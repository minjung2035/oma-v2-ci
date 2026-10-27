/** Pure trusted recipe/codec tests; none simulates a Darwin syscall. */
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describeMacDeveloperTools } from "@oma/protocol/mac-developer-tools";
import { residentSeatbelt } from "@oma/platform-mac/resident-sandbox";
import { machRendezvousName } from "@oma/platform-mac/mach-address";
import { decodeRunLease } from "@oma/protocol/run-lease";
import { assertResidentContext } from "@oma/protocol/resident-context";
import { residentDirectoryPolicy, residentEnvironment } from "@oma/domain/resident-paths";
import { actorSocketPathAt, agentRootPathAt, workspacePathAt, runnerSessionDirPathAt, runnerViewPathAt,
  projectGitPathAt, projectMirrorPathAt } from "@oma/domain/paths";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";

const developer = "/Applications/Xcode.app/Contents/Developer";
const tools = describeMacDeveloperTools(developer, `${developer}/usr/bin/git`, `${developer}/usr/libexec/git-core`);

function context() {
  const stateRoot = '/private/var/한 글자 state "quote', runRoot = '/private/var/oma-run', actor = 'alice';
  const directories = { workspace: workspacePathAt(stateRoot, actor), home: join(agentRootPathAt(stateRoot, actor), 'home'),
    archive: join(stateRoot, 'mail/archive'), workerArchive: join(stateRoot, 'mail/workers'),
    selfMail: join(stateRoot, 'mail/inboxes', actor), view: runnerViewPathAt(stateRoot, actor), world: join(stateRoot, 'world'),
    projectGit: projectGitPathAt(stateRoot), projectMirror: projectMirrorPathAt(stateRoot), sessions: runnerSessionDirPathAt(stateRoot, actor) };
  const host = {  libdir: '/opt/oma installation', node: '/opt/pinned-node/bin/node',
    pi: '/opt/oma installation/engine.js', piModeArgs: ['--mode','rpc','literal " ; $(arg)'], packages: '/opt/oma packages',
    hidden: [{ path: 'packages/tui', kind: 'dir' }, { path: 'host-entry.js', kind: 'file' }],
    stateRoot, runRoot, limits: { frameBytes: 65536, batchMaxMessages: 24 } };
  const lease = decodeRunLease({ actor, incarnation: 7, socketHostPath: actorSocketPathAt(runRoot, actor, 7) }, { actor, runRoot });
  return { host, lease, directories };
}
test('Mac Worker recipe uses the common access table, physical paths and exact private IPC', () => {
  const { host, lease, directories } = context(), endpoints = { inference: '/private/var/relay.sock', egress: '/private/var/egress.sock' };
  const recipe = residentSeatbelt(host, lease, directories, tools, {}, endpoints), env = recipe.command.env;
  assert.deepEqual(recipe.command.argv, [host.node, host.pi, ...host.piModeArgs]);
  assert.equal(recipe.command.cwd, directories.workspace); assert.equal(recipe.command.timeoutMs, null);
  assert.equal(env.HOME, directories.home); assert.equal(env.TMPDIR, directories.home);
  assert.equal(env.OMA_NODE, host.node); assert.equal(env.OMA_CLI, join(host.libdir, DEPLOYMENT_LAYOUT.cli));
  assert.equal(env.NODE_OPTIONS, `--import=${pathToFileURL(join(host.libdir, DEPLOYMENT_LAYOUT.clientPreload)).href}`);
  assert.equal(env.OMA_ACTOR, lease.actor); assert.equal(env.OMA_FRAME_BYTES, '65536'); assert.equal(env.OMA_BATCH_MAX_MESSAGES, '24');
  const access = residentDirectoryPolicy(host, directories);
  assert.deepEqual(access.filter(root => root.writable).map(root => root.name), ['workspace', 'home', 'sessions']);
  for (const root of access) {
    assert.ok(recipe.profile.includes(`(allow file-read* (subpath ${JSON.stringify(root.path)}))`));
    assert.equal(recipe.profile.includes(`(allow file-write* (subpath ${JSON.stringify(root.path)}))`), root.writable, root.name);
    if(root.writable)assert.ok(recipe.profile.includes(`(allow process-exec* (subpath ${JSON.stringify(root.path)}))`),root.name);
  }
  for (const endpoint of Object.values(endpoints)) assert.ok(recipe.profile.includes(`(remote unix-socket (literal ${JSON.stringify(endpoint)}))`));
  assert.ok(recipe.profile.includes(`(global-name ${JSON.stringify(machRendezvousName(lease.socketHostPath))})`));
  for (const entry of host.hidden) assert.ok(recipe.profile.includes(`(deny file* (${entry.kind === 'dir' ? 'subpath' : 'literal'} ${JSON.stringify(join(host.libdir, entry.path))}))`));
  for (const broad of ['(allow default)', '(allow network*)', '(allow mach-register', '(allow ipc-posix', '(subpath "/private/var")'])
    assert.ok(!recipe.profile.includes(broad), broad);
  assert.equal(recipe.privateInputs.length, 1); assert.equal(recipe.privateInputs[0].fd, 3);
  assert.equal(Buffer.from(recipe.privateInputs[0].bytes).subarray(16).toString(), recipe.profile);
});
test('Mac Worker recipe refuses forged leases and every substituted actor directory', () => {
  const { host, lease, directories } = context();
  assert.throws(() => residentSeatbelt(host, { ...lease }, directories, tools), { code: 'AUTH_FAILED' });
  assert.throws(() => residentSeatbelt({ ...host, runRoot: '/other-run' }, lease, directories, tools), { code: 'AUTH_FAILED' });
  for (const key of Object.keys(directories)) {
    const substituted = { ...directories, [key]: '/human/another-actor' };
    assert.throws(() => assertResidentContext(host, lease, substituted), { code: 'AUTH_FAILED' }, key);
    assert.throws(() => residentSeatbelt(host, lease, substituted, tools), { code: 'AUTH_FAILED' }, key);
  }
  assert.throws(() => residentSeatbelt({ ...host, limits: undefined }, lease, directories, tools), { code: 'UNSUPPORTED_PROFILE' });
});
test('Mac Worker recipe fixes owned environment and refuses ambient secrets and preload substitution', () => {
  const { host, lease, directories } = context();
  const recipe = residentSeatbelt(host, lease, directories, tools, { HOME: '/human', TMPDIR: '/human', PATH: '/host/bin', GIT_EXEC_PATH: '/human/helpers',
    OMA_NODE: '/host/node', OMA_CLI: '/host/cli', OMA_ACTOR: 'mallory', OMA_FRAME_BYTES: '1' });
  assert.equal(recipe.command.env.HOME, directories.home); assert.equal(recipe.command.env.TMPDIR, directories.home);
  assert.equal(recipe.command.env.OMA_NODE, host.node); assert.equal(recipe.command.env.OMA_ACTOR, lease.actor);
  assert.equal(recipe.command.env.OMA_FRAME_BYTES, '65536');
  assert.equal(recipe.command.env.GIT_EXEC_PATH, tools.execPath);
  assert.ok(recipe.command.env.PATH.split(':').includes(`${developer}/usr/bin`));
  for (const key of ['AWS_SECRET_ACCESS_KEY', 'ANTHROPIC_API_KEY', 'SSH_AUTH_SOCK', 'DYLD_INSERT_LIBRARIES', 'NODE_PATH'])
    assert.throws(() => residentSeatbelt(host, lease, directories, tools, { [key]: 'ambient secret' }), { code: 'UNSUPPORTED_PROFILE' }, key);
  for (const options of ['--require=/human/malicious.js', '--inspect=0.0.0.0:9229', '--import=file:///other.js', ''])
    assert.throws(() => residentSeatbelt(host, lease, directories, tools, { NODE_OPTIONS: options }), { code: 'UNSUPPORTED_PROFILE' });
});
test('Mac Worker recipe refuses broad installation roots, escaped hidden paths and nonphysical entries', () => {
  const { host, lease, directories } = context();
  for (const libdir of ['/private/var', directories.workspace])
    assert.throws(() => residentSeatbelt({ ...host, libdir, pi: join(libdir, 'engine.js') }, lease, directories, tools), { code: 'UNSUPPORTED_PROFILE' });
  for (const path of ['../human', 'a/../../human', '/human', 'a//b', 'a/./b', 'a\0b'])
    assert.throws(() => residentSeatbelt({ ...host, hidden: [{ path, kind: 'dir' }] }, lease, directories, tools), { code: 'UNSUPPORTED_PROFILE' });
  assert.throws(() => residentSeatbelt({ ...host, pi: '/opt/oma/engine.js' }, lease, directories, tools), { code: 'UNSUPPORTED_PROFILE' });
  assert.throws(() => residentSeatbelt({ ...host, pi: host.libdir + '/entry\\name.js' }, lease, directories, tools), { code: 'UNSUPPORTED_PROFILE' });
  assert.throws(() => residentSeatbelt(host, lease, directories, tools, {}, { inference: 'relative.sock' }), { code: 'UNSUPPORTED_PROFILE' });
  assert.throws(() => residentEnvironment({ libdir: '/', node: host.node, home: directories.home, temporary: directories.home }), { code: 'UNSUPPORTED_PROFILE' });
});
test('Mac Worker recipe copies arguments, environment and profile inputs without caching authority', () => {
  const { host, lease, directories } = context(), environment = { OMA_SOCIETY: 'demo' };
  const recipe = residentSeatbelt(host, lease, directories, tools, environment), profile = recipe.profile;
  host.piModeArgs[0] = 'changed'; environment.OMA_SOCIETY = 'other'; directories.home = '/human';
  assert.equal(recipe.command.argv[2], '--mode'); assert.equal(recipe.command.env.OMA_SOCIETY, 'demo');
  assert.equal(recipe.profile, profile);
});

for (const kind of ['libdir', 'packages', 'node', 'developer']) test(`Mac Worker private-state overlap: ${kind} nested outside writable actor roots is refused`, () => {
  const { host, lease, directories } = context(), nested = join(host.stateRoot, 'broker-private-installation');
  let selected = tools;
  if (kind === 'libdir') { host.libdir = nested; host.pi = join(nested, 'engine.js'); }
  if (kind === 'packages') host.packages = nested;
  if (kind === 'node') host.node = join(nested, 'bin/node');
  if (kind === 'developer') {
    const root = join(nested, 'Xcode.app/Contents/Developer');
    selected = describeMacDeveloperTools(root, `${root}/usr/bin/git`, `${root}/usr/libexec/git-core`);
  }
  assert.throws(() => residentSeatbelt(host, lease, directories, selected), { code: 'UNSUPPORTED_PROFILE' });
});
