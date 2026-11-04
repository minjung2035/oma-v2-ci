import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensurePrivateStateDirectory, privateStateKey, removePrivateStateTree } from "../dist/private-state.js";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oma-private-state-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const state = join(root, "state"), outside = join(root, "outside");
  mkdirSync(outside, { mode: 0o755 });
  writeFileSync(join(outside, "secret"), "do not modify", { mode: 0o640 });
  return { root, state, outside };
}
function unchanged(outside) {
  assert.equal(readFileSync(join(outside, "secret"), "utf8"), "do not modify");
  assert.equal(statSync(outside).mode & 0o777, 0o755);
  assert.equal(statSync(join(outside, "secret")).mode & 0o777, 0o640);
}

for (const point of ["before-write", "after-file-fsync"]) test(`008. SIGKILL ${point} cannot expose a partial private key or block another engine`, { timeout: 10000 }, async t => {
  const { state, outside } = fixture(t);
  ensurePrivateStateDirectory(state);
  const { spawn } = await import("node:child_process"), { once } = await import("node:events");
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
    import {privateStateKey} from ${JSON.stringify(new URL("../dist/private-state.js", import.meta.url).href)};
    const pause=()=>{process.stdout.write('ready\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);};
    if (${JSON.stringify(point)}==='before-write') fs.writeFileSync=()=>pause();
    else {const flush=fs.fsyncSync;fs.fsyncSync=(fd)=>{flush(fd);pause();};}
    syncBuiltinESMExports();privateStateKey(${JSON.stringify(state)},'boundary-test-key');
  `], { stdio: ["ignore", "pipe", "pipe"] });
  const closed = once(child, "close");
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await closed; });
  let stderr = "";
  child.stderr.on("data", bytes => { stderr += bytes; });
  const ready = once(child.stdout, "data").then(([bytes]) => assert.equal(bytes.toString(), "ready\n"));
  await Promise.race([ready, closed.then(() => { throw new Error(`writer exited before the boundary: ${stderr}`); })]);
  assert.equal(existsSync(join(state, "boundary-test-key")), false);
  child.kill("SIGKILL");
  const [code, signal] = await closed;
  assert.equal(code, null); assert.equal(signal, "SIGKILL");
  const leftovers = readdirSync(state);
  assert.equal(leftovers.length, 1);
  assert.match(leftovers[0], /^\.key-[0-9a-f]{32}\.tmp$/);
  const abandoned = readFileSync(join(state, leftovers[0]));
  assert.equal(abandoned.length, point === "before-write" ? 0 : 45);
  const key = privateStateKey(state, "boundary-test-key");
  assert.equal(Buffer.from(key, "base64").length, 32);
  assert.equal(privateStateKey(state, "boundary-test-key"), key);
  assert.equal(statSync(join(state, "boundary-test-key")).nlink, 1);
  assert.deepEqual(readFileSync(join(state, leftovers[0])), abandoned, "a replacement engine cannot collect an unowned writer's temporary");
  unchanged(outside);
});

test("001. Private state: canonical owned key is durable and reused, with only leaf modes repaired", t => {
  const { root, state } = fixture(t);
  chmodSync(root, 0o755); ensurePrivateStateDirectory(state);
  const key = privateStateKey(state, "oauth-file-key");
  assert.equal(Buffer.from(key, "base64").length, 32);
  assert.equal(privateStateKey(state, "oauth-file-key"), key);
  assert.equal(readFileSync(join(state, "oauth-file-key"), "utf8"), `${key}\n`);
  assert.equal(statSync(root).mode & 0o777, 0o755);
  assert.equal(statSync(state).mode & 0o777, 0o700);
  assert.equal(statSync(join(state, "oauth-file-key")).mode & 0o777, 0o600);
});
for (const target of ["leaf", "ancestor"]) test(`002. Private state: rejects ${target} directory symlink without touching external modes`, t => {
  const { root, state, outside } = fixture(t);
  symlinkSync(outside, state);
  assert.throws(() => ensurePrivateStateDirectory(target === "leaf" ? state : join(state, "new")));
  assert.equal(existsSync(join(outside, "new")), false); unchanged(outside);
});
for (const kind of ["symlink", "hardlink", "invalid"]) test(`003. Private state: ${kind} key refuses instead of replacing or chmodding it`, t => {
  const { state, outside } = fixture(t); ensurePrivateStateDirectory(state);
  const key = join(state, "oauth-file-key"), external = join(outside, "secret");
  if (kind === "symlink") symlinkSync(external, key);
  else if (kind === "hardlink") linkSync(external, key);
  else writeFileSync(key, "not a key", { mode: 0o640 });
  assert.throws(() => privateStateKey(state, "oauth-file-key"));
  if (kind === "invalid") { assert.equal(readFileSync(key, "utf8"), "not a key"); assert.equal(statSync(key).mode & 0o777, 0o640); }
  unchanged(outside);
});
test("004. Private state: cleanup removes planted links and the owned tree, never their targets", t => {
  const { state, outside } = fixture(t); ensurePrivateStateDirectory(state);
  symlinkSync(outside, join(state, "linked"));
  ensurePrivateStateDirectory(join(state, "nested"));
  symlinkSync(join(outside, "secret"), join(state, "nested", "secret"));
  removePrivateStateTree(state); removePrivateStateTree(state);
  assert.equal(existsSync(state), false); unchanged(outside);
});
// A child that dies holding scratch leaves whatever modes it made (XDG/TMP
// trees, 0000 caches); cleanup must still finish instead of stranding the
// tree, while repairing nothing through a name and nothing outside itself.
for (const mode of [0o000, 0o100, 0o300, 0o400, 0o500, 0o555]) test(`005. Private state: cleanup removes an owned subtree whose directories are mode ${mode.toString(8).padStart(3, "0")}`, t => {
  const { root, state, outside } = fixture(t);
  chmodSync(root, 0o755);
  ensurePrivateStateDirectory(state);
  const sealed = join(state, "sealed"), nested = join(sealed, "nested");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(sealed, "note"), "scratch bytes", { mode: 0o600 });
  writeFileSync(join(nested, "deep"), "deeper bytes", { mode: 0o644 });
  symlinkSync(outside, join(sealed, "escape"));
  symlinkSync(join(outside, "secret"), join(nested, "secret"));
  chmodSync(nested, mode);
  chmodSync(sealed, mode);
  chmodSync(state, mode);
  removePrivateStateTree(state); removePrivateStateTree(state);
  assert.equal(existsSync(state), false);
  assert.equal(statSync(root).mode & 0o777, 0o755, "cleanup repaired an ancestor");
  unchanged(outside);
});
test("006. Private state: rejects malformed key names and non-contained cleanup roots", t => {
  const { state } = fixture(t); ensurePrivateStateDirectory(state);
  for (const name of ["../outside/secret", "", ".", "a/b", "a\0b"])
    assert.throws(() => privateStateKey(state, name));
  for (const path of ["/", "relative", `${state}/../outside`])
    assert.throws(() => removePrivateStateTree(path));
  assert.throws(() => ensurePrivateStateDirectory("/"));
});

test("007. Two engines publish one complete key when the first writer pauses before writing", {timeout:10000}, async t=>{
 const {state}=fixture(t);ensurePrivateStateDirectory(state);
 const {spawn}=await import('node:child_process');const {once}=await import('node:events');
 const ready=join(state,'ready'),release=join(state,'release');
 const child=spawn(process.execPath,['--input-type=module','-e',`
  import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
  import {privateStateKey} from ${JSON.stringify(new URL('../dist/private-state.js',import.meta.url).href)};
  const original=fs.writeFileSync;let first=true;
  fs.writeFileSync=(...args)=>{if(first){first=false;original(${JSON.stringify(ready)},'ready');
   const wait=new Int32Array(new SharedArrayBuffer(4));while(!fs.existsSync(${JSON.stringify(release)}))Atomics.wait(wait,0,0,5);}
   return original(...args);};syncBuiltinESMExports();
  process.stdout.write(JSON.stringify(privateStateKey(${JSON.stringify(state)},'test-key')));
 `],{stdio:['ignore','pipe','pipe']});
 t.after(()=>child.kill('SIGKILL'));let output='',error='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>error+=b);
 const closed=once(child,'close');
 for(let i=0;!existsSync(ready)&&i<500;i++)await new Promise(resolve=>setTimeout(resolve,5));
 assert.ok(existsSync(ready),error);
 const winner=privateStateKey(state,'test-key');writeFileSync(release,'go');
 const [status]=await closed;assert.equal(status,0,error);assert.equal(JSON.parse(output),winner);
 assert.equal(privateStateKey(state,'test-key'),winner);assert.equal(statSync(join(state,'test-key')).nlink,1);
});
