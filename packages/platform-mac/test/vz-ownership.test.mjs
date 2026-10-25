// DR27/P0-5: actual driver wiring with controlled child/channel observations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { Script } from 'node:vm';
import ts from 'typescript';
import { nativeKeychainStore } from "@oma/platform-mac/keychain-client";
import { NativeChannel } from "@oma/platform-mac/native-channel";
const code = ts.transpileModule(readFileSync(new URL('../src/vz-driver.ts', import.meta.url), 'utf8'), {compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
class StoreError extends Error { constructor(code, message) { super(message); this.code = code; } }
const module_ = {exports: {}};
new Script(code).runInNewContext({exports:module_.exports,module:module_,setTimeout,clearTimeout,require(name) {
  if(name==='./native-channel.js') return {NativeChannel};
  if(name==='node:path') return {join:(...p)=>p.join('/')};
  if(name==='@oma/domain/errors') return {StoreError};
  if(name==='./keychain-client.js') return {nativeKeychainStore};
  if(name==='../rpc.js'||name==="@oma/process/async") return {};
  throw new Error(name);
}});
const {VzDriver} = module_.exports;
const world = () => {
 const child = Object.assign(new EventEmitter(), {pid:123,exitCode:null,signalCode:null});
 const channel = Object.assign(new EventEmitter(), {setEncoding(){},destroy(){this.destroyed=true;},write(){},destroyed:false});
 const driver = new VzDriver(child, channel, '/fake', {}, async () => { throw new Error('not dialing'); });
 let stopped = 0;
 driver.onStopped(()=>stopped++);
 return {driver,child,channel,get stopped(){return stopped;}};
};
test('Vz baseline: actual helper exit is VM termination, once', () => {
 const w = world(); w.child.emit('exit', 1, null); w.channel.emit('close'); assert.equal(w.stopped,1);
});
test('Vz owner: channel EOF is not helper or VM death', async () => {
 const w=world(); const query=w.driver.start();
 const rejection=assert.rejects(query,/helper ended/);
 w.channel.emit('close'); await rejection;
 assert.equal(w.child.exitCode,null); assert.equal(w.child.signalCode,null);
 assert.equal(w.stopped,0,'EOF released the VM before actual helper exit');
 w.child.emit('exit',1,null); assert.equal(w.stopped,1);
});
for (const response of ['null\n', '[]\n', '{"id":1,"ok":"true"}\n', '{"event":"stopped","cause":"unknown"}\n'])
 test(`DR42 Vz: malformed helper response ${response.trim()} ends requests without asserting VM death`, async () => {
  const w = world(), refused = assert.rejects(w.driver.start(), {code:'BROKER_UNAVAILABLE'});
  w.channel.emit('data', response); await refused;
  assert.equal(w.channel.destroyed, true); assert.equal(w.stopped, 0);
  w.child.emit('exit', 1, null); assert.equal(w.stopped, 1);
 });
