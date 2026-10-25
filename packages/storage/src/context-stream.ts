/** CTX-002/FS-003: ordered raw bytes become operation-owned staging files.
 * At most one entry descriptor and one source chunk are active. No whole-input
 * chunks array, concatenation, newline conversion or durable sidecar is used.
 */
import { constants, closeSync, writeFileSync, fchmodSync, fsyncSync, fstatSync, lstatSync } from "node:fs";
import { createHash, type Hash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import type { BlobDescriptor, ContextEntry } from "@oma/contracts";
import { StoreError } from "@oma/domain/errors";
import { contextEntriesCheck, ContextTextValidator } from "@oma/domain/context-policy";
import { contextStagingPathAt } from "@oma/domain/paths";
import { assertDirectory } from "./directory.js";
import { TreeLease, collectLeasedTree } from "./tree-lease.js";
import { openBeneath, openDirectory, closeEvery } from "@oma/native/files";
import { ensureOwnedDurableDirectory, faultAt, fsyncDir, fsyncTree, isDurabilityFault, type DurabilityObserver } from "./durable-fs.js";
import { mkdirAt, statAt, unlinkAt } from "@oma/native/posix-files";
import type { PreacceptOwner } from "@oma/contracts/files";

/** The staging root one preparation created exclusively, pinned at creation.
 * Until acceptance it belongs to that preparation alone; acceptance hands it to
 * the operation whose plan names it. Discard removes it only while the name
 * still holds the pinned root.
 */
export class PreparedContextTree implements PreacceptOwner {
  private owner: "preaccept" | "accepted" | "released" = "preaccept";
  constructor(
    readonly path: string,
    private readonly root: string,
    private readonly identity: Readonly<{ dev: number; ino: number }>,
    /** R6-04: held while this process writes the tree; released after. */
    private readonly lease: TreeLease,
  ) {}
  /** This process has finished writing the tree; a native preparation that
   * works in it later takes the lease again for its children. */
  releaseWriting(): void { this.lease.release(); }
  retainForOperation(): void {
    if (this.owner === "released") throw new StoreError("INTERNAL_ERROR", "released context tree cannot become accepted");
    this.owner = "accepted";
    // Its lease stays beside it: a kept tree whose outcome turns out unknown
    // is decided by it at the next start (R6-04).
    this.lease.release();
  }
  discardUnaccepted(): void {
    if (this.owner !== "preaccept") return;
    const current = lstatSync(this.root, { throwIfNoEntry: false });
    if (!current) { this.owner = "released"; return; }
    if (!current.isDirectory() || current.dev !== this.identity.dev || current.ino !== this.identity.ino)
      throw new StoreError("REF_STATE_UNKNOWN", "prepared context root identity changed; cleanup is unconfirmed");
    this.lease.release();
    // A native preparation's children may still be working in it: only a
    // lease nobody holds lets the tree go (R6-04).
    const found = collectLeasedTree(this.root);
    if (found.kind !== "quiescent") throw new StoreError("REF_STATE_UNKNOWN", "a native preparation may still work in the context tree; it is kept");
    this.owner = "released";
  }
}

/** An existing root belongs to another operation and is never adopted. */
function acquireStagingRoot(staging: string, tree: string): PreparedContextTree {
  // R6-04: the lease first, then the tree. Everything after `take` is inside
  // the same release-on-failure guard: an opener failure must not strand the
  // lease (AV-18).
  const lease = TreeLease.take(staging);
  try {
    const parent = openDirectory(dirname(staging));
    try {
      mkdirAt(parent, basename(staging), 0o700);
      const pinned = statAt(parent, basename(staging));
      return new PreparedContextTree(tree, staging, { dev: pinned.dev, ino: pinned.ino }, lease);
    } finally { closeSync(parent); }
  } catch (error) { lease.release(); throw error; }
}

/** A failed preparation removes its own root only after every exact file it
 * created was removed: a replacement it refused to delete keeps the root too. */
function discardFailedPreparation(prepared: PreparedContextTree, failures: unknown[]): unknown {
  if (failures.length === 1) {
    try { prepared.discardUnaccepted(); } catch (failure) { failures.push(failure); }
  }
  prepared.releaseWriting();
  return failures.length > 1 ? new AggregateError(failures, "context preparation and owned cleanup failed") : failures[0];
}

interface OwnedFile { path: string; dev: number; ino: number }
interface EntryWriter { entry: Readonly<ContextEntry>; fd: number | null; remaining: number; hash: Hash; text: ContextTextValidator }

export async function prepareContextStream(
  stateRoot: string, operationId: string, inputEntries: readonly ContextEntry[], inputContent: BlobDescriptor,
  chunks: AsyncIterable<Uint8Array>, faults?: DurabilityObserver,
): Promise<PreparedContextTree> {
  const invalid = contextEntriesCheck(inputEntries, { requireSorted: true, contentBytes: inputContent.bytes });
  if (invalid || inputContent.mediaType !== "application/vnd.oma.context-v1" || !/^[0-9a-f]{64}$/.test(inputContent.sha256))
    throw new StoreError("INVALID_REQUEST", invalid ?? "invalid context stream descriptor");
  const entries = inputEntries.map(entry => Object.freeze({ ...entry }));
  const content = Object.freeze({ ...inputContent });
  const staging = contextStagingPathAt(stateRoot, operationId);
  const tree = join(staging, "tree");
  ensureOwnedDurableDirectory(dirname(staging), stateRoot, 0o700, faults);
  const prepared = acquireStagingRoot(staging, tree);
  let treeFd: number;
  try { ensureOwnedDurableDirectory(tree, stateRoot, 0o700, faults); assertDirectory(tree); treeFd = openDirectory(tree); }
  catch (error) {
    if (isDurabilityFault(error)) throw error; // crash simulation: no owned cleanup
    throw discardFailedPreparation(prepared, [error]);
  }
  const owned: OwnedFile[] = [];
  const state: { active: EntryWriter | null; index: number } = { active: null, index: 0 };
  let received = 0;
  const aggregate = createHash("sha256");

  const openEntry = (): void => {
    const entry = entries[state.index];
    if (!entry) return;
    const path = join(tree, entry.path);
    // The context grammar permits only root files and decisions/<name>.
    let directory = treeFd;
    let name = entry.path;
    if (entry.path.startsWith("decisions/")) {
      try { mkdirAt(treeFd, "decisions", 0o700); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      directory = openBeneath(treeFd, "decisions", constants.O_RDONLY | constants.O_DIRECTORY);
      name = entry.path.slice("decisions/".length);
    }
    let fd: number;
    try {
      faultAt(faults, "file-create", "before", path);
      fd = openBeneath(directory, name, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    } finally { if (directory !== treeFd) closeSync(directory); }
    state.active = { entry, fd, remaining: entry.bytes, hash: createHash("sha256"), text: new ContextTextValidator(entry.path) };
    faultAt(faults, "file-create", "after-visible", path);
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
    fchmodSync(active.fd, 0o644);
    faultAt(faults, "file-fsync", "ambiguous", active.entry.path);
    fsyncSync(active.fd);
    faultAt(faults, "file-fsync", "after-visible", active.entry.path);
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
        faultAt(faults, "file-write", "before", active.entry.path);
        writeFileSync(active.fd, part); active.hash.update(part);
        faultAt(faults, "file-write", "ambiguous", active.entry.path);
        active.remaining -= count; offset += count;
      }
      advanceEmptyEntries();
    }
    advanceEmptyEntries();
    if (received !== content.bytes || state.index !== entries.length || state.active !== null)
      throw new StoreError("STREAM_INVALID", "EOF before all declared context bytes");
    if (aggregate.digest("hex") !== content.sha256) throw new StoreError("STREAM_INVALID", "context aggregate digest mismatch");
    fsyncTree(treeFd, "context-single-link", faults); fsyncDir(staging, faults); fsyncDir(dirname(staging), faults);
    const named = openDirectory(tree);
    try {
      const current = fstatSync(named); const pinned = fstatSync(treeFd);
      if (current.dev !== pinned.dev || current.ino !== pinned.ino) throw new StoreError("STORE_CORRUPT", "context staging root changed identity");
    } finally { closeSync(named); }
    return prepared;
  } catch (error) {
    if (isDurabilityFault(error)) throw error; // crash simulation: no owned cleanup
    const failures: unknown[] = [error];
    const active = state.active;
    if (active !== null && active.fd !== null) {
      const fd = active.fd; active.fd = null;
      try { closeSync(fd); } catch (failure) { failures.push(failure); }
    }
    // No operation has been accepted by this helper. Remove exact files
    // exclusively created here first, never another owner's replacement.
    for (const file of [...owned].reverse()) {
      try {
        const relative = file.path.slice(tree.length + 1);
        const parent = dirname(relative) === "." ? treeFd : openBeneath(treeFd, dirname(relative), constants.O_RDONLY | constants.O_DIRECTORY);
        try {
          const current = statAt(parent, basename(relative), { throwIfNoEntry: false });
          if (!current) continue;
          if (!current.isFile() || current.dev !== file.dev || current.ino !== file.ino)
            throw new StoreError("STORE_CORRUPT", "owned context preparation changed identity during cleanup");
          unlinkAt(parent, basename(relative)); fsyncSync(parent);
        } finally { if (parent !== treeFd) closeSync(parent); }
      } catch (failure) { failures.push(failure); }
    }
    throw discardFailedPreparation(prepared, failures);
  } finally { try { closeEvery(state.active?.fd, treeFd); } finally { prepared.releaseWriting(); } }
}
