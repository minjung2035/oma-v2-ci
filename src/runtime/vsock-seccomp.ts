/** MAC-205 (§12 D-5): a seccomp filter for the Resident sandbox that refuses
 * `socket()` and `socketpair()` in the AF_VSOCK domain with EPERM, and allows
 * everything else. vsock is not confined by a network namespace on every
 * kernel, so it is refused by the system call, not by the namespace.
 *
 * Classic BPF, a few fixed instructions, for bubblewrap's `--seccomp <fd>`:
 * a process of any other architecture (a 32-bit ABI, where the call numbers
 * differ) is refused every call rather than let past the check. Not wired
 * into the sandbox until D-5 is decided.
 */
import { StoreError } from "../domain/errors.js";

const AF_VSOCK = 40;
const EPERM = 1;
const SECCOMP_RET_ALLOW = 0x7fff0000;
const SECCOMP_RET_ERRNO = 0x00050000;
const LD_W_ABS = 0x20;   // BPF_LD | BPF_W | BPF_ABS
const JEQ_K = 0x15;      // BPF_JMP | BPF_JEQ | BPF_K
const RET_K = 0x06;      // BPF_RET | BPF_K
/** struct seccomp_data: nr at 0, arch at 4, args[0] at 16 (its low word on these little-endian ABIs). */
const OFFSET = { nr: 0, arch: 4, arg0: 16 } as const;

export const SECCOMP_ABIS = Object.freeze({
  x64: { arch: 0xc000003e, socket: 41, socketpair: 53 },     // AUDIT_ARCH_X86_64
  arm64: { arch: 0xc00000b7, socket: 198, socketpair: 199 }, // AUDIT_ARCH_AARCH64
});

function instruction(code: number, jt: number, jf: number, k: number): Buffer {
  const value = Buffer.alloc(8);
  value.writeUInt16LE(code, 0); value.writeUInt8(jt, 2); value.writeUInt8(jf, 3); value.writeUInt32LE(k >>> 0, 4);
  return value;
}

/** The filter for this machine's architecture, as bubblewrap reads it. */
export function vsockSeccompFilter(machine: string = process.arch): Buffer {
  const abi = machine === "x64" ? SECCOMP_ABIS.x64 : machine === "arm64" ? SECCOMP_ABIS.arm64 : null;
  if (abi === null) throw new StoreError("UNSUPPORTED_PROFILE", "no sandbox filter for this architecture");
  const deny = SECCOMP_RET_ERRNO | EPERM;
  return Buffer.concat([
    /* 0 */ instruction(LD_W_ABS, 0, 0, OFFSET.arch),
    /* 1 */ instruction(JEQ_K, 1, 0, abi.arch),        // native: 3
    /* 2 */ instruction(RET_K, 0, 0, deny),            // another ABI: refused
    /* 3 */ instruction(LD_W_ABS, 0, 0, OFFSET.nr),
    /* 4 */ instruction(JEQ_K, 1, 0, abi.socket),      // socket: 6
    /* 5 */ instruction(JEQ_K, 0, 3, abi.socketpair),  // socketpair: 6; else 9
    /* 6 */ instruction(LD_W_ABS, 0, 0, OFFSET.arg0),
    /* 7 */ instruction(JEQ_K, 0, 1, AF_VSOCK),        // vsock: 8; else 9
    /* 8 */ instruction(RET_K, 0, 0, deny),
    /* 9 */ instruction(RET_K, 0, 0, SECCOMP_RET_ALLOW),
  ]);
}
