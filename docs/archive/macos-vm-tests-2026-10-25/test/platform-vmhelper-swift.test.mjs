// AV-26/P0-4: the vmhelper's bridge setup is a partial-construction path. The
// guest's first connection builds one PortBridge per configured port; when a
// later bridge throws, every bridge already made must be closed or its
// listener/path is leaked into the VM's run directory until reboot.
//
// This oracle reads the Swift source: Virtualization.framework cannot build or
// run on this host (Linux), so the regression is pinned structurally -- a
// rollback collection that is closed on the throw path, plus each
// PortBridge.init failure path closing its own listener before it throws.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('packages/platform-mac/src/vmhelper/Sources/oma-vmhelper/main.swift', 'utf8');

// The construction site inside start(): everything between the socket-device
// lookup and the "channel could not be opened" refusal.
const site = source.match(/VZVirtioSocketDevice else \{ refuse\(id, "the engine has no channel"\)[\s\S]*?could not be opened"\) \}/);
assert.ok(site, 'the bridge-construction site was found in main.swift');
const block = site[0];

test('AV-26: bridges are built into a rollback collection, not assigned as they are made', () => {
  assert.match(block, /var made: \[PortBridge\] = \[\]/, 'a partial collection holds bridges made so far');
  assert.match(block, /made\.append\(try PortBridge\(/, 'each bridge is appended as it is made');
  assert.match(block, /bridges = made\b/, 'the live set only changes once every bridge exists');
});

test('AV-26: a bridge that cannot be made closes every bridge made before it', () => {
  const catch_ = block.match(/catch \{[\s\S]*?\}[\s\S]*?throw error/);
  assert.ok(catch_, 'the build loop has a catch that rethrows');
  assert.match(catch_[0], /for bridge in made \{ bridge\.close\(\) \}/, 'every earlier bridge is closed before the throw');
  assert.doesNotMatch(block, /bridges = try config\.ports\.map/, 'the throw can no longer orphan earlier bridges');
});

test('AV-26: PortBridge.init closes its own listener on every failure it can observe', () => {
  const init = source.match(/init\(port: UInt32, path: String, device: VZVirtioSocketDevice\) throws \{[\s\S]*?thread\.start\(\)/);
  assert.ok(init, 'PortBridge.init was found');
  const throws = init[0].match(/close\(\); throw POSIXError/g) ?? [];
  assert.equal(throws.length >= 2, true, 'name-too-long and bind/chmod/listen failures each close first');
});
