// Reproduces an OPEN finding; exit 0 means the defect was observed with its control.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
const { StorageAdmission, observedStorageBytes } = await import(new URL('../../../dist/src/storage/quota.js', import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-audit-quota-'));
const opaque = path.join(root, 'opaque');
fs.mkdirSync(opaque);
fs.writeFileSync(path.join(opaque, 'fact'), 'quota probe');
const results = { uid: process.getuid(), modeDamage: [], performance: [] };
try {
  const owner = new StorageAdmission(root, 1024 ** 3, 256 * 1024);
  const baseline = observedStorageBytes(root);
  results.baseline = { observedBytes: baseline, startup: owner.startupState() };
  fs.chmodSync(opaque, 0);
  for (const [name, run] of [['observation', () => observedStorageBytes(root)], ['startup', () => owner.startupState()], ['admission', () => owner.admit('admit')()]]) {
    try { results.modeDamage.push({ name, success: true, value: run() }); }
    catch (error) { results.modeDamage.push({ name, code: error.code, cause: error.cause?.code, message: error.message }); }
  }
  results.modeAfter = fs.statSync(opaque).mode & 0o777;
  fs.chmodSync(opaque, 0o700);
  if (results.uid === 0 || results.modeDamage.some(item => item.code !== 'BROKER_UNAVAILABLE') || results.modeAfter !== 0)
    throw new Error('Mode-000 defect oracle not reproduced as non-root');
  const entries = path.join(root, 'entries');
  fs.mkdirSync(entries);
  let made = 0;
  for (const count of [5000, 30000]) {
    for (; made < count; made++) fs.writeFileSync(path.join(entries, `f-${made}`), 'x');
    const scans = [];
    const timerStart = performance.now();
    const timer = new Promise(resolve => setTimeout(() => resolve(performance.now() - timerStart), 0));
    for (let attempt = 0; attempt < 3; attempt++) {
      const start = performance.now();
      owner.admit('admit')();
      scans.push(performance.now() - start);
    }
    results.performance.push({ files: count, admitMs: scans, timerDelayedMs: await timer });
  }
  console.log(JSON.stringify(results, null, 2));
} finally { fs.chmodSync(opaque, 0o700); fs.rmSync(root, { recursive: true, force: true }); }
