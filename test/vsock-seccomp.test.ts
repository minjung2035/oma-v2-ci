/** MAC-205 / MV-20: inside bubblewrap with the filter, an AF_VSOCK socket
 * cannot be made (EPERM) while other sockets can; without the filter the same
 * program makes one, so the refusal is the filter's. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SECCOMP_ABIS, vsockSeccompFilter } from "../src/runtime/vsock-seccomp.js";

const probe = `
import errno, socket, sys
def attempt(family, kind, pair=False):
    try:
        (socket.socketpair(family, kind) if pair else socket.socket(family, kind))
        return "made"
    except OSError as error:
        return errno.errorcode.get(error.errno, str(error.errno))
print(attempt(40, socket.SOCK_STREAM), attempt(40, socket.SOCK_STREAM, True), attempt(socket.AF_UNIX, socket.SOCK_STREAM), attempt(socket.AF_INET, socket.SOCK_STREAM))
`;
const usable = spawnSync("bwrap", ["--ro-bind", "/", "/", "--dev", "/dev", "--unshare-net", "true"]).status === 0 &&
  spawnSync("python3", ["-c", "import socket; socket.socket(40, socket.SOCK_STREAM)"]).status === 0;

function inSandbox(filter: Buffer | null): string {
  const dir = mkdtempSync(join(tmpdir(), "oma-seccomp-"));
  try {
    const path = join(dir, "filter.bpf");
    writeFileSync(path, filter ?? Buffer.alloc(0));
    const fd = openSync(path, "r");
    try {
      const run = spawnSync("bwrap", ["--ro-bind", "/", "/", "--dev", "/dev", "--unshare-net", ...(filter === null ? [] : ["--seccomp", "3"]),
        "python3", "-c", probe], { stdio: ["ignore", "pipe", "pipe", fd], encoding: "utf8" });
      assert.equal(run.status, 0, run.stderr);
      return run.stdout.trim();
    } finally { closeSync(fd); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("MAC-205: the filter is the fixed program for this architecture", () => {
  const filter = vsockSeccompFilter();
  assert.equal(filter.length, 10 * 8);
  assert.throws(() => vsockSeccompFilter("ia32"));
  assert.notDeepEqual(vsockSeccompFilter("x64"), vsockSeccompFilter("arm64"));
  assert.ok(SECCOMP_ABIS.arm64.socket === 198);
});

test("MAC-205/MV-20: in the sandbox with the filter, vsock is refused and nothing else is", { skip: usable ? false : "bubblewrap or a vsock-capable python is not available" }, () => {
  // The kernel itself has no vsock socketpair; the filter answers first.
  assert.match(inSandbox(null), /^made E(OP)?NOTSUPP? made made$/, "without the filter the same program makes a vsock socket");
  assert.equal(inSandbox(vsockSeccompFilter()), "EPERM EPERM made made");
});
