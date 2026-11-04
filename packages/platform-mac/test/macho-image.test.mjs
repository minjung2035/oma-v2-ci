import test from "node:test";
import assert from "node:assert/strict";
import { machoImageCdHashes } from "@oma/platform-mac/macho-image";

// Code-signature metadata emitted independently by Zig 0.17.0's Mach-O
// linker for `int main(void) { return 0; }`, arm64, on Linux. Golden CDHash
// cross-checked with Python hashlib. Repacking this metadata below tests the
// decoder only: these synthetic images are never signature/kernel proof.
const signature = Buffer.from("fade0cc000000103000000010000000000000014fade0c02000000ef00020400000200020000006f0000005800000000000000040000c2002002000e0000000000000000000000000000000000000000000000000000000000000000000000000000153000000000000000016f6d612d6d6163686f2d7061727365722d61726d3634006011d4ffe1ede407167fe44f687cde086f0240dd875b5b8eebda67fa1b33e80b4fe7b59af6de3b665b67788cc2f99892ab827efae3a467342b3bb4e3bc8e5bfe4fe7b59af6de3b665b67788cc2f99892ab827efae3a467342b3bb4e3bc8e5bfe3691e15603aeaefd450748cdc03100b42331355675c39d2e2fec513ec82bc5fa0000000000", "hex");
const golden = "91457be56f4127505642bc9ee09cb00e69199dd9", alternate = "dc571e8add64c3b70099c52defd44c74e7253a5a";
function thin(cpu = 0x0100000c, changed = false) {
  const bytes = Buffer.alloc(64 + signature.length); bytes.writeUInt32LE(0xfeedfacf); bytes.writeUInt32LE(cpu, 4);
  bytes.writeUInt32LE(2, 12); bytes.writeUInt32LE(1, 16); bytes.writeUInt32LE(16, 20);
  bytes.writeUInt32LE(0x1d, 32); bytes.writeUInt32LE(16, 36); bytes.writeUInt32LE(64, 40);
  bytes.writeUInt32LE(signature.length, 44); signature.copy(bytes, 64);
  if (changed) bytes[64 + 258] ^= 1;
  return bytes;
}
function universal(wide, little) {
  const arm = thin(), intel = thin(0x01000007, true), entry = wide ? 32 : 20, end = 8 + entry * 2;
  const bytes = Buffer.alloc(end + arm.length + intel.length);
  const word = (value, at) => little ? bytes.writeUInt32LE(value, at) : bytes.writeUInt32BE(value, at);
  const integer = (value, at) => little ? bytes.writeBigUInt64LE(BigInt(value), at) : bytes.writeBigUInt64BE(BigInt(value), at);
  word(wide ? 0xcafebabf : 0xcafebabe, 0); word(2, 4);
  for (const [index, cpu, offset, image] of [[0, 0x0100000c, end, arm], [1, 0x01000007, end + arm.length, intel]]) {
    const at = 8 + index * entry; word(cpu, at);
    if (wide) { integer(offset, at + 8); integer(image.length, at + 16); }
    else { word(offset, at + 8); word(image.length, at + 12); }
    image.copy(bytes, offset);
  }
  return bytes;
}

test("001. Held Mach-O bytes select the exact CodeDirectory digest independently of later source mutation", () => {
  const bytes = thin(), hashes = machoImageCdHashes(bytes, "arm64");
  assert.deepEqual(hashes, [golden]); assert.ok(Object.isFrozen(hashes));
  bytes[64 + 258] ^= 1; assert.deepEqual(hashes, [golden]);
  assert.deepEqual(machoImageCdHashes(bytes, "arm64"), [alternate]);
  assert.throws(() => machoImageCdHashes(bytes, "x64"), { code: "UNSUPPORTED_PROFILE" });
  // Metadata extraction alone cannot validate signed pages: a page mutation
  // outside the signature leaves the selected CDHash unchanged.
  bytes[50] ^= 1; assert.deepEqual(machoImageCdHashes(bytes, "arm64"), [alternate]);
});

test("002. Universal 32/64-bit offset tables select only the requested CPU for either byte order", () => {
  for (const wide of [false, true]) for (const little of [false, true]) {
    const bytes = universal(wide, little);
    assert.deepEqual(machoImageCdHashes(bytes, "arm64"), [golden]);
    assert.deepEqual(machoImageCdHashes(bytes, "x64"), [alternate]);
  }
});

test("003. Ambiguous, overlapping, truncated and unsupported signature selections are refused", () => {
  const edits = [bytes => bytes.writeUInt32LE(0, 16), bytes => bytes.writeUInt32LE(0xffffffff, 20),
    bytes => bytes.writeUInt32LE(8, 36), bytes => bytes.writeUInt32LE(0, 40),
    bytes => bytes.writeUInt32LE(0xffffffff, 44), bytes => bytes.writeUInt32BE(0xffffffff, 68),
    bytes => bytes.writeUInt32BE(65, 72), bytes => bytes.writeUInt32BE(1, 76),
    bytes => bytes.writeUInt32BE(0, 80), bytes => bytes.writeUInt32BE(0x20700, 92),
    bytes => { bytes[64 + 20 + 37] = 9; }, bytes => { bytes[64 + 20 + 36] = 1; },
    bytes => bytes.writeUInt32BE(1, 64 + 20 + 16), bytes => bytes.writeUInt32BE(0xffffffff, 64 + 20 + 28)];
  for (const edit of edits) {
    const bytes = thin(); edit(bytes); assert.throws(() => machoImageCdHashes(bytes, "arm64"), { code: "UNSUPPORTED_PROFILE" });
  }
  for (const length of [0, 7, 31, 47, 64, 80, 100])
    assert.throws(() => machoImageCdHashes(thin().subarray(0, length), "arm64"), { code: "UNSUPPORTED_PROFILE" });
  const overlap = universal(false, false); overlap.writeUInt32BE(48, 8 + 20 + 8);
  assert.throws(() => machoImageCdHashes(overlap, "arm64"), { code: "UNSUPPORTED_PROFILE" });
  const excessive = universal(true, false); excessive.writeBigUInt64BE(0xffffffffffffffffn, 16);
  assert.throws(() => machoImageCdHashes(excessive, "arm64"), { code: "UNSUPPORTED_PROFILE" });
  assert.throws(() => machoImageCdHashes(new Uint8Array(new SharedArrayBuffer(128)), "arm64"), { code: "UNSUPPORTED_PROFILE" });
});
