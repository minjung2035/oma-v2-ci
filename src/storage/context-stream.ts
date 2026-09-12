/** CTX-002/FS-003: ordered raw bytes become operation-owned staging files.
 * At most one entry descriptor and one source chunk are active. No whole-input
 * chunks array, concatenation, newline conversion or durable sidecar is used.
 */
import { constants, openSync, closeSync, writeFileSync, fchmodSync, fsyncSync, fstatSync, lstatSync, unlinkSync } from "node:fs";
import { createHash, type Hash } from "node:crypto";
import { dirname, join } from "node:path";
import type { BlobDescriptor, ContextEntry } from "../../implementation/contracts.js";
import { StoreError } from "../domain/errors.js";
import { contextEntriesCheck, ContextTextValidator } from "../domain/context-policy.js";
import { contextStagingPathAt } from "./paths.js";
import { assertDirectory } from "./directory.js";
import { ensureDurableDirectory, fsyncDir, fsyncTree } from "./durable-fs.js";

interface OwnedFile { path: string; dev: number; ino: number }
interface EntryWriter { entry: Readonly<ContextEntry>; fd: number | null; remaining: number; hash: Hash; text: ContextTextValidator }

export async function prepareContextStream(
  stateRoot: string, operationId: string, inputEntries: readonly ContextEntry[], inputContent: BlobDescriptor,
  chunks: AsyncIterable<Uint8Array>,
): Promise<string> {
  const invalid = contextEntriesCheck(inputEntries, { requireSorted: true, contentBytes: inputContent.bytes });
  if (invalid || inputContent.mediaType !== "application/vnd.oma.context-v1" || !/^[0-9a-f]{64}$/.test(inputContent.sha256))
    throw new StoreError("INVALID_REQUEST", invalid ?? "invalid context stream descriptor");
  const entries = inputEntries.map(entry => Object.freeze({ ...entry }));
  const content = Object.freeze({ ...inputContent });
  const staging = contextStagingPathAt(stateRoot, operationId);
  const tree = join(staging, "tree");
  ensureDurableDirectory(tree, 0o700); assertDirectory(tree);
  const owned: OwnedFile[] = [];
  const state: { active: EntryWriter | null; index: number } = { active: null, index: 0 };
  let received = 0;
  const aggregate = createHash("sha256");

  const openEntry = (): void => {
    const entry = entries[state.index];
    if (!entry) return;
    const path = join(tree, entry.path);
    ensureDurableDirectory(dirname(path), 0o700);
    const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    state.active = { entry, fd, remaining: entry.bytes, hash: createHash("sha256"), text: new ContextTextValidator(entry.path) };
    // Register FD ownership before fstat so even an observation failure closes it.
    const stat = fstatSync(fd);
    owned.push({ path, dev: stat.dev, ino: stat.ino });
  };
  const finishEntry = (): void => {
    const active = state.active;
    if (active === null || active.fd === null || active.remaining !== 0) throw new StoreError("INTERNAL_ERROR", "context file has no complete writer");
    const error = active.text.finish();
    if (error) throw new StoreError("INVALID_REQUEST", `${active.entry.path}: ${error}`);
    if (active.hash.digest("hex") !== active.entry.sha256) throw new StoreError("STREAM_INVALID", `context file digest mismatch: ${active.entry.path}`);
    // Unlike mail objects, context candidate/snapshot files have fixed 0644.
    fchmodSync(active.fd, 0o644); fsyncSync(active.fd);
    const fd = active.fd; active.fd = null; closeSync(fd);
    state.active = null; state.index++;
  };
  const advanceEmptyEntries = (): void => {
    while (state.index < entries.length) {
      if (state.active === null) openEntry();
      if (state.active === null || state.active.remaining !== 0) return;
      finishEntry();
    }
  };
  try {
    advanceEmptyEntries();
    for await (const chunk of chunks) {
      if (!(chunk instanceof Uint8Array)) throw new StoreError("STREAM_INVALID", "context stream returned non-byte data");
      if (chunk.byteLength > content.bytes - received) throw new StoreError("STREAM_INVALID", "context stream exceeds its declaration");
      aggregate.update(chunk); received += chunk.byteLength;
      let offset = 0;
      while (offset < chunk.byteLength) {
        advanceEmptyEntries();
        const active = state.active;
        if (active === null || active.fd === null) throw new StoreError("STREAM_INVALID", "bytes remain after the final context entry");
        const count = Math.min(active.remaining, chunk.byteLength - offset, 64 * 1024);
        const part = chunk.subarray(offset, offset + count);
        const invalidText = active.text.append(part);
        if (invalidText) throw new StoreError("INVALID_REQUEST", `${active.entry.path}: ${invalidText}`);
        writeFileSync(active.fd, part); active.hash.update(part);
        active.remaining -= count; offset += count;
      }
      advanceEmptyEntries();
    }
    advanceEmptyEntries();
    if (received !== content.bytes || state.index !== entries.length || state.active !== null)
      throw new StoreError("STREAM_INVALID", "EOF before all declared context bytes");
    if (aggregate.digest("hex") !== content.sha256) throw new StoreError("STREAM_INVALID", "context aggregate digest mismatch");
    fsyncTree(tree, "context-single-link"); fsyncDir(staging); fsyncDir(dirname(staging));
    return tree;
  } catch (error) {
    const failures: unknown[] = [error];
    const active = state.active;
    if (active !== null && active.fd !== null) {
      const fd = active.fd; active.fd = null;
      try { closeSync(fd); } catch (failure) { failures.push(failure); }
    }
    // No operation has been accepted by this helper. Remove only exact files
    // exclusively created here, never another owner's replacement or a subtree.
    for (const file of [...owned].reverse()) {
      try {
        const current = lstatSync(file.path, { throwIfNoEntry: false });
        if (!current) continue;
        if (!current.isFile() || current.dev !== file.dev || current.ino !== file.ino)
          throw new StoreError("STORE_CORRUPT", "owned context preparation changed identity during cleanup");
        unlinkSync(file.path); fsyncDir(dirname(file.path));
      } catch (failure) { failures.push(failure); }
    }
    if (failures.length > 1) throw new AggregateError(failures, "context preparation and owned cleanup failed");
    throw error;
  }
}
