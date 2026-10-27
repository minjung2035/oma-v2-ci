/** Filesystem observations and publication for a quiescent session cache.
 * Snapshot bytes are primary before these cache trees may be retired. No Git
 * is executed in a model-owned directory; links are data, never traversal. */
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, readSync, type BigIntStats } from "node:fs";
import { basename, dirname, join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { StoreError } from "@oma/domain/errors";
import { decodeUtf8 } from "@oma/domain/utf8";
import { cleanupAll, withAsyncCleanup, withCleanup } from "@oma/native/cleanup";
import { directoryNames } from "@oma/file-descriptors";
import { assertNoUnpreservedMetadataAt, readlinkBytesAt, renameAt, statAt } from "@oma/native/posix-files";
import { openBeneath, openDirectory, openRegularBeneath, withinDirectory } from "@oma/native/files";
import { fsyncHeldDir } from "./durable-fs.js";

function same(before: BigIntStats, after: BigIntStats): boolean {
  return before.dev === after.dev && before.ino === after.ino && before.mode === after.mode &&
    before.uid === after.uid && before.gid === after.gid && before.size === after.size &&
    before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs;
}
function checkSignal(signal?: AbortSignal): void { signal?.throwIfAborted(); }

/** Fixed memory and cooperative cancellation, including very large files. */
export async function digestDescriptor(fd: number, signal?: AbortSignal): Promise<string> {
  const before = fstatSync(fd, { bigint: true });
  if (!before.isFile() || before.size > BigInt(Number.MAX_SAFE_INTEGER))
    throw new StoreError("UNSUPPORTED_PROFILE", "session storage requires a safely addressable regular file");
  const hash = createHash("sha256"), buffer = Buffer.alloc(64 * 1024);
  let position = 0;
  while (position < Number(before.size)) {
    checkSignal(signal);
    const count = readSync(fd, buffer, 0, Math.min(buffer.length, Number(before.size) - position), position);
    if (count === 0) break;
    hash.update(buffer.subarray(0, count)); position += count;
    if (position % (1024 * 1024) === 0) await setImmediate();
  }
  if (position !== Number(before.size) || readSync(fd, buffer, 0, 1, position) !== 0 || !same(before, fstatSync(fd, { bigint: true })))
    throw new StoreError("REF_STATE_UNKNOWN", "session storage source changed while being read");
  return hash.digest("hex");
}

export async function regularFileDigest(path: string, signal?: AbortSignal): Promise<string | null> {
  const parent = openDirectory(dirname(path));
  return withAsyncCleanup(async () => {
    let fd: number;
    try { fd = openRegularBeneath(parent, basename(path)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    return withAsyncCleanup(() => digestDescriptor(fd, signal), () => closeSync(fd));
  }, () => closeSync(parent));
}

/** Missing alone is absence. Source permissions are not repaired before backup. */
export function cacheDirectoryPresent(path: string): boolean {
  return withinDirectory(path, (parent, name) => {
    let fd: number;
    try { fd = openBeneath(parent, name, constants.O_RDONLY | constants.O_DIRECTORY); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
    closeSync(fd); return true;
  });
}

export interface CacheNodeMetadata {
  readonly type: "dir" | "file" | "symlink";
  readonly mode: number; readonly uid: string; readonly gid: string; readonly mtimeNs: string; readonly size?: number;
  readonly contentHash?: string; readonly hardlinkGroup?: string; readonly sourceInode?: string; readonly linkTarget?: string;
}
export interface CacheTreeObservation {
  readonly digest: string; readonly paths: ReadonlySet<string>; readonly bytes: number;
  readonly metadata: ReadonlyMap<string, CacheNodeMetadata>;
}

/** The digest excludes ctime/atime/inode numbers, which cannot be restored.
 * It includes contents, modes, owners, nanosecond mtime, raw link targets and
 * hardlink groups within the selected roots. All source reads are checked. */
export async function digestCacheTrees(root: string, roots: readonly string[], signal?: AbortSignal): Promise<CacheTreeObservation> {
  const directory = openDirectory(root), hash = createHash("sha256"), paths = new Set<string>();
  let device: bigint;
  const owner = process.getuid?.(), groups = new Set([process.getgid?.(), ...(process.getgroups?.() ?? [])]);
  const metadata = new Map<string, CacheNodeMetadata>();
  const links = new Map<string, string>(); let bytes = 0;
  const attributes = (stat: BigIntStats): CacheNodeMetadata => ({
    type: stat.isDirectory() ? "dir" : stat.isFile() ? "file" : "symlink", mode: Number(stat.mode) & 0o7777,
    uid: String(stat.uid), gid: String(stat.gid), mtimeNs: String(stat.mtimeNs),
    ...(stat.isFile() ? { size: Number(stat.size) } : {}),
  });
  const record = (path: string, stat: BigIntStats, extra: readonly unknown[]): void => {
    paths.add(path); metadata.set(path, { ...attributes(stat),
      ...(stat.isFile() ? { contentHash: String(extra[3]), hardlinkGroup: String(extra[2]), sourceInode: String(stat.ino) } : {}),
      ...(stat.isSymbolicLink() ? { linkTarget: String(extra[1]) } : {}),
    });
    hash.update(JSON.stringify([path, Number(stat.mode), String(stat.uid), String(stat.gid), String(stat.mtimeNs), ...extra]) + "\n");
  };
  const walk = async (parent: number, name: string, path: string): Promise<void> => {
    checkSignal(signal); await setImmediate();
    const before = statAt(parent, name, { bigint: true });
    if (before.dev !== device) throw new StoreError("UNSUPPORTED_PROFILE", "session storage refuses nested mounts; original workspace retained");
    if (Number(before.uid) !== owner || !groups.has(Number(before.gid)))
      throw new StoreError("UNSUPPORTED_PROFILE", "session ownership cannot be restored by this user; original workspace retained");
    assertNoUnpreservedMetadataAt(parent, name);
    if (before.isSymbolicLink()) {
      const target = readlinkBytesAt(parent, name);
      if (!same(before, statAt(parent, name, { bigint: true }))) throw new StoreError("REF_STATE_UNKNOWN", "session link changed");
      record(path, before, ["link", target.toString("base64")]); return;
    }
    if (!before.isFile() && !before.isDirectory())
      throw new StoreError("UNSUPPORTED_PROFILE", `session storage cannot safely preserve a special file: ${path}`);
    const fd = before.isDirectory() ? openBeneath(parent, name, constants.O_RDONLY | constants.O_DIRECTORY) : openRegularBeneath(parent, name);
    await withAsyncCleanup(async () => {
      if (!same(before, fstatSync(fd, { bigint: true }))) throw new StoreError("REF_STATE_UNKNOWN", "session entry changed");
      if (before.isDirectory()) {
        record(path, before, ["directory"]);
        const names = directoryNames(fd);
        for (const child of names) await walk(fd, child, `${path}/${child}`);
      } else {
        const identity = `${before.dev}:${before.ino}`, first = links.get(identity) ?? path;
        links.set(identity, first); bytes += Number(before.size);
        record(path, before, ["file", String(before.size), first, await digestDescriptor(fd, signal)]);
      }
      if (!same(before, fstatSync(fd, { bigint: true }))) throw new StoreError("REF_STATE_UNKNOWN", "session entry changed");
    }, () => closeSync(fd));
  };
  return withAsyncCleanup(async () => {
    device = fstatSync(directory, { bigint: true }).dev;
    for (const path of [...roots].sort()) {
      const parts = path.split("/");
      if (parts.some(part => !part || part === "." || part === ".." || part.includes("\0")))
        throw new StoreError("STORE_CORRUPT", "invalid session cache root");
      for (let n = 1; n < parts.length; n++) {
        const path = parts.slice(0, n).join("/"); paths.add(path);
        const fd = openBeneath(directory, path, constants.O_RDONLY | constants.O_DIRECTORY);
        try { metadata.set(path, attributes(fstatSync(fd, { bigint: true }))); } finally { closeSync(fd); }
      }
      const parent = parts.length === 1 ? directory : openBeneath(directory, parts.slice(0, -1).join("/"), constants.O_RDONLY | constants.O_DIRECTORY);
      await withAsyncCleanup(() => walk(parent, parts.at(-1)!, path), () => { if (parent !== directory) closeSync(parent); });
    }
    return { digest: hash.digest("hex"), paths, bytes, metadata };
  }, () => closeSync(directory));
}

/** A caller-owned source and destination in one state root, resolved once.
 * The caller holds the society fence, has selected a verified checkpoint,
 * and proves all writers stopped before replacing these derived caches. */
export function moveCacheTree(root: string, from: string, to: string): void {
  const held = openDirectory(root);
  withCleanup(() => {
    const sourceParent = dirname(from), targetParent = dirname(to);
    const left = sourceParent === "." ? held : openBeneath(held, sourceParent, constants.O_RDONLY | constants.O_DIRECTORY);
    withCleanup(() => {
      const right = targetParent === "." ? held : openBeneath(held, targetParent, constants.O_RDONLY | constants.O_DIRECTORY);
      withCleanup(() => {
        const sourceName = from.slice(sourceParent === "." ? 0 : sourceParent.length + 1);
        const targetName = to.slice(targetParent === "." ? 0 : targetParent.length + 1);
        renameAt(left, sourceName, right, targetName);
        fsyncHeldDir(left, join(root, sourceParent));
        if (right !== left) fsyncHeldDir(right, join(root, targetParent));
      }, () => { if (right !== held) closeSync(right); });
    }, () => { if (left !== held) closeSync(left); });
  }, () => closeSync(held));
}

/** Read an owned command spool without retaining its entire file list. */
export async function* cacheFileLines(path: string): AsyncGenerator<string> {
  const parent = openDirectory(dirname(path));
  let fd: number | undefined;
  let failed: { readonly error: unknown } | undefined;
  try {
    fd = openRegularBeneath(parent, basename(path));
    const buffer = Buffer.alloc(64 * 1024); let pending = Buffer.alloc(0);
    for (;;) {
      const count = readSync(fd, buffer, 0, buffer.length, null);
      if (count === 0) break;
      const bytes = Buffer.concat([pending, buffer.subarray(0, count)]); let at = 0;
      for (let end = bytes.indexOf(10); end >= 0; end = bytes.indexOf(10, at)) {
        yield decodeUtf8(bytes.subarray(at, end)); at = end + 1;
      }
      pending = Buffer.from(bytes.subarray(at)); await setImmediate();
    }
    if (pending.length) yield decodeUtf8(pending);
  } catch (error) { failed = { error }; throw error; }
  finally {
    const cleanup = (): void => cleanupAll([() => { if (fd !== undefined) closeSync(fd); }, () => closeSync(parent)]);
    const primary = failed;
    if (primary !== undefined) withCleanup(() => { throw primary.error; }, cleanup);
    else cleanup();
  }
}
