// IPC-003: .wire is an ephemeral transport copy, never an accepted plan artifact.
// Workflow staging/object paths are not registered with this cleanup owner.
import { constants, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, unlinkSync, createReadStream, type ReadStream } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { StoreError } from "../domain/errors.js";

export interface RawDescriptor { readonly bytes: number; readonly sha256: string }
export interface ExecutionBody { readonly chunks: AsyncIterable<Uint8Array>; release(): void }
export interface ConnectionSpool {
  append(bytes: Buffer): void;
  seal(): void;
  handoff(): ExecutionBody;
  releaseConnection(): void;
}

export class TransportSpool implements ConnectionSpool {
  readonly path: string;
  private fd: number | null;
  private owner: "connection" | "execution" | "disposed" = "connection";
  private sealed = false;
  private count = 0;
  private readonly hash = createHash("sha256");
  private reader: ReadStream | null = null;
  constructor(stagingRoot: string, private readonly descriptor: RawDescriptor) {
    if (!Number.isSafeInteger(descriptor.bytes) || descriptor.bytes < 0 || !/^[0-9a-f]{64}$/.test(descriptor.sha256))
      throw new StoreError("STREAM_INVALID", "invalid raw stream descriptor");
    mkdirSync(stagingRoot, { recursive: true });
    this.path = join(stagingRoot, `rpc-${randomUUID()}.wire`);
    this.fd = openSync(this.path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  }
  append(bytes: Buffer): void {
    if (this.owner !== "connection" || this.sealed || this.fd === null) throw new StoreError("INTERNAL_ERROR", "raw spool is not writable");
    if (bytes.length > this.descriptor.bytes - this.count) throw new StoreError("STREAM_INVALID", "raw stream exceeds its descriptor");
    writeFileSync(this.fd, bytes);
    this.hash.update(bytes); this.count += bytes.length;
  }
  seal(): void {
    if (this.owner !== "connection" || this.sealed || this.fd === null) throw new StoreError("INTERNAL_ERROR", "raw spool cannot be sealed twice");
    if (this.count !== this.descriptor.bytes || this.hash.digest("hex") !== this.descriptor.sha256)
      throw new StoreError("STREAM_INVALID", "raw stream length or SHA-256 differs from its descriptor");
    fsyncSync(this.fd);
    const fd = this.fd; this.fd = null; closeSync(fd);
    this.sealed = true;
  }
  handoff(): ExecutionBody {
    if (this.owner !== "connection" || !this.sealed) throw new StoreError("INTERNAL_ERROR", "raw spool is not ready for execution");
    this.owner = "execution";
    const self = this;
    let opened = false;
    const chunks = (async function* (): AsyncIterable<Uint8Array> {
      if (opened || self.owner !== "execution") throw new StoreError("INTERNAL_ERROR", "transport body is single-use");
      opened = true;
      const reader = createReadStream(self.path);
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
    if (this.fd !== null) {
      const fd = this.fd; this.fd = null;
      try { closeSync(fd); } catch (error) { first = error; }
    }
    try { this.reader?.destroy(); } catch (error) { first ??= error; }
    this.reader = null;
    try { unlinkSync(this.path); }
    catch (error) { if (!(error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT")) first ??= error; }
    if (first !== undefined) throw first;
  }
}
