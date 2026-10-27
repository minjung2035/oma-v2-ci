/** WP27: the one bubblewrap a confined engine is started through; the same
 * binary `spawnSandboxed` pins. A plan names it absolutely, because the
 * owned spawn that delivers a batch accepts no PATH lookup. */
export const SANDBOX_EXECUTABLE = "/usr/bin/bwrap";

/** The descriptor bubblewrap reads the sandbox's seccomp program from. */
export const SANDBOX_FILTER_FD = 3;


/** SB-001, MAC-205 (DR18 D-5, P0V-102): the seccomp filter every Resident
 * sandbox loads. It refuses the kernel objects no namespace confines -- what
 * a sandboxed process could make that the host, the hypervisor or every other
 * process of the user would share -- by every system call that makes them,
 * and every call of an ABI whose numbers it does not check:
 *
 * - a vsock socket: vsock is not confined by a network namespace on every
 *   kernel, and reaches the hypervisor and the host (MAC-205);
 * - an io_uring instance: it makes sockets without the socket call
 *   (IORING_OP_SOCKET), so refusing socket(AF_VSOCK) alone is no refusal;
 * - a key in the kernel keyring: keyrings belong to the uid, which the
 *   sandbox shares with the host user, and so does their quota;
 * - a BPF program or map, a perf event, a userfaultfd: kernel objects of
 *   the machine, not of a namespace;
 * - a call of another ABI: a 32-bit process, or x32 on x86_64 (the same
 *   audit architecture, with call numbers offset by `__X32_SYSCALL_BIT`),
 *   whose numbers these checks would not match.
 *
 * Everything else is allowed: the namespaces, the mounts and the dropped
 * capabilities confine it. The list is the one in SB-001; a call is added
 * here and there together.
 *
 * Classic BPF for bubblewrap's `--seccomp 3` (`SANDBOX_FILTER_FD`); refused
 * calls fail with EPERM, as a program expects of a call it may not make.
 */
import { StoreError } from "@oma/domain/errors";

const AF_VSOCK = 40;
const EPERM = 1;
const X32_SYSCALL_BIT = 0x40000000;
const SECCOMP_RET_ALLOW = 0x7fff0000;
const SECCOMP_RET_ERRNO = 0x00050000;
const LD_W_ABS = 0x20;   // BPF_LD | BPF_W | BPF_ABS
const JEQ_K = 0x15;      // BPF_JMP | BPF_JEQ | BPF_K
const JSET_K = 0x45;     // BPF_JMP | BPF_JSET | BPF_K
const RET_K = 0x06;      // BPF_RET | BPF_K
/** struct seccomp_data: nr at 0, arch at 4, args[0] at 16 (its low word on these little-endian ABIs). */
const OFFSET = { nr: 0, arch: 4, arg0: 16 } as const;

/** What the filter refuses, by the effect, with the calls that make it on
 * each architecture. `socketDomain` calls are refused only for AF_VSOCK. */
export const SANDBOX_REFUSALS = Object.freeze([
  { effect: "a vsock socket", socketDomain: true, x64: [41, 53], arm64: [198, 199] },               // socket, socketpair
  { effect: "an io_uring instance", socketDomain: false, x64: [425, 426, 427], arm64: [425, 426, 427] }, // setup, enter, register
  { effect: "a key in the kernel keyring", socketDomain: false, x64: [248, 249, 250], arm64: [217, 218, 219] }, // add_key, request_key, keyctl
  { effect: "a BPF program or map", socketDomain: false, x64: [321], arm64: [280] },                 // bpf
  { effect: "a perf event", socketDomain: false, x64: [298], arm64: [241] },                         // perf_event_open
  { effect: "a userfaultfd", socketDomain: false, x64: [323], arm64: [282] },                        // userfaultfd
] as const);

export const SECCOMP_ABIS = Object.freeze({
  x64: { arch: 0xc000003e, x32: true },     // AUDIT_ARCH_X86_64; x32 shares it
  arm64: { arch: 0xc00000b7, x32: false },  // AUDIT_ARCH_AARCH64
});

interface Instruction { readonly code: number; readonly k: number; readonly jt?: string; readonly jf?: string; readonly label?: string }

function assemble(program: readonly Instruction[]): Buffer {
  const at = new Map(program.flatMap((step, index) => step.label === undefined ? [] : [[step.label, index] as const]));
  const offset = (from: number, label: string | undefined): number => {
    if (label === undefined) return 0;
    const target = at.get(label);
    if (target === undefined || target <= from || target - from - 1 > 255) throw new StoreError("INTERNAL_ERROR", `sandbox filter jump to ${label} cannot be encoded`);
    return target - from - 1;
  };
  return Buffer.concat(program.map((step, index) => {
    const value = Buffer.alloc(8);
    value.writeUInt16LE(step.code, 0);
    value.writeUInt8(offset(index, step.jt), 2);
    value.writeUInt8(offset(index, step.jf), 3);
    value.writeUInt32LE(step.k >>> 0, 4);
    return value;
  }));
}

/** The filter for this machine's architecture, as bubblewrap reads it. */
export function sandboxSeccompFilter(machine: string = process.arch): Buffer {
  const abi = machine === "x64" ? "x64" : machine === "arm64" ? "arm64" : null;
  if (abi === null) throw new StoreError("UNSUPPORTED_PROFILE", "no sandbox filter for this architecture");
  const { arch, x32 } = SECCOMP_ABIS[abi];
  const whole = SANDBOX_REFUSALS.filter(entry => !entry.socketDomain).flatMap(entry => entry[abi]);
  const socketCalls = SANDBOX_REFUSALS.filter(entry => entry.socketDomain).flatMap(entry => entry[abi]);
  const program: Instruction[] = [
    { code: LD_W_ABS, k: OFFSET.arch },
    { code: JEQ_K, k: arch, jf: "deny" },            // another ABI: refused
    { code: LD_W_ABS, k: OFFSET.nr },
    ...(x32 ? [{ code: JSET_K, k: X32_SYSCALL_BIT, jt: "deny" }] : []),
    ...whole.map(nr => ({ code: JEQ_K, k: nr, jt: "deny" })),
    ...socketCalls.map(nr => ({ code: JEQ_K, k: nr, jt: "domain" })),
    { code: RET_K, k: SECCOMP_RET_ALLOW },
    { code: LD_W_ABS, k: OFFSET.arg0, label: "domain" },
    { code: JEQ_K, k: AF_VSOCK, jt: "deny" },
    { code: RET_K, k: SECCOMP_RET_ALLOW },
    { code: RET_K, k: SECCOMP_RET_ERRNO | EPERM, label: "deny" },
  ];
  return assemble(program);
}
