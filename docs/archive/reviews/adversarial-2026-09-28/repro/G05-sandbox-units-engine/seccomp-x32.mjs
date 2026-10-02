// Analyze the vsock seccomp filter: does it block AF_VSOCK on the x32 ABI and
// on socket domain arg checks with high bits? The BPF is pure data; we decode it.
import { vsockSeccompFilter, SECCOMP_ABIS } from "../../../../dist/src/runtime/vsock-seccomp.js";

const filter = vsockSeccompFilter("x64");
// Decode the classic-BPF program: each instr is 8 bytes: u16 code, u8 jt, u8 jf, u32 k
const instrs = [];
for (let i = 0; i < filter.length; i += 8) {
  instrs.push({
    code: filter.readUInt16LE(i),
    jt: filter.readUInt8(i + 2),
    jf: filter.readUInt8(i + 3),
    k: filter.readUInt32LE(i + 4),
  });
}
console.log("instruction count:", instrs.length);
console.table(instrs.map((x) => ({ code: "0x" + x.code.toString(16), jt: x.jt, jf: x.jf, k: "0x" + x.k.toString(16) })));

const ARCH_X86_64 = 0xc000003e;
const X32_BIT = 0x40000000;
const socketNr = SECCOMP_ABIS.x64.socket; // 41

console.log("\n--- x32 ABI reasoning ---");
console.log("x32 processes report arch == AUDIT_ARCH_X86_64 (0xc000003e):", "0x" + ARCH_X86_64.toString(16));
console.log("The filter's instr[1] JEQ arch=0x" + instrs[1].k.toString(16), "-> matches x32 too (same arch id)");
console.log("But x32 socket() nr = X32_BIT|41 =", "0x" + (X32_BIT | socketNr).toString(16), "=", (X32_BIT | socketNr));
console.log("instr[4] JEQ socket nr =", instrs[4].k, "-> x32 socket nr does NOT equal", instrs[4].k);
console.log("=> an x32 socket() call falls through JEQ(socket) and JEQ(socketpair) to the final ALLOW.");
console.log("Conclusion: if x32 ABI syscalls are reachable in the sandbox, AF_VSOCK socket() via x32 is NOT filtered.");

console.log("\n--- socket arg0 high-word / x32 pointer note ---");
console.log("Filter loads arg0 low word at offset 16 and compares to AF_VSOCK(40). Domain is an int, low word is correct on LE.");
