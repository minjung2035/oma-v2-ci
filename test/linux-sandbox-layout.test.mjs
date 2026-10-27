/** Explicit Linux recipe data only; no OS identity or kernel result is replaced. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {residentOptions} from '../dist/test/fixtures/resident.js';
import {residentArgv,SandboxModule} from '@oma/platform-linux/sandbox';
import {residentRootfsPath} from '@oma/platform-linux/resident-rootfs';
const context=()=>residentOptions('/state');
test('Linux confinement derives the owned rootfs and takes mounts outside the common host',()=>{
  const {host,lease,directories}=context().confinement;
  assert.equal(Object.hasOwn(host,'rootfs'),false);assert.equal(Object.hasOwn(host,'systemBinds'),false);
  const args=residentArgv(host,lease,directories,['/usr']);
  const at=args.indexOf('--ro-bind');assert.deepEqual(args.slice(at,at+3),['--ro-bind',residentRootfsPath(host.stateRoot),'/']);
  assert.ok(args.some((value,i)=>value==='--ro-bind'&&args[i+1]==='/usr'&&args[i+2]==='/usr'));
  assert.equal(new SandboxModule(host,[]).resident(lease,directories).argv[0],'bwrap');
});
test('Linux confinement refuses implicit or non-system mount inputs and retired common fields',()=>{
  const {host,lease,directories}=context().confinement;
  for(const mounts of [undefined,null,{},'/usr',['/'],['/home'],['/etc/shadow'],['/tmp'],[123]])
    assert.throws(()=>residentArgv(host,lease,directories,mounts),{code:'UNSUPPORTED_PROFILE'});
  for(const fields of [{rootfs:'/'},{rootfs:undefined},{systemBinds:['/usr']},{systemBinds:undefined}])
    assert.throws(()=>residentArgv({...host,...fields},lease,directories,[]),{code:'UNSUPPORTED_PROFILE'});
});
test('Linux confinement snapshots a mount array once before validating or emitting it',()=>{
  const {host,lease,directories}=context().confinement,changing=[];let reads=0;
  Object.defineProperty(changing,0,{get(){return ++reads===1?'/usr':'/etc/shadow';}});
  const args=residentArgv(host,lease,directories,changing);assert.equal(reads,1);assert.ok(!args.includes('/etc/shadow'));
});
test('Linux confinement refuses a public system mount exposing private state',()=>{
  const {host,lease,directories}=residentOptions('/usr/private-state').confinement;
  assert.throws(()=>residentArgv(host,lease,directories,['/usr']),{code:'UNSUPPORTED_PROFILE'});
});
