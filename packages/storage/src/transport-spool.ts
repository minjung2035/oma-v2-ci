import { unlinkAt } from "@oma/file-descriptors";
// IPC-003: .wire is an ephemeral transport copy, never an accepted plan artifact.
// Workflow staging/object paths are not registered with this cleanup owner.
// FS-005 / architecture section 4: the staging directory is resolved once and held for the spool's life;
// the file is written, read back and removed through that one resolution, and
// its path is never looked up again.
import { constants, fsyncSync, fstatSync, closeSync, createReadStream, writeSync, type ReadStream } from "node:fs";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { StoreError } from "@oma/domain/errors";
import { ensureOwnedDirectory } from "./directory.js";
import { openBeneath, openDirectory, openRegularBeneath, closeEvery } from "@oma/native/files";

import type { RawDescriptor, ExecutionBody, ConnectionSpool } from "@oma/contracts/files";

export class TransportSpool implements ConnectionSpool {
  readonly path: string;
  private readonly name: string;
  private directory: number | null;
  private fd: number | null;
  private owner: "connection" | "execution" | "disposed" = "connection";
  private sealed = false;
  private count = 0;
  private readonly hash = createHash("sha256");
  private reader: ReadStream | null = null;
  /** The written file's identity, so the reader can prove it opened the same one. */
  private written: { readonly dev: number; readonly ino: number } | null = null;
  constructor(stagingRoot: string, private readonly descriptor: RawDescriptor) {
    if (!Number.isSafeInteger(descriptor.bytes) || descriptor.bytes < 0 || !/^[0-9a-f]{64}$/.test(descriptor.sha256))
      throw new StoreError("STREAM_INVALID", "invalid raw stream descriptor");
    // P0-8: the staging root is oma's own (the state's staging directory);
    // repair its tail rather than trusting the mode a stray left.
    ensureOwnedDirectory(stagingRoot, dirname(stagingRoot));
    this.name = `rpc-${randomUUID()}.wire`;
    this.path = join(stagingRoot, this.name);
    this.directory = openDirectory(stagingRoot);
    try { this.fd = openBeneath(this.directory, this.name, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
    catch (error) { closeSync(this.directory); this.directory = null; throw error; }
  }
  append(bytes: Buffer): void {
    if (this.owner !== "connection" || this.sealed || this.fd === null) throw new StoreError("INTERNAL_ERROR", "raw spool is not writable");
    if (bytes.length > this.descriptor.bytes - this.count) throw new StoreError("STREAM_INVALID", "raw stream exceeds its descriptor");
    let written = 0;
    while (written < bytes.length) {
      const count = writeSync(this.fd, bytes, written, bytes.length - written, this.count + written);
      if (count === 0) throw new StoreError("INTERNAL_ERROR", "raw spool write made no progress");
      written += count;
    }
    this.hash.update(bytes); this.count += bytes.length;
  }
  seal(): void {
    if (this.owner !== "connection" || this.sealed || this.fd === null) throw new StoreError("INTERNAL_ERROR", "raw spool cannot be sealed twice");
    if (this.count !== this.descriptor.bytes || this.hash.digest("hex") !== this.descriptor.sha256)
      throw new StoreError("STREAM_INVALID", "raw stream length or SHA-256 differs from its descriptor");
    fsyncSync(this.fd);
    const stat = fstatSync(this.fd);
    this.written = { dev: stat.dev, ino: stat.ino };
    const fd = this.fd; this.fd = null; closeSync(fd);
    this.sealed = true;
  }
  handoff(): ExecutionBody {
    if (this.owner !== "connection" || !this.sealed) throw new StoreError("INTERNAL_ERROR", "raw spool is not ready for execution");
    this.owner = "execution";
    const self = this;
    let opened = false;
    const chunks = (async function* (): AsyncIterable<Uint8Array> {
      if (opened || self.owner !== "execution" || self.directory === null || self.written === null)
        throw new StoreError("INTERNAL_ERROR", "transport body is single-use");
      opened = true;
      // Reopened through the held directory, and proven to be the file whose
      // bytes were hashed; the reader owns and closes this descriptor itself.
      const fd = openRegularBeneath(self.directory, self.name);
      // P0V-65, P0-4: this frame owns the descriptor until the reader does;
      // a failure between the two gives it back here.
      let reader: ReadStream | null = null;
      try {
        const stat = fstatSync(fd);
        if (stat.dev !== self.written.dev || stat.ino !== self.written.ino || stat.size !== self.descriptor.bytes)
          throw new StoreError("STREAM_INVALID", "the transport copy changed after it was sealed");
        reader = createReadStream("", { fd, start: 0 });
      } finally { if (reader === null) closeEvery(fd); }
      self.reader = reader;
      try {
        for await (const value of reader) {
          if (!Buffer.isBuffer(value)) throw new StoreError("STREAM_INVALID", "transport reader returned non-byte data");
          yield value;
        }
      } finally { reader.destroy(); self.reader = null; }
    })();
    return Object.freeze({ chunks, release: () => { if (self.owner === "execution") self.dispose(); } });
  }
  releaseConnection(): void { if (this.owner === "connection") this.dispose(); }
  private dispose(): void {
    if (this.owner === "disposed") return;
    this.owner = "disposed";
    let first: unknown;
    try { this.reader?.destroy(); } catch (error) { first = error; }
    this.reader = null;
    if (this.fd !== null) {
      const fd = this.fd; this.fd = null;
      try { closeSync(fd); } catch (error) { first ??= error; }
    }
    if (this.directory !== null) {
      const directory = this.directory; this.directory = null;
      try { unlinkAt(directory, this.name); }
      catch (error) { if (!(error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT")) first ??= error; }
      try { closeSync(directory); } catch (error) { first ??= error; }
    }
    if (first !== undefined) throw first;
  }
}
