import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Exercise the actual relay with local socketpairs. No host CID, VM, or
// systemd claim: activation and real vsock admission have separate tests.
const harness = String.raw`
import hashlib, json, socket, subprocess, sys, threading
binary, mode = sys.argv[1:]
a, ra = socket.socketpair(); b, rb = socket.socketpair()
for sock in (a, ra, b, rb): sock.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 8192)
child = subprocess.Popen([binary, str(ra.fileno()), str(rb.fileno())], pass_fds=(ra.fileno(), rb.fileno()))
ra.close(); rb.close()
payload = bytes(range(256)) * 4096
reply = bytes(reversed(range(256))) * (4096 if mode != 'half-close' else 1)
if mode == 'reverse': a, b = b, a
errors = []; received = bytearray(); answered = bytearray()
def upload():
    try: a.sendall(payload); a.shutdown(socket.SHUT_WR)
    except OSError as error: errors.append(str(error))
def serve():
    try:
        if mode != 'half-close':
            received.extend(b.recv(4096)); b.sendall(reply)
        while True:
            part = b.recv(65536)
            if not part: break
            received.extend(part)
        if mode == 'half-close': b.sendall(reply)
        b.shutdown(socket.SHUT_WR)
    except OSError as error: errors.append(str(error))
workers = [threading.Thread(target=upload, daemon=True), threading.Thread(target=serve, daemon=True)]
for worker in workers: worker.start()
try:
    a.settimeout(8)
    while True:
        part = a.recv(65536)
        if not part: break
        answered.extend(part)
    for worker in workers: worker.join(8)
    assert not any(worker.is_alive() for worker in workers), 'relay left a direction blocked'
    assert not errors, errors
    assert bytes(received) == payload, 'request bytes lost, repeated, or reordered'
    assert bytes(answered) == reply, 'response bytes lost, repeated, or reordered'
    assert child.wait(timeout=8) == 0, 'relay did not settle both half-closes'
    print(json.dumps({'request': len(received), 'response': len(answered)}))
finally:
    if child.poll() is None: child.kill()
    child.wait()
    for sock in (a, b):
        try: sock.shutdown(socket.SHUT_RDWR)
        except OSError: pass
        sock.close()
    for worker in workers: worker.join(2)
`;

for (const mode of ['forward', 'reverse', 'half-close'])
  test(`Linux bridge: ${mode} preserves complete bytes and half-closes under backpressure`, t => {
    const root = mkdtempSync(join(tmpdir(), 'oma-bridge-relay-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const source = fileURLToPath(new URL('../dist/guest/bridge/oma-vsock-bridge.c', import.meta.url));
    const wrapper = join(root, 'relay.c'), binary = join(root, 'relay');
    writeFileSync(wrapper, `#define main oma_bridge_main\n#include ${JSON.stringify(source)}\n#undef main\n` +
      'int main(int argc, char **argv) { if (argc != 3) return 2; return relay(atoi(argv[1]), atoi(argv[2])) == 0 ? 0 : 5; }\n');
    const built = spawnSync('cc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', wrapper, '-o', binary],
      { encoding: 'utf8', timeout: 30_000 });
    assert.equal(built.error, undefined); assert.equal(built.signal, null); assert.equal(built.status, 0, built.stderr);
    const run = spawnSync('python3', ['-c', harness, binary, mode], { encoding: 'utf8', timeout: 25_000, killSignal: 'SIGKILL' });
    assert.equal(run.error, undefined); assert.equal(run.signal, null); assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout), { request: 1048576, response: mode === 'half-close' ? 256 : 1048576 });
  });
