// DR27/P0-5: actual driver wiring with controlled child/channel observations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { Script } from 'node:vm';
import ts from 'typescript';
const code = ts.transpileModule(readFileSync('src/platform/host/vz-driver.ts', 'utf8'), {compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
class StoreError extends Error { constructor(code, message) { super(message); this.code = code; } }
const module_ = {exports: {}};
new Script(code).runInNewContext({exports:module_.exports,module:module_,require(name) {
  if(name==='node:path') return {join:(...p)=>p.join('/')};
  if(name==='../../domain/errors.js') return {StoreError};
  if(name==='../rpc.js'||name==='../../process/async.js') return {};
  throw new Error(name);
}});
const {VzDriver} = module_.exports;
const world = () => {
 const child = Object.assign(new EventEmitter(), {pid:123,exitCode:null,signalCode:null});
 const channel = Object.assign(new EventEmitter(), {setEncoding(){},destroy(){this.destroyed=true;},write(){},destroyed:false});
 const driver = new VzDriver(child, channel, '/fake', {});
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
