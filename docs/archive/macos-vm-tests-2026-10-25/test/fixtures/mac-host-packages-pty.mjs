// Actual Mac entry on Linux, using the host store installed by the package scenario.
// Only inference is scripted; no Keychain/native macOS attestation is claimed.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scriptedProvider, call, tools, text, toolResults } from '../../dist/test/fixtures/scripted-provider.js';
const [host, home, cwd] = process.argv.slice(2);
const provider = await scriptedProvider([
  tools(call('personal_package_fixture', {})), text('HOST_PACKAGE_PERSONAL_COMPLETE'),
]);
const engine = join(host, '.engine'); provider.configure(engine);
const settings = JSON.parse(readFileSync(join(engine, 'settings.json'), 'utf8'));
writeFileSync(join(engine, 'settings.json'), JSON.stringify({ ...settings, defaultProvider: 'fake', defaultModel: 'scripted' }));
const child = spawn(process.execPath, [join(process.cwd(), 'apps/oma/dist/entry/oma-mac.js'), '--mode', 'personal'], {
  cwd, stdio: 'inherit', env: { PATH: process.env.PATH, HOME: home, OMA_HOST_HOME: host, TERM: 'xterm-256color', PI_OFFLINE: '1' },
});
try {
  const result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
  assert.equal(result.signal, null); assert.equal(result.code, 0);
  assert.equal(provider.seen.length, 2);
  const names = provider.seen[0].body.tools.map(tool => tool.function.name);
  for (const name of ['read', 'write', 'edit', 'bash', 'personal_package_fixture']) assert.ok(names.includes(name), name);
  assert.ok(names.every(name => !name.startsWith('oma_')));
  assert.ok(toolResults(provider.seen[1].body).some(result => result.text.includes('INSTALLED_HOST_PACKAGE_TOOL_COMPLETE')));
  const births = readdirSync(join(host, '.personal')).filter(name => !name.includes('.'));
  assert.equal(births.length, 1);
  const birth = JSON.parse(readFileSync(join(host, '.personal', births[0], 'session-mode.json'), 'utf8'));
  assert.equal(birth.mode, 'personal'); assert.equal(birth.cwd, cwd);
  writeFileSync(join(host, 'package-pty-facts.json'), JSON.stringify({ requests: provider.seen.length, names, mode: birth.mode }));
} finally { await provider.close(); }
