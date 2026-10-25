// A real installed entry and bundled engine; only inference is a local fixture.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scriptedProvider, call, tools, toolResults, text } from '../../dist/test/fixtures/scripted-provider.js';

const [root, mode, project, waitBroker, earlyTool] = process.argv.slice(2);
let launch;
let observation;
let probe;
const requestKey = randomUUID();
const provider = await scriptedProvider((request, index) => {
  if (index === 0) writeFileSync(join(root, 'request.json'), JSON.stringify({ seconds: Number(process.hrtime.bigint() - launch) / 1e9 }));
  if (earlyTool === 'early-tool' && index === 0 || waitBroker === 'wait-broker' && earlyTool !== 'early-tool' && index === 1)
    return tools(call('oma_society', { action: 'close', request: requestKey }));
  if (earlyTool === 'early-tool' && index > 0 || waitBroker === 'wait-broker' && index > 1) {
    const result = toolResults(request).at(-1);
    assert.ok(result, 'the real tool did not return a result');
    writeFileSync(join(root, 'authority.json'), JSON.stringify({ seconds: Number(process.hrtime.bigint() - launch) / 1e9,
      requestKey, toolResult: result.text }));
    return text('OMA_STARTUP_RESPONSE_COMPLETE OMA_STARTUP_BROKER_TOOL_COMPLETE');
  }
  return text('OMA_STARTUP_RESPONSE_COMPLETE');
});
try {
  const engine = join(root, 'data/oma/.engine');
  provider.configure(engine);
  const settings = JSON.parse(readFileSync(join(engine, 'settings.json'), 'utf8'));
  writeFileSync(join(engine, 'settings.json'), JSON.stringify({ ...settings, defaultProvider: 'fake', defaultModel: 'scripted' }));
  launch = process.hrtime.bigint();
  writeFileSync(join(root, 'launch.json'), JSON.stringify({ monotonicNs: String(launch) }));
  const child = spawn(process.execPath, [fileURLToPath(new URL("../../apps/oma/dist/entry/oma.js", import.meta.url)), '--mode', mode], {
    cwd: project, stdio: 'inherit', env: { PATH: `${process.execPath.slice(0, process.execPath.lastIndexOf('/'))}:/usr/bin:/bin`,
      HOME: join(root, 'home'), XDG_DATA_HOME: join(root, 'data'), XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
      LANG: 'C.UTF-8', TERM: 'xterm-256color' },
  });
  if (waitBroker === 'wait-broker') observation = setInterval(() => {
    if (probe) return;
    const societies = readdirSync(join(root, 'data/oma'), { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'));
    if (societies.length !== 1) return;
    probe = createConnection(join(process.env.XDG_RUNTIME_DIR ?? tmpdir(), 'oma', societies[0].name, 'admin.sock'));
    probe.on('error', () => {});
    probe.setTimeout(100, () => probe.destroy());
    probe.once('close', () => { probe = undefined; });
    probe.once('connect', () => {
      writeFileSync(join(root, 'broker.json'), JSON.stringify({ seconds: Number(process.hrtime.bigint() - launch) / 1e9 }));
      clearInterval(observation);
      probe.destroy();
    });
  }, 100);
  const exit = await new Promise((resolve, reject) => {
    child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  writeFileSync(join(root, 'exit.json'), JSON.stringify(exit));
  process.exitCode = exit.code ?? 1;
} finally { clearInterval(observation); probe?.destroy(); await provider.close(); }
