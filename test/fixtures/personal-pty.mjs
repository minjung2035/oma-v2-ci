import { encodePackageIndex } from "#oma-test/app/runtime/packages/index";
// Installed oma, real bundled Pi/Open TUI and tools; only inference is scripted.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scriptedProvider, call, tools, text, failing, lastUserText, toolResults } from '../../dist/test/fixtures/scripted-provider.js';
import { updatePersonalSettings } from "#oma-test/app/runtime/personal-settings";
import { defaultSocietyFor } from "@oma/config/defaults";
import { sha256Hex } from "@oma/domain/canonical-json";
import { ensureProjectSettings } from "#oma-test/app/application/project-settings";
import { readExtensions, toggleExtension } from "#oma-test/app/application/extensions";

const [root, ending = 'tools', installRoot] = process.argv.slice(2);
assert.ok(installRoot && isAbsolute(installRoot) && realpathSync(installRoot) === installRoot, 'an exact test-owned installation is required');
const manifest = JSON.parse(readFileSync(join(installRoot, 'package.json'), 'utf8'));
const commands = join(root, 'bin'); mkdirSync(commands);
const command = join(commands, 'oma');
symlinkSync(join(installRoot, manifest.bin.oma), command);
assert.equal(realpathSync(command), join(installRoot, manifest.bin.oma));
const cwd = join(root, 'project'), outside = join(root, 'user', 'hyprland.conf');
const home = join(root, 'home'), data = join(root, 'data', 'oma'), store = join(data, '.packages');
mkdirSync(cwd, { recursive: true }); mkdirSync(join(root, 'user')); mkdirSync(home);
mkdirSync(store, { recursive: true });
writeFileSync(outside, 'monitor=old\n');
mkdirSync(join(cwd, '.pi')); writeFileSync(join(cwd, '.pi', 'SYSTEM.md'), 'PROJECT_CONTEXT_SENTINEL');
writeFileSync(join(cwd, 'AGENTS.md'), 'SOCIETY_PROMPT_SENTINEL');
const extension = join(store, 'fixture.mjs');
writeFileSync(extension, `import { readFileSync, writeFileSync } from 'node:fs';
export default pi => {
  pi.registerCommand('fixture-reload-update', { description: 'Update this fixture extension', handler(_args, ctx) {
    const file = ${JSON.stringify(extension)}, source = readFileSync(file, 'utf8');
    const needle = ['description: ', "'A local fixture tool'"].join('');
    if (source.indexOf(needle) < 0 || source.indexOf(needle) !== source.lastIndexOf(needle)) throw new Error('Fixture tool declaration is not unique');
    writeFileSync(file, source.replace(needle, "description: 'UPDATED_FIXTURE_TOOL'"));
    writeFileSync(${JSON.stringify(join(root, 'reload-mutation.json'))}, JSON.stringify({ kind: 'update' }));
    ctx.ui.notify('Fixture extension updated', 'info');
  } });
  pi.registerCommand('fixture-reload-failure', { description: 'Make this fixture extension refuse reload', handler(_args, ctx) {
    writeFileSync(${JSON.stringify(extension)}, 'export default () => { throw new Error("FIXTURE_RELOAD_FAILURE"); };\\n');
    writeFileSync(${JSON.stringify(join(root, 'reload-mutation.json'))}, JSON.stringify({ kind: 'failure' }));
    ctx.ui.notify('Fixture reload failure prepared', 'info');
  } });
  pi.registerCommand('fixture-break-project', { description: 'Make the old fixture project unreadable', handler(_args, ctx) {
    const path = ${JSON.stringify(join(root, 'project-settings.json'))};
    const { config } = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(config, '{broken');
    ctx.ui.notify('Fixture old project settings damaged', 'info');
  } });
  pi.registerCommand('fixture-fork', { description: 'Fork this fixture at its saved leaf', async handler(_args, ctx) {
    await ctx.fork(ctx.sessionManager.getLeafId(), { position: 'at' });
  } });
  pi.registerTool({ name: 'personal_fixture', label: 'Personal fixture', description: 'A local fixture tool',
    parameters: { type: 'object', properties: {}, required: [] },
    async execute() { return { content: [{ type: 'text', text: 'EXTENSION_TOOL_COMPLETE' }], details: {} }; } });
};\n`);
writeFileSync(join(store, 'oma-extensions.json'), encodePackageIndex([{ source: 'npm:local-fixture', entries: ['packages:fixture.mjs'], skills: [], prompts: [], themes: [] }]));
const projectSeed = ending.startsWith('project-seed');
// A bound project still lets an unused Personal session open the mode picker.
if (ending === 'society-bound') {
  const project = defaultSocietyFor(realpathSync(cwd), sha256Hex(realpathSync(cwd))), slot = join(data, project);
  mkdirSync(slot, { recursive: true });
  writeFileSync(join(slot, 'project-binding.json'), JSON.stringify({ kind: 'oma-project-binding-v1', society: project,
    canonicalProjectPath: realpathSync(cwd) }) + '\n', { mode: 0o600 });
}
let projectSettings;
if (projectSeed) {
  const project = defaultSocietyFor(realpathSync(cwd), sha256Hex(realpathSync(cwd)));
  const settings = ensureProjectSettings(data, project, installRoot);
  const index = [{ source: 'npm:local-fixture', entries: ['packages:fixture.mjs'] }];
  toggleExtension(readExtensions(settings.path, settings.config.principalProfile, settings.workerProfile, index), 'packages:fixture.mjs', 'principal', true);
  projectSettings = readFileSync(settings.path);
  writeFileSync(join(root, 'project-settings.json'), JSON.stringify({ config: settings.path }));
} else updatePersonalSettings({ dataRoot: data, libdir: installRoot, packages: store }, ['packages:fixture.mjs']);
const provider = await scriptedProvider(ending === 'tools' ? [
  tools(call('read', { path: outside })),
  tools(call('write', { path: outside, content: 'monitor=new\n' })),
  tools(call('edit', { path: outside, oldText: 'monitor=new', newText: 'monitor=edited' })),
  tools(call('bash', { command: `printf 'shell=done\\n' >> '${outside}'` })),
  tools(call('personal_fixture', {})),
  text('PERSONAL_TOOLS_COMPLETE'),
] : (request, index) => {
  if (ending === 'retry' && index === 0) return failing();
  if (ending === 'cancel' && index === 0) return { kind: 'hang' };
  if (ending.includes('extensions')) return text(`PERSONAL_RESPONSE_COMPLETE ${index}`);
  if (projectSeed && index === 0) return tools(call('personal_fixture', {}));
  return text(`PERSONAL_RESPONSE_COMPLETE ${index} ${lastUserText(request)}`);
});
const engine = join(data, '.engine'); provider.configure(engine);
const settings = JSON.parse(readFileSync(join(engine, 'settings.json'), 'utf8'));
writeFileSync(join(engine, 'settings.json'), JSON.stringify({ ...settings, defaultProvider: 'fake', defaultModel: 'scripted' }));
// The target may read only its installed production closure. The test driver
// and scripted provider remain outside that closure and own no product grant.
const checkout = fileURLToPath(new URL('../../', import.meta.url));
const guard = join(root, 'installed-source-guard.mjs');
writeFileSync(guard, `import {register, syncBuiltinESMExports} from 'node:module';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const checkout = ${JSON.stringify(checkout)};
register('data:text/javascript,' + encodeURIComponent(\`export async function resolve(specifier, context, next) {
  const result = await next(specifier, context);
  if (result.url.startsWith(\${JSON.stringify(pathToFileURL(checkout).href)})) throw Error('installed Personal resolved checkout code');
  return result;
}\`));
for (const name of ['readFileSync','openSync','statSync','lstatSync','existsSync','readdirSync','realpathSync']) {
  const original = fs[name];
  fs[name] = function(path, ...args) {
    const target = typeof path === 'string' ? path : path instanceof URL ? path.pathname : '';
    if (target.startsWith(checkout)) throw Error('installed Personal read checkout data');
    return original.call(this, path, ...args);
  };
}
syncBuiltinESMExports();
`);
const child = spawn(command, ending === 'chooser' ? [] : ['--mode', 'personal'], {
  cwd, stdio: 'inherit', env: { PATH: dirname(process.execPath) + ':/usr/bin:/bin', HOME: home, XDG_DATA_HOME: join(root, 'data'),
    XDG_RUNTIME_DIR: join(root, 'run'), NODE_OPTIONS: '--import=' + pathToFileURL(guard).href, TERM: 'xterm-256color', PI_OFFLINE: '1' },
});
let code;
try {
  const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
  code = exit.code;
  writeFileSync(join(root, 'engine-exit.json'), JSON.stringify(exit));
  assert.equal(exit.signal, null);
  if (ending.startsWith('reload-')) {
    assert.equal(JSON.parse(readFileSync(join(root, 'reload-mutation.json'), 'utf8')).kind, ending.slice('reload-'.length));
    const changed = readFileSync(extension, 'utf8');
    if (ending === 'reload-update') assert.ok(changed.includes("label: 'Personal fixture', description: 'UPDATED_FIXTURE_TOOL'"));
    else assert.equal(changed, 'export default () => { throw new Error("FIXTURE_RELOAD_FAILURE"); };\n');
  }
  assert.equal(code, ending === 'reload-failure' ? 1 : 0);
  const ids = readdirSync(join(data, '.personal')).filter(name => !name.includes('.'));
  const births = ids.map(id => JSON.parse(readFileSync(join(data, '.personal', id, 'session-mode.json'), 'utf8')));
  assert.ok(births.length > 0); assert.ok(births.every(birth => birth.mode === 'personal' && birth.cwd === cwd));
  const names = provider.seen[0]?.body.tools.map(tool => tool.function.name) ?? [];
  if (ending === 'tools') {
    assert.deepEqual(readFileSync(outside, 'utf8'), 'monitor=edited\nshell=done\n');
    assert.equal(provider.seen.length, 6);
    for (const name of ['read', 'write', 'edit', 'bash', 'personal_fixture']) assert.ok(names.includes(name), name);
    assert.ok(toolResults(provider.seen.at(-1).body).some(result => result.text.includes('EXTENSION_TOOL_COMPLETE')));
  }
  const expected = ending === 'tools' ? 6 : projectSeed ? ending === 'project-seed-resume' ? 3 : 2
    : ['extensions', 'new', 'resume', 'fork', 'fork-ui', 'fork-cancel', 'reload-update', 'retry', 'cancel'].includes(ending) ? 2 : 1;
  assert.equal(provider.seen.length, expected, ending);
  // C19: the trust gate covers .pi resources (SYSTEM.md stays out untrusted)
  // while AGENTS.md is ordinary project context w8 left discoverable.
  for (const request of provider.seen) {
    assert.doesNotMatch(JSON.stringify(request.body), /PROJECT_CONTEXT_SENTINEL/, `${ending}: a .pi resource reached the model untrusted`);
    assert.match(JSON.stringify(request.body), /SOCIETY_PROMPT_SENTINEL/, `${ending}: project context was not discovered`);
  }
  if (ending === 'config') {
    const chosen = JSON.parse(readFileSync(join(engine, 'settings.json'), 'utf8'));
    assert.equal(chosen.defaultModel, 'scripted-thinking'); assert.equal(chosen.defaultThinkingLevel, 'minimal');
    assert.equal(provider.seen[0].body.model, 'scripted-thinking');
  }
  if (ending.includes('extensions')) {
    const chosen = JSON.parse(readFileSync(join(data, '.personal', 'settings.json'), 'utf8'));
    assert.deepEqual(chosen.extensions, []);
    const lastNames = provider.seen.at(-1).body.tools.map(tool => tool.function.name);
    assert.ok(!lastNames.includes('personal_fixture'));
  }
  if (ending.startsWith('fork')) {
    const histories = readdirSync(births[0].history).filter(name => name.endsWith('.jsonl'));
    assert.equal(histories.length, ending === 'fork-cancel' ? 1 : 2);
    const previousAnswer = message => JSON.stringify(message.content).includes('PERSONAL_RESPONSE_COMPLETE 0');
    const second = provider.seen[1].body;
    assert.equal(second.messages.some(previousAnswer), ending !== 'fork-ui', 'fork UI excludes the selected turn; cancel and at-leaf fork keep it');
    assert.equal(lastUserText(second), ending === 'fork-cancel' ? 'Continue after cancelled fork' : 'Change the temporary user config');
    for (const file of histories) {
      const header = JSON.parse(readFileSync(join(births[0].history, file), 'utf8').split('\n')[0]);
      assert.equal(header.cwd, cwd);
    }
  }
  if (ending === 'reload-update') {
    const tool = provider.seen[1].body.tools.find(tool => tool.function.name === 'personal_fixture');
    assert.equal(tool?.function.description, 'UPDATED_FIXTURE_TOOL');
  }
  if (ending.startsWith('reload-')) {
    const saved = JSON.parse(readFileSync(join(data, '.personal', 'settings.json'), 'utf8'));
    assert.deepEqual(saved.extensions, ['packages:fixture.mjs'], 'reload failure cannot erase the selected extension');
    assert.equal(readdirSync(births[0].history).filter(name => name.endsWith('.jsonl')).length, 1);
  }
  if (projectSeed) {
    const config = JSON.parse(readFileSync(join(root, 'project-settings.json'), 'utf8')).config;
    assert.deepEqual(JSON.parse(readFileSync(join(data, '.personal', 'settings.json'), 'utf8')).extensions, ['packages:fixture.mjs']);
    assert.ok(names.includes('personal_fixture'));
    assert.ok(toolResults(provider.seen[1].body).some(result => result.text.includes('EXTENSION_TOOL_COMPLETE')));
    if (ending === 'project-seed-resume') assert.equal(readFileSync(config, 'utf8'), '{broken');
    else assert.deepEqual(readFileSync(config), projectSettings, 'Personal may observe but not rewrite the project');
  }
  assert.ok(names.every(name => !name.startsWith('oma_')));
  const dataEntries = ['.engine', '.packages', '.personal'];
  if (projectSeed) dataEntries.push('.projects');
  if (ending === 'society-bound') dataEntries.push(defaultSocietyFor(realpathSync(cwd), sha256Hex(realpathSync(cwd))));
  assert.deepEqual(readdirSync(data).sort(), dataEntries.sort());
  writeFileSync(join(root, 'facts.json'), JSON.stringify({ requests: provider.seen.length, births: births.length, names }));
} finally { await provider.close(); }
process.exitCode = code ?? 1;
