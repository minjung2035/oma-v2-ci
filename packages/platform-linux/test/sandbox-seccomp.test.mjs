/** SB-001, MAC-205 / MV-20, P0V-102: the sandbox filter refuses the kernel
 * objects no namespace confines, by every call that makes them.
 *
 * Two layers. The program's decisions are read by evaluating it -- for each
 * architecture, each refused call, the vsock domain, the calls a program
 * needs, x32 and another ABI -- which does not depend on how this kernel is
 * configured. Then the program runs in bubblewrap, and each refusal is set
 * beside the same call without the filter, where the kernel answers it:
 * the difference is the filter's. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SANDBOX_REFUSALS, SECCOMP_ABIS, sandboxSeccompFilter } from "@oma/platform-linux/sandbox-seccomp";
const ALLOW = 0x7fff0000;
const EPERM = 0x00050001;
/** The classic BPF subset the filter uses, over one struct seccomp_data. */
function decide(filter, data) {
    let accumulator = 0;
    for (let pc = 0; pc * 8 < filter.length;) {
        const code = filter.readUInt16LE(pc * 8), jt = filter.readUInt8(pc * 8 + 2), jf = filter.readUInt8(pc * 8 + 3), k = filter.readUInt32LE(pc * 8 + 4);
        if (code === 0x20) {
            accumulator = k === 0 ? data.nr >>> 0 : k === 4 ? data.arch >>> 0 : k === 16 ? data.arg0 >>> 0 : NaN;
            pc += 1;
        }
        else if (code === 0x15)
            pc += 1 + (accumulator === k ? jt : jf);
        else if (code === 0x45)
            pc += 1 + ((accumulator & k) !== 0 ? jt : jf);
        else if (code === 0x06)
            return k;
        else
            throw new Error(`unexpected instruction ${code.toString(16)} at ${pc}`);
    }
    throw new Error("the program fell off its end");
}
test("SB-001, P0V-102: the filter refuses every listed call on each architecture, and lets a program's ordinary calls pass", () => {
    // Named here, not read from the table, so an entry dropped from it is caught.
    const refused = {
        x64: { io_uring_setup: 425, io_uring_enter: 426, io_uring_register: 427, add_key: 248, request_key: 249, keyctl: 250,
            bpf: 321, perf_event_open: 298, userfaultfd: 323 },
        arm64: { io_uring_setup: 425, io_uring_enter: 426, io_uring_register: 427, add_key: 217, request_key: 218, keyctl: 219,
            bpf: 280, perf_event_open: 241, userfaultfd: 282 },
    };
    const sockets = { x64: [41, 53], arm64: [198, 199] };
    const ordinary = { x64: [0, 1, 2, 3, 9, 56, 57, 59, 61, 257, 435], arm64: [63, 64, 56, 57, 220, 221, 260, 222, 435] };
    for (const abi of ["x64", "arm64"]) {
        const filter = sandboxSeccompFilter(abi);
        const { arch } = SECCOMP_ABIS[abi];
        for (const [name, nr] of Object.entries(refused[abi]))
            assert.equal(decide(filter, { arch, nr, arg0: 0 }), EPERM, `${abi} ${name}`);
        for (const nr of sockets[abi]) {
            assert.equal(decide(filter, { arch, nr, arg0: 40 }), EPERM, `${abi} ${nr}(AF_VSOCK)`);
            for (const domain of [1, 2, 10, 16])
                assert.equal(decide(filter, { arch, nr, arg0: domain }), ALLOW, `${abi} ${nr}(${domain})`);
        }
        for (const nr of ordinary[abi])
            assert.equal(decide(filter, { arch, nr, arg0: 40 }), ALLOW, `${abi} call ${nr}`);
        // Another ABI's calls are refused whole: their numbers are not these.
        assert.equal(decide(filter, { arch: 0x40000003, nr: 359, arg0: 40 }), EPERM, `${abi}: an i386 call`);
    }
    // x32 reports x86_64's architecture with the call number offset.
    const x64 = sandboxSeccompFilter("x64");
    for (const nr of [39, 41, 0, 1])
        assert.equal(decide(x64, { arch: SECCOMP_ABIS.x64.arch, nr: 0x40000000 | nr, arg0: 40 }), EPERM, `x32 call ${nr}`);
    assert.equal(SANDBOX_REFUSALS.length, 6);
    assert.throws(() => sandboxSeccompFilter("ia32"));
});
const probe = `
import ctypes, errno, socket, sys
libc = ctypes.CDLL(None, use_errno=True)
libc.syscall.restype = ctypes.c_long
X64 = sys.argv[1] == "x64"
def call(nr, *args):
    ctypes.set_errno(0)
    result = libc.syscall(ctypes.c_long(nr), *[ctypes.c_long(a) for a in args])
    return "ok" if result >= 0 else errno.errorcode.get(ctypes.get_errno(), str(ctypes.get_errno()))
def sock(family, pair=False):
    try:
        (socket.socketpair(family, socket.SOCK_STREAM) if pair else socket.socket(family, socket.SOCK_STREAM))
        return "ok"
    except OSError as error:
        return errno.errorcode.get(error.errno, str(error.errno))
params = ctypes.create_string_buffer(120)
report = {
  "vsock": sock(40), "vsockpair": sock(40, True), "unix": sock(socket.AF_UNIX), "inet": sock(socket.AF_INET),
  "io_uring": call(425, 1, ctypes.addressof(params)),
  "keyring": call(250 if X64 else 219, 0, -4, 0),
  "perf": call(298 if X64 else 241, 0, 0, -1, -1, 0),
}
if X64: report["x32"] = call(0x40000000 | 39)
print(" ".join(f"{key}={value}" for key, value in report.items()))
`;
const usable = spawnSync("bwrap", ["--ro-bind", "/", "/", "--dev", "/dev", "--unshare-net", "true"]).status === 0 &&
    spawnSync("python3", ["-c", "import socket; socket.socket(40, socket.SOCK_STREAM)"]).status === 0;
function inSandbox(filter) {
    const dir = mkdtempSync(join(tmpdir(), "oma-seccomp-"));
    try {
        const path = join(dir, "filter.bpf");
        writeFileSync(path, filter ?? Buffer.alloc(0));
        const fd = openSync(path, "r");
        try {
            const run = spawnSync("bwrap", ["--ro-bind", "/", "/", "--dev", "/dev", "--unshare-net", ...(filter === null ? [] : ["--seccomp", "3"]),
                "python3", "-c", probe, process.arch], { stdio: ["ignore", "pipe", "pipe", fd], encoding: "utf8" });
            assert.equal(run.status, 0, run.stderr);
            return Object.fromEntries(run.stdout.trim().split(" ").map(pair => pair.split("=")));
        }
        finally {
            closeSync(fd);
        }
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
}
test("MAC-205/MV-20, P0V-102: in the sandbox each listed effect is refused where the kernel would have made it, and other sockets are made", { skip: usable ? false : "bubblewrap or a vsock-capable python is not available" }, () => {
    const without = inSandbox(null);
    const within = inSandbox(sandboxSeccompFilter());
    // Without the filter the kernel makes a vsock socket (it has no vsock socketpair).
    assert.equal(without.vsock, "ok");
    assert.match(without.vsockpair, /^E(OP)?NOTSUPP?$/);
    assert.deepEqual([within.vsock, within.vsockpair, within.unix, within.inet], ["EPERM", "EPERM", "ok", "ok"]);
    // io_uring: the way a vsock socket is made without the socket call.
    assert.equal(within.io_uring, "EPERM");
    // The keyring the sandbox shares with its user; the kernel answers without the filter.
    assert.equal(within.keyring, "EPERM");
    assert.notEqual(without.keyring, "EPERM");
    // A perf event: the kernel refuses the null attribute, the filter the call.
    assert.equal(within.perf, "EPERM");
    assert.notEqual(without.perf, "EPERM");
    if (process.arch === "x64") {
        // x32's getpid: the kernel runs it or does not know it; the filter refuses it.
        assert.equal(within.x32, "EPERM");
        assert.notEqual(without.x32, "EPERM");
    }
    // Where this kernel lets a process make an io_uring, the filter is what refuses it.
    if (without.io_uring === "ok")
        assert.equal(within.io_uring, "EPERM");
});
