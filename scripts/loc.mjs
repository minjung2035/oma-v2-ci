// MUST [A-008/A-009]: Count non-empty physical lines of production source files
// listed in production-manifest.json. Tests, docs, lockfiles, compiled output,
// and unmodified external deps are excluded.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let manifest;
try {
  manifest = JSON.parse(readFileSync(join(root, 'production-manifest.json'), 'utf8'));
} catch (e) {
  console.error('cannot read production-manifest.json:', e.message);
  process.exit(1);
}

function expand(entry) {
  const p = join(root, entry);
  let st;
  try {
    st = statSync(p);
  } catch {
    console.warn('(missing) skipped:', entry);
    return [];
  }
  if (st.isDirectory()) {
    return readdirSync(p, { withFileTypes: true })
      .filter((d) => !d.name.startsWith('.'))
      .flatMap((d) => expand(join(entry, d.name)));
  }
  // docs (.md) are excluded from the production LOC budget per A-008
  if (entry.endsWith('.md')) return [];
  return [entry];
}

let total = 0;
const rows = [];
for (const entry of manifest) {
  for (const file of expand(entry)) {
    const text = readFileSync(join(root, file), 'utf8');
    const nonEmpty = text.split('\n').filter((l) => l.trim().length > 0).length;
    rows.push({ file, loc: nonEmpty });
    total += nonEmpty;
  }
}
rows.sort((a, b) => b.loc - a.loc);
for (const r of rows) console.log(String(r.loc).padStart(5), r.file);
console.log('---');
console.log('TOTAL production LOC (non-empty physical lines):', total);
