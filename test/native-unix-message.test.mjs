import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, closeSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { controlSocketPair } from '@oma/native/control-socket';
import { enableUnixCredentials, receiveUnixMessage } from '@oma/native/unix-message';
assert.equal(process.platform, 'linux');
test('recvmsg actual ABI and delivered forbidden SCM_RIGHTS return every duplicated descriptor', () => {
  const root = mkdtempSync(join(tmpdir(), 'oma-real-recvmsg-')), binary = join(root, 'message');
  try {
    execFileSync('/usr/bin/cc', ['-Wall', '-Wextra', '-Werror', fileURLToPath(new URL('./fixtures/unix-message.c', import.meta.url)), '-o', binary]);
    const pair = controlSocketPair();
    try {
      enableUnixCredentials(pair.parent); const before = readdirSync('/proc/self/fd').sort();
      for (let n = 0; n < 32; n++) {
        execFileSync(binary, ['rights'], { stdio: ['ignore', 'ignore', 'inherit', pair.child] });
        const result = receiveUnixMessage(pair.parent);
        assert.equal(result.kind, 'data'); assert.equal(result.ancillary, true); assert.equal(result.bytes.toString(), 'x');
        assert.ok(result.sender.pid > 1); assert.equal(result.sender.uid, process.getuid());
        assert.deepEqual(readdirSync('/proc/self/fd').sort(), before, 'all 64 kernel-delivered FDs were closed exactly once');
      }
      assert.throws(() => execFileSync(binary, ['forged'], { stdio: ['ignore', 'ignore', 'inherit', pair.child] }), error => error.status === 13);
      assert.deepEqual(receiveUnixMessage(pair.parent), { kind: 'again' }, 'forged sender bytes were rejected by the kernel');
      assert.deepEqual(readdirSync('/proc/self/fd').sort(), before);
    } finally { closeSync(pair.parent); closeSync(pair.child); }
  } finally { rmSync(root, { recursive: true }); }
});
