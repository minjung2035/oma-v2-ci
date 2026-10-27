import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("DR44: private search-tool preload refuses an unqualified Pi upgrade before installing hooks", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const read = fs.readFileSync;
fs.readFileSync = (path, ...args) => String(path).endsWith('/pi-coding-agent/package.json')
  ? JSON.stringify({ version: '1.0.2' }) : read(path, ...args);
syncBuiltinESMExports();
await assert.rejects(import(${JSON.stringify(new URL(import.meta.resolve("@oma/engine/pi-compat/interactive-tool-setup")).href)}),
  /Unsupported Pi search-tool adapter version: 1.0.2/);
console.log('PASS');
`], { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "PASS");
});

test("DR35 host runtime resolution and retry setup never load the interactive SDK", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-host-startup-"));
  try {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) {
  assert.notEqual(specifier, '@earendil-works/pi-coding-agent', 'host path/retry setup loaded the interactive SDK');
  return next(specifier, context);
} });
const runtime = await import(${JSON.stringify(new URL(import.meta.resolve("@oma/engine/pi-runtime")).href)});
const resolved = runtime.resolvePiRuntime({ libdir: ${JSON.stringify(process.cwd())}, stateRoot: ${JSON.stringify(join(root, "society"))} });
assert.equal(resolved.source, 'bundled');
const {engineSettingsFiles}=await import(${JSON.stringify(new URL(import.meta.resolve("#oma-test/app/engine/settings-files")).href)});
runtime.preparePiRetry(engineSettingsFiles, ${JSON.stringify(root)});
console.log('PASS');
`], { encoding: "utf8", timeout: 10_000, env: { HOME: root, PATH: "/usr/bin:/bin" } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "PASS");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("DR37/DR44: public autocomplete wrapper restores late fd results without changing the engine prototype", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-late-autocomplete-"));
  try {
    mkdirSync(join(root, "deep", "nested"), { recursive: true });
    writeFileSync(join(root, "deep", "nested", "needle.ts"), "export {};");
    const binary = join(root, "fd");
    writeFileSync(binary, `#!${process.execPath}\nconst args=process.argv;const base=args[args.indexOf('--base-directory')+1];for(const p of require('node:fs').readdirSync(base,{recursive:true}))if(p.endsWith('.ts'))console.log(p);\n`, { mode: 0o755 });
    const result = spawnSync(process.execPath, ["--import",
      new URL(import.meta.resolve("@oma/engine/pi-compat/interactive-tool-setup")).href, "--input-type=module", "-e", `
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
const engine=new URL('./modes/interactive/interactive-mode.js',import.meta.resolve('@earendil-works/pi-coding-agent')).href;
const manager=new URL('./utils/tools-manager.js',import.meta.resolve('@earendil-works/pi-coding-agent')).href;
let started;const installing=new Promise(r=>{started=r});globalThis.__started=started;
registerHooks({load(url,context,next){
 if(url===manager)return{format:'module',shortCircuit:true,source:'export function getToolPath(){return null} export async function ensureTool(){globalThis.__started();return new Promise(r=>{globalThis.__release=r})}'};
 if(url===engine)return{format:'module',shortCircuit:true,source:'import {ensureTool} from "../../utils/tools-manager.js";export const ready=await ensureTool("fd");'};
 return next(url,context);
}});
const ui=await import(engine);assert.equal(ui.ready,undefined);
const {CombinedAutocompleteProvider}=await import('@earendil-works/pi-tui');
const prototype=CombinedAutocompleteProvider.prototype.getSuggestions;
const {withSearchTools}=await import(${JSON.stringify(new URL(import.meta.resolve("@oma/engine/pi-compat/interactive-tools")).href)});
const upstream=new CombinedAutocompleteProvider([{name:'test'}],${JSON.stringify(root)},null);
const provider=withSearchTools(upstream,${JSON.stringify(root)});
assert.equal(withSearchTools(provider,${JSON.stringify(root)}),provider,'reload stacked another search wrapper');
const args=[['@needle'],0,7,{signal:new AbortController().signal}];
assert.equal(await provider.getSuggestions(...args),null);
const beforeCommands=await provider.getSuggestions(['/te'],0,3,{signal:new AbortController().signal});
await installing;globalThis.__release(${JSON.stringify(binary)});
await new Promise(r=>setImmediate(r));
const found=await provider.getSuggestions(...args);
assert.ok(found.items.some(i=>i.value.includes('deep/nested/needle.ts')),JSON.stringify(found));
const command=await provider.getSuggestions(['/te'],0,3,{signal:new AbortController().signal});
assert.deepEqual(command,beforeCommands);
assert.equal(CombinedAutocompleteProvider.prototype.getSuggestions,prototype);
assert.equal(await upstream.getSuggestions(...args),null,'upstream private fdPath was changed');
console.log('PASS');
`], { encoding: "utf8", timeout: 10000, env: { HOME: root, PATH: "/usr/bin:/bin", PI_CODING_AGENT_DIR: root } });
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), "PASS");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("DR35 the interactive import observes search tools without downloading; tool execution retains Pi's installer", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-interactive-startup-"));
  try {
    const result = spawnSync(process.execPath, ["--import",
      new URL(import.meta.resolve("@oma/engine/pi-compat/interactive-tool-setup")).href, "--input-type=module", "-e", `
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { readFileSync } from 'node:fs';
const engine = new URL('./modes/interactive/interactive-mode.js', import.meta.resolve('@earendil-works/pi-coding-agent')).href;
const original = new URL('./utils/tools-manager.js', import.meta.resolve('@earendil-works/pi-coding-agent')).href;
assert.ok(readFileSync(new URL(engine), 'utf8').includes('import { ensureTool } from "../../utils/tools-manager.js";'));
childProcess.spawnSync = () => ({ error: Object.assign(new Error('missing'), { code: 'ENOENT' }) });
syncBuiltinESMExports();
let network = 0;
globalThis.fetch = async url => {
  network++;
  return String(url).endsWith('/latest')
    ? new Response('', { status: 302, headers: { location: 'https://github.com/sharkdp/fd/releases/tag/v10.5.0' } })
    : new Response('', { status: 404 });
};
// Keep the actual import identity and specifier, replacing only the surrounding
// interactive body with a probe so no terminal or model is needed here.
const probe = registerHooks({ load(url, context, next) {
  if (url === engine) return { format: 'module', source:
    'import { ensureTool } from "../../utils/tools-manager.js"; export const ready = await ensureTool("fd");', shortCircuit: true };
  return next(url, context);
} });
const loaded = await import(engine);
assert.equal(loaded.ready, undefined);
assert.equal(network, 0, 'UI initialization waited on an external download');
probe.deregister();
// Negative control: a tool imports the original manager, whose download is
// still enabled. UI policy must never replace grep/find's real installer.
const manager = await import(original);
await manager.ensureTool('fd');
assert.ok(network > 0, 'the adapter disabled the real tool installer as well');
console.log('PASS');
`], { encoding: "utf8", timeout: 10_000, env: { HOME: root, PATH: "/usr/bin:/bin", PI_CODING_AGENT_DIR: root } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "PASS");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
