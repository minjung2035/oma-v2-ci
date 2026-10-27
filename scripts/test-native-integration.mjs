/** Selected native regressions. This does not certify the whole-root migration. */
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = join(root, 'test/native-integration/tsconfig.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath));
if (parsed.errors.length) throw new Error(ts.formatDiagnostics(parsed.errors, {
  getCanonicalFileName: value => value, getCurrentDirectory: () => root, getNewLine: () => '\n',
}));
if (parsed.options.noEmitOnError !== true || parsed.options.rootDir !== root || parsed.options.outDir !== join(root, 'dist'))
  throw new Error('native integration requires strict emission into the declared test layout');
const require = createRequire(import.meta.url);
const compiler = join(dirname(require.resolve('typescript/package.json')), 'bin/tsc');
function run(args, timeout) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', timeout, killSignal: 'SIGKILL' });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`native regression process ended with ${result.signal}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run([compiler, '-p', configPath], 120_000);
const tests = parsed.fileNames.filter(file => file.endsWith('.test.ts')).sort().map(file => {
  const name = relative(root, file);
  if (isAbsolute(name) || name === '..' || name.startsWith(`..${sep}`)) throw new Error('test escapes declared source root');
  return join(parsed.options.outDir, name.replace(/\.ts$/, '.js'));
});
if (tests.length === 0) throw new Error('native integration has no tests');
console.log(`Selected native integration: ${tests.length} files; whole-root typecheck remains separate.`);
// This selection includes event-loop latency oracles; file isolation keeps
// their unchanged budgets independent of sibling compiler/engine startup.
run(['--test', '--test-concurrency=1', ...tests], 900_000);
