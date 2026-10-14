// Reproduces an OPEN finding; exit 0 means the defect was observed with its control.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const repository = fileURLToPath(new URL('../../../', import.meta.url));
const load = name => import(pathToFileURL(path.join(repository, 'dist/src', name)));
const { writePackageArchive } = await load('platform/package-archive.js');
const { applyPackageArchive } = await load('tui/packages-apply.js');
const { PACKAGE_STORE } = await load('runtime/pi-packages.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-audit-generations-'));
const data = path.join(root, 'data'), mac = path.join(root, 'mac');
const packageRoot = path.join(mac, 'npm/node_modules/audit-generation');
fs.mkdirSync(data);
fs.mkdirSync(packageRoot, { recursive: true });
fs.writeFileSync(path.join(mac, 'settings.json'), JSON.stringify({ packages: ['npm:audit-generation'] }));
fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: 'audit-generation', version: '1.0.0', pi: { extensions: ['./extension.mjs'] } }));
fs.writeFileSync(path.join(packageRoot, 'extension.mjs'), "import { readFileSync } from 'node:fs';\nexport default function () {}\nexport const readAsset = () => readFileSync(new URL('./asset.txt', import.meta.url), 'utf8');\n");
let extension, pinned, afterOneReplacement;
try {
  for (let version = 1; version <= 3; version++) {
    fs.writeFileSync(path.join(packageRoot, 'asset.txt'), `generation ${version}`);
    const archive = path.join(root, `packages-${version}.archive`);
    await writePackageArchive(mac, archive);
    const applied = await applyPackageArchive({ data, archive, libdir: repository });
    if (!applied.ok) throw new Error(JSON.stringify(applied));
    if (version === 1) {
      pinned = fs.realpathSync(path.join(data, PACKAGE_STORE));
      extension = await import(pathToFileURL(path.join(pinned, 'npm/node_modules/audit-generation/extension.mjs')));
      if (extension.readAsset() !== 'generation 1') throw new Error('Consumer control failed');
    } else if (version === 2) { afterOneReplacement = extension.readAsset(); }
  }
  let afterTwoReplacements;
  try { afterTwoReplacements = { read: extension.readAsset() }; }
  catch (error) { afterTwoReplacements = { code: error.code, pinnedGenerationExists: fs.existsSync(pinned) }; }
  if (afterOneReplacement !== 'generation 1' || afterTwoReplacements.code !== 'ENOENT') throw new Error('Live reader removal not reproduced');
  // A syntactically valid but damaged original-package snapshot must be
  // refused before the replay publishes, switches, or collects generations.
  fs.writeFileSync(path.join(packageRoot, 'asset.txt'), 'generation 4');
  const damagedArchive = path.join(root, 'packages-4.archive');
  await writePackageArchive(mac, damagedArchive);
  fs.writeFileSync(`${damagedArchive}.before.json`, JSON.stringify({ before: null, previous: null }));
  const steps = [];
  let damagedRecord;
  try { await applyPackageArchive({ data, archive: damagedArchive, libdir: repository }, step => steps.push(step)); }
  catch (error) {
    damagedRecord = { error: error.name, message: error.message, steps,
      selectedAsset: fs.readFileSync(path.join(data, PACKAGE_STORE, 'npm/node_modules/audit-generation/asset.txt'), 'utf8') };
  }
  if (damagedRecord?.error !== 'TypeError' || !steps.includes('switched') || !steps.includes('collected') || damagedRecord.selectedAsset !== 'generation 4')
    throw new Error('Damaged-record physical-effect oracle not reproduced');
  const evidence = { afterOneReplacement, afterTwoReplacements, damagedRecord,
    boundary: 'actual archive/application/index owners + already imported extension asset reader; no native VM or Pi UI session' };
  console.log(JSON.stringify(evidence, null, 2));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
