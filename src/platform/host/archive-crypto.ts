/** An archive at rest on the Mac (macos-platform §8.4, MAC-621): never
 * written unencrypted. AES-256-GCM over 64 KiB chunks. Each chunk's nonce is
 * the file's random id and the chunk's number, and its authenticated data
 * names the file, the number and whether it is the last -- so a chunk moved,
 * dropped, repeated or cut off at the end fails to open. The key is the
 * Keychain's (`archive`), made once on this Mac.
 *
 *   "OMAARC1\n" | fileId (8) | { length (4, BE) | ciphertext | tag (16) }...
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { closeSync, constants, fsyncSync, openSync, readSync, writeSync } from "node:fs";
import { StoreError } from "../../domain/errors.js";

const MAGIC = Buffer.from("OMAARC1\n", "latin1");
const CHUNK = 64 * 1024;

function nonce(fileId: Buffer, index: number): Buffer {
  const value = Buffer.alloc(12);
  fileId.copy(value, 0);
  value.writeUInt32BE(index, 8);
  return value;
}
function aad(fileId: Buffer, index: number, last: boolean): Buffer {
  const value = Buffer.alloc(8 + 4 + 1);
  fileId.copy(value, 0); value.writeUInt32BE(index, 8); value.writeUInt8(last ? 1 : 0, 12);
  return value;
}
function readFully(fd: number, length: number, position: number): Buffer {
  const buffer = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) { const count = readSync(fd, buffer, filled, length - filled, position + filled); if (count === 0) break; filled += count; }
  return buffer.subarray(0, filled);
}
const damaged = (): StoreError => new StoreError("STREAM_INVALID", "the archive is damaged or was changed");

export function encryptArchive(plainPath: string, outPath: string, key: Buffer): void {
  if (key.length !== 32) throw new StoreError("INVALID_REQUEST", "an archive key is 32 bytes");
  const input = openSync(plainPath, "r");
  const output = openSync(outPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    const fileId = randomBytes(8);
    writeSync(output, Buffer.concat([MAGIC, fileId]));
    let position = 0; let index = 0;
    let current = readFully(input, CHUNK, position);
    for (;;) {
      position += current.length;
      const next = current.length === CHUNK ? readFully(input, CHUNK, position) : Buffer.alloc(0);
      const last = next.length === 0;
      const cipher = createCipheriv("aes-256-gcm", key, nonce(fileId, index));
      cipher.setAAD(aad(fileId, index, last));
      const body = Buffer.concat([cipher.update(current), cipher.final()]);
      const length = Buffer.alloc(4); length.writeUInt32BE(body.length, 0);
      writeSync(output, Buffer.concat([length, body, cipher.getAuthTag()]));
      if (last) break;
      current = next; index += 1;
    }
    fsyncSync(output);
  } finally { closeSync(input); closeSync(output); }
}

export function decryptArchive(inPath: string, outPath: string, key: Buffer): void {
  const input = openSync(inPath, "r");
  const output = openSync(outPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    const head = readFully(input, MAGIC.length + 8, 0);
    if (head.length !== MAGIC.length + 8 || !head.subarray(0, MAGIC.length).equals(MAGIC)) throw damaged();
    const fileId = head.subarray(MAGIC.length);
    let position = head.length; let index = 0;
    for (;;) {
      const length = readFully(input, 4, position);
      if (length.length !== 4) throw damaged();
      const size = length.readUInt32BE(0);
      if (size > CHUNK) throw damaged();
      const body = readFully(input, size, position + 4);
      const tag = readFully(input, 16, position + 4 + size);
      if (body.length !== size || tag.length !== 16) throw damaged();
      position += 4 + size + 16;
      const last = readFully(input, 1, position).length === 0;
      const decipher = createDecipheriv("aes-256-gcm", key, nonce(fileId, index));
      decipher.setAAD(aad(fileId, index, last));
      decipher.setAuthTag(tag);
      let plain: Buffer;
      try { plain = Buffer.concat([decipher.update(body), decipher.final()]); } catch { throw damaged(); }
      writeSync(output, plain);
      if (last) break;
      index += 1;
    }
    fsyncSync(output);
  } finally { closeSync(input); closeSync(output); }
}
