#!/usr/bin/env python3
"""Measure real PTY input/response with isolated OMA state and a local provider.
Run serially after `npm run build`; requires Python 3 and a user systemd manager
for Society. No existing credentials or state are used. Artifacts stay in /tmp.
"""
import argparse
import fcntl
import json
import math
import os
from pathlib import Path
import pty
import select
import signal
import sqlite3
import struct
import tempfile
import termios
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--mode', choices=['society', 'personal'], default='society')
parser.add_argument('--node', default='node')
parser.add_argument('--project', default=os.getcwd())
parser.add_argument('--runs', type=int, default=3)
parser.add_argument('--budget', type=float, default=5)
parser.add_argument('--wait-broker', action='store_true')
parser.add_argument('--early-tool', action='store_true', help='Issue the first Society tool immediately on the first response')
args = parser.parse_args()
if args.runs <= 0:
    parser.error('--runs must be positive; zero measurements cannot pass')
if not math.isfinite(args.budget) or args.budget <= 0:
    parser.error('--budget must be finite and positive')
if args.wait_broker and args.mode != 'society':
    parser.error('--wait-broker requires --mode society')
if args.early_tool and (not args.wait_broker or args.mode != 'society'):
    parser.error('--early-tool requires --wait-broker in society mode')
repository = Path(__file__).resolve().parent.parent
results = []

for iteration in range(args.runs):
    root = Path(tempfile.mkdtemp(prefix='oma-startup-benchmark-'))
    (root / 'home').mkdir()
    (root / 'data').mkdir()
    pid, master = pty.fork()
    if pid == 0:
        os.execvp(args.node, [args.node, str(repository / 'test/fixtures/startup-pty.mjs'), str(root), args.mode, str(Path(args.project).resolve()),
                             'wait-broker' if args.wait_broker else '', 'early-tool' if args.early_tool else ''])
    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 30, 120, 0, 0))
    output = bytearray()
    start = None
    screen = response = broker = None
    sent = authority_sent = quit_at = None
    status = None
    deadline = time.monotonic() + 150
    try:
        while time.monotonic() < deadline:
            if start is None and (root / 'launch.json').exists():
                start = int(json.loads((root / 'launch.json').read_text())['monotonicNs']) / 1e9
            readable, _, _ = select.select([master], [], [], 0.02)
            if readable:
                try:
                    output.extend(os.read(master, 65536))
                except OSError:
                    pass
            now = time.monotonic()
            if start is not None:
                if screen is None and b"Your ideas, in motion" in output:
                    screen = now - start
                # Let the screen's ready notification reach the host before
                # sending ordinary terminal input through its actual editor.
                if screen is not None and sent is None and now - start > screen + 0.08:
                    os.write(master, b'Reply with the startup probe result.\r')
                    sent = now
                if response is None and b'OMA_STARTUP_RESPONSE_COMPLETE' in output:
                    response = now - start
                if broker is None and (root / 'broker.json').exists():
                    broker = json.loads((root / 'broker.json').read_text())['seconds']
                if args.wait_broker and not args.early_tool and broker is not None and response is not None and authority_sent is None and now - start > broker + 0.2:
                    os.write(master, b'Verify the prepared society.\r')
                    authority_sent = now
                if response is not None and quit_at is None and (not args.wait_broker or b'OMA_STARTUP_BROKER_TOOL_COMPLETE' in output):
                    os.write(master, b'\x04')
                    quit_at = now
            done, raw = os.waitpid(pid, os.WNOHANG)
            if done:
                status = raw
                break
            if quit_at is not None and now - quit_at > 10:
                break
            if response is None and start is not None and now - start > 20:
                break
        if status is None:
            os.killpg(pid, signal.SIGTERM)
            end = time.monotonic() + 2
            while time.monotonic() < end:
                done, raw = os.waitpid(pid, os.WNOHANG)
                if done:
                    status = raw
                    break
                time.sleep(0.02)
            if status is None:
                os.killpg(pid, signal.SIGKILL)
                _, status = os.waitpid(pid, 0)
    finally:
        os.close(master)
        (root / 'terminal.log').write_bytes(output)
    request = json.loads((root / 'request.json').read_text())['seconds'] if (root / 'request.json').exists() else None
    authority_seconds = authority_state = None
    if (root / 'authority.json').exists():
        authority = json.loads((root / 'authority.json').read_text())
        authority_seconds = authority['seconds']
        databases = list((root / 'data/oma').glob('*/runtime.sqlite'))
        if len(databases) == 1:
            with sqlite3.connect(databases[0].as_uri() + '?mode=ro', uri=True) as db:
                rows = db.execute('SELECT kind, state FROM operations WHERE actor = ? AND request_key = ?',
                                  ('principal', authority['requestKey'])).fetchall()
            if rows == [('society.set', 'succeeded')]:
                authority_state = 'succeeded-once'
    result = {'mode': args.mode, 'run': iteration + 1, 'artifacts': str(root), 'screenSeconds': screen,
              'requestSeconds': request, 'responseSeconds': response, 'brokerSeconds': broker,
              'brokerToolSeconds': authority_seconds, 'brokerToolState': authority_state,
              'quitSeconds': None if quit_at is None else time.monotonic() - quit_at,
              'exit': os.waitstatus_to_exitcode(status)}
    (root / 'summary.json').write_text(json.dumps(result, indent=2) + '\n')
    results.append(result)
    print(json.dumps(result), flush=True)

# A visible editor does not prove the Society is usable. With --wait-broker,
# enforce the same launch budget on authority readiness, in addition to proving
# that one real operation succeeded. Early tools must finish within it too.
raise SystemExit(0 if all(r['requestSeconds'] is not None and r['requestSeconds'] <= args.budget and
                         r['responseSeconds'] is not None and r['exit'] == 0 and
                         (not args.wait_broker or r['brokerSeconds'] is not None and
                          r['brokerSeconds'] <= args.budget and r['brokerToolState'] == 'succeeded-once') and
                         (not args.early_tool or r['brokerToolSeconds'] is not None and
                          r['brokerToolSeconds'] <= args.budget) for r in results) else 1)
