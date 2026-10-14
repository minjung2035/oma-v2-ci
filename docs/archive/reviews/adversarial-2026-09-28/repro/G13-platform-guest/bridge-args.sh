#!/usr/bin/env bash
# Compiles oma-vsock-bridge.c and probes its argument / LISTEN_FDS boundaries.
# No real vsock is needed: we only reach the usage/peer checks. Output dir is mkdtemp.
set -u
SRC="/home/dev/oma-v2/platform/guest/bridge/oma-vsock-bridge.c"
WORK="$(mktemp -d /tmp/oma-adv-G13-bridge-XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
BIN="$WORK/oma-vsock-bridge"

echo "== compile (warnings are findings) =="
gcc -Wall -Wextra -O2 -o "$BIN" "$SRC" 2>&1
echo "exit=$?"

echo "== no args (expect usage, exit 2) =="
"$BIN"; echo "exit=$?"

echo "== one arg but no LISTEN_FDS (expect usage, exit 2) =="
"$BIN" /tmp/nonexistent.sock; echo "exit=$?"

echo "== LISTEN_FDS=1 LISTEN_PID mismatched (expect usage, exit 2) =="
LISTEN_FDS=1 LISTEN_PID=999999 "$BIN" /tmp/nonexistent.sock; echo "exit=$?"

echo "== LISTEN_FDS=2 (more than one fd; expect usage, exit 2) =="
LISTEN_FDS=2 LISTEN_PID=$$ "$BIN" /tmp/nonexistent.sock; echo "exit=$?"

echo "== oversized socket path (>108 bytes) with valid LISTEN vars =="
LONG="$WORK/$(python3 -c 'print("a"*200)')"
# fd 3 is not a vsock here; peer_is_host will getpeername-fail -> exit 3 before connect.
LISTEN_FDS=1 LISTEN_PID=$$ "$BIN" "$LONG" 3<&0; echo "exit=$? (fd3=stdin, not vsock)"
