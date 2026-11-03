import { engineSettingsFiles } from "#oma-test/app/engine/settings-files";
// Reproduces an OPEN finding; exit 0 means the defect was observed with its control.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
const repository = fileURLToPath(new URL('../../../', import.meta.url));
const { OmaSettingsStorage } = await import(pathToFileURL(path.join(repository, 'dist/src/pi-compat/settings.js')));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-audit-settings-'));
const agentDir = path.join(root, 'agent');
fs.mkdirSync(agentDir);
const initial = { defaultProvider: 'old-provider', defaultModel: 'old-model', hideThinkingBlock: false };
fs.writeFileSync(path.join(agentDir, 'settings.json'), JSON.stringify(initial));
const child = `
  import { SettingsManager } from ${JSON.stringify(pathToFileURL(path.join(repository, 'node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js')).href)};
  const manager = SettingsManager.create(${JSON.stringify(root)}, ${JSON.stringify(agentDir)});
  manager.setDefaultModelAndProvider('new-provider', 'new-model');
  await manager.flush();
  const errors = manager.drainErrors();
  if (errors.length) throw errors[0].error;
`;
let during;
try {
  new OmaSettingsStorage(engineSettingsFiles, agentDir).withLock('global', current => {
    const before = JSON.parse(current);
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', child], { encoding: 'utf8', timeout: 10000 });
    if (result.status !== 0) throw new Error(`Pi save failed: ${result.status}: ${result.stderr}`);
    during = JSON.parse(fs.readFileSync(path.join(agentDir, 'settings.json'), 'utf8'));
    return JSON.stringify({ ...before, hideThinkingBlock: true });
  });
  const after = JSON.parse(fs.readFileSync(path.join(agentDir, 'settings.json'), 'utf8'));
  if (during.defaultModel !== 'new-model' || after.defaultModel !== 'old-model') throw new Error('Lost-write oracle not reproduced');
  const evidence = { initial, successfulPiSaveDuringOmaLock: during, afterOmaCommit: after, reproducedLostUpdate: true };
  console.log(JSON.stringify(evidence, null, 2));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
