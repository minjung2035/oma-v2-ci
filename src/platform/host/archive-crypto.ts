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
import { withCleanup } from "../../process/cleanup.js";
import type { StreamSink } from "../stream-receive.js";
import { createTemporary, discardTemporary, publishTemporary } from "./files.js";

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

const MAX_CHUNKS = 0x100000000; // the nonce's and the authenticated data's 32-bit chunk number (G12-06)

function writeAll(fd: number, bytes: Buffer): void {
  for (let at = 0; at < bytes.length;) at += writeSync(fd, bytes, at, bytes.length - at);
}

/** P0V-103 (F-02, F-03): seals a stream as it arrives -- the plain bytes are
 * never written anywhere (MAC-621 by construction). A chunk is sealed once
 * the bytes after it exist, so the last one is known to be last; the format
 * is the one `decryptArchive` opens. The caller flushes and publishes the
 * file it writes into. */
export class ArchiveSealer {
  private pending = Buffer.alloc(0);
  private index = 0;
  private readonly fileId = randomBytes(8);
  private finished = false;
  constructor(private readonly fd: number, private readonly key: Buffer) {
    if (key.length !== 32) throw new StoreError("INVALID_REQUEST", "an archive key is 32 bytes");
    writeAll(fd, Buffer.concat([MAGIC, this.fileId]));
  }
  write(bytes: Buffer): void {
    if (this.finished) throw new StoreError("INTERNAL_ERROR", "an archive is written after it was sealed");
    this.pending = this.pending.length === 0 ? Buffer.from(bytes) : Buffer.concat([this.pending, bytes]);
    while (this.pending.length > CHUNK) {
      this.seal(this.pending.subarray(0, CHUNK), false);
      this.pending = this.pending.subarray(CHUNK);
    }
  }
  /** The last chunk: what remains, possibly empty. */
  finish(): void {
    if (this.finished) return;
    this.seal(this.pending, true);
    this.pending = Buffer.alloc(0);
    this.finished = true;
  }
  private seal(plain: Buffer, last: boolean): void {
    if (this.index >= MAX_CHUNKS) throw new StoreError("LIMIT_EXCEEDED", "an archive has more chunks than its format can number");
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce(this.fileId, this.index));
    cipher.setAAD(aad(this.fileId, this.index, last));
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    const length = Buffer.alloc(4); length.writeUInt32BE(body.length, 0);
    writeAll(this.fd, Buffer.concat([length, body, cipher.getAuthTag()]));
    this.index += 1;
  }
}

/** P0V-103, P0V-104 (F-02, F-03): a stream sealed as it arrives into a
 * temporary beside `name`, and published as `name` whole once every byte
 * hashed as declared -- so the archives directory holds finished archives
 * and nothing else, and no plain byte is ever on disk. */
export function sealedArchiveSink(dir: string, name: string, key: Buffer): StreamSink {
  const temporary = createTemporary(dir, name);
  let sealer: ArchiveSealer;
  try { sealer = new ArchiveSealer(temporary.fd, key); }
  catch (error) { return withCleanup(() => { throw error; }, () => discardTemporary(temporary)); }
  return {
    write: chunk => { sealer.write(chunk); },
    complete: () => { sealer.finish(); publishTemporary(temporary, dir, name); },
    abandon: () => { discardTemporary(temporary); },
  };
}

/** A plain file sealed into a new file (the sealer over a file's bytes). */
export function encryptArchive(plainPath: string, outPath: string, key: Buffer): void {
  if (key.length !== 32) throw new StoreError("INVALID_REQUEST", "an archive key is 32 bytes");
  const input = openSync(plainPath, "r");
  withCleanup(() => {
    const output = openSync(outPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    withCleanup(() => {
      const sealer = new ArchiveSealer(output, key);
      for (let position = 0; ;) {
        const chunk = readFully(input, CHUNK, position);
        if (chunk.length === 0) break;
        sealer.write(chunk);
        position += chunk.length;
      }
      sealer.finish();
      fsyncSync(output);
    }, () => closeSync(output));
  }, () => closeSync(input));
}

export function decryptArchive(inPath: string, outPath: string, key: Buffer): void {
  const input = openSync(inPath, "r");
  withCleanup(() => {
    const output = openSync(outPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    withCleanup(() => {
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
        writeAll(output, plain);
        if (last) break;
        index += 1;
      }
      fsyncSync(output);
    }, () => closeSync(output));
  }, () => closeSync(input));
}
