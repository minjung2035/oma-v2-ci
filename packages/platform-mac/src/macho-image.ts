/** CDHash selection from caller-held image bytes, never a pathname lookup.
 * XNU f6217f89 cs_blobs.h and SDK mach-o/{fat,loader}.h define these layouts.
 * This decodes digests; it validates neither signed pages/CMS nor installation,
 * script/library generations, process identity or authority. The caller must
 * bind its selected bytes, then dynamically validate the stopped kernel image.
 */
import { createHash } from "node:crypto";
import { StoreError } from "@oma/domain/errors";

function refused(): never { throw new StoreError("UNSUPPORTED_PROFILE", "selected image has no supported bounded Mach-O code signature"); }
function span(offset: number, length: number, maximum: number): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset > maximum - length) refused();
}
function directories(signature: Buffer): string[] {
  if (signature.length < 12 || signature.readUInt32BE(0) !== 0xfade0cc0) refused();
  const length = signature.readUInt32BE(4), count = signature.readUInt32BE(8), table = 12 + count * 8;
  if (length > signature.length || count < 1 || count > 64 || table > length) refused();
  const slots = new Set<number>(), ranges: { first: number; last: number }[] = [], hashes: string[] = [];
  for (let index = 0; index < count; index++) {
    const slot = signature.readUInt32BE(12 + index * 8), first = signature.readUInt32BE(16 + index * 8);
    if (slots.has(slot) || first < table) refused(); slots.add(slot); span(first, 8, length);
    const size = signature.readUInt32BE(first + 4); if (size < 8) refused(); span(first, size, length);
    const last = first + size;
    if (ranges.some(range => first < range.last && last > range.first)) refused(); ranges.push({ first, last });
    if (slot !== 0 && !(slot >= 0x1000 && slot < 0x1005)) continue;
    const directory = signature.subarray(first, last);
    if (directory.length < 44 || directory.readUInt32BE(0) !== 0xfade0c02) refused();
    const version = directory.readUInt32BE(8);
    if (version < 0x20001 || version > 0x20600) refused();
    const header = version >= 0x20600 ? 108 : version >= 0x20500 ? 96 : version >= 0x20400 ? 88 :
      version >= 0x20300 ? 64 : version >= 0x20200 ? 52 : version >= 0x20100 ? 48 : 44;
    if (directory.length < header) refused();
    const algorithms: Readonly<Record<number, readonly [string, number]>> = { 1: ["sha1", 20], 2: ["sha256", 32],
      3: ["sha256", 20], 4: ["sha384", 48] };
    const algorithm = algorithms[directory[37]!];
    if (algorithm === undefined || directory[36] !== algorithm[1]) refused();
    const offset = directory.readUInt32BE(16), special = directory.readUInt32BE(24) * algorithm[1];
    if (offset - special < header) refused(); span(offset - special, special, directory.length);
    span(offset, directory.readUInt32BE(28) * algorithm[1], directory.length);
    hashes.push(createHash(algorithm[0]).update(directory).digest("hex").slice(0, 40));
  }
  if (!slots.has(0) || !hashes.length) refused();
  return hashes;
}
function imageHashes(image: Buffer, cpu: number): string[] {
  if (image.length < 32 || image.readUInt32LE(0) !== 0xfeedfacf || image.readUInt32LE(4) !== cpu ||
      image.readUInt32LE(12) !== 2 /* MH_EXECUTE */) refused();
  const count = image.readUInt32LE(16), bytes = image.readUInt32LE(20); span(32, bytes, image.length);
  if (count > Math.floor(bytes / 8)) refused();
  let at = 32, signature: Buffer | undefined;
  for (let index = 0; index < count; index++) {
    span(at, 8, 32 + bytes);
    const command = image.readUInt32LE(at), size = image.readUInt32LE(at + 4);
    if (size < 8 || size % 8 !== 0) refused(); span(at, size, 32 + bytes);
    if (command === 0x1d /* LC_CODE_SIGNATURE */) {
      if (size !== 16 || signature !== undefined) refused();
      const offset = image.readUInt32LE(at + 8), length = image.readUInt32LE(at + 12);
      if (offset < 32 + bytes) refused(); span(offset, length, image.length);
      signature = image.subarray(offset, offset + length);
    }
    at += size;
  }
  if (at !== 32 + bytes || signature === undefined) refused();
  return directories(signature);
}
/** Synchronous borrowed bytes; shared mutable buffers are refused. Both thin
 * 64-bit and universal 32/64-bit offset tables are supported. All returned
 * hashes belong to the selected CPU family; subtypes remain kernel selection.
 */
export function machoImageCdHashes(source: Uint8Array, architecture: "arm64" | "x64"): readonly string[] {
  if (!(source instanceof Uint8Array) || !(source.buffer instanceof ArrayBuffer) ||
      !["arm64", "x64"].includes(architecture)) refused();
  const image = Buffer.from(source.buffer, source.byteOffset, source.byteLength), cpu = architecture === "arm64" ? 0x0100000c : 0x01000007;
  if (image.length < 8) refused();
  const magic = image.readUInt32BE(0);
  if (![0xcafebabe, 0xcafebabf, 0xbebafeca, 0xbfbafeca].includes(magic)) return Object.freeze(imageHashes(image, cpu));
  const little = magic === 0xbebafeca || magic === 0xbfbafeca, wide = magic === 0xcafebabf || magic === 0xbfbafeca;
  const word = (at: number): number => little ? image.readUInt32LE(at) : image.readUInt32BE(at);
  const count = word(4), entry = wide ? 32 : 20, end = 8 + count * entry;
  if (count < 1 || count > 64) refused(); span(0, end, image.length);
  const ranges: { first: number; last: number }[] = [], hashes: string[] = [];
  for (let index = 0; index < count; index++) {
    const at = 8 + index * entry;
    const value = (offset: number): number => {
      const integer = little ? image.readBigUInt64LE(offset) : image.readBigUInt64BE(offset);
      if (integer > BigInt(image.length)) refused(); return Number(integer);
    };
    const first = wide ? value(at + 8) : word(at + 8), length = wide ? value(at + 16) : word(at + 12), last = first + length;
    if (first < end || length === 0) refused(); span(first, length, image.length);
    if (ranges.some(range => first < range.last && last > range.first)) refused(); ranges.push({ first, last });
    if (word(at) === cpu) hashes.push(...imageHashes(image.subarray(first, last), cpu));
  }
  const unique = [...new Set(hashes)]; if (!unique.length || unique.length > 16) refused();
  return Object.freeze(unique);
}
