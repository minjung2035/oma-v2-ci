import { utf8Decoder } from "./descriptor-files.js";
/** The model's file effects, contained by the way they are made (R6-01,
 * PR-004, architecture §4: the check and the effect are one resolution).
 *
 * Workspace descendants are opened from held directories with no-follow
 * native operations. Policy, inode checks and snapshot ownership stay here;
 * only descriptor mechanics cross the private native adapter (NATIVE-025).
 */
import { closeSync, constants, fstatSync, ftruncateSync, readSync, writeSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { setImmediate } from "node:timers/promises";

import { WorkspaceRefusal } from "./errors.js";
import { descriptorPath, directoryNames, mkdirAt, openAt, openRoot, unlinkAt } from "./descriptor-files.js";
export { WorkspaceRefusal } from "./errors.js";

const ANCESTOR_IGNORE_FILES = [".gitignore", ".ignore", ".rgignore", ".fdignore"] as const;

/** The components of a path inside the workspace, or a refusal. */
export function componentsWithin(root: string, path: string): string[] {
  if (typeof path !== "string" || path.includes("\0")) throw new WorkspaceRefusal("tool path is invalid");
  const offset = relative(root, resolve(root, path));
  if (offset === "") return [];
  if (offset === ".." || offset.startsWith(`..${sep}`) || isAbsolute(offset)) throw new WorkspaceRefusal("tool path is outside the agent workspace");
  return offset.split(sep);
}

/** The errno a thrown value carries, if any. A throw site is not obliged
 * to produce an object -- a null, string or number throw carries no
 * `.code` at all, and reading it blind would make the error handler
 * itself throw TypeError in place of the real error. */
function errnoCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null
    ? (error as NodeJS.ErrnoException).code
    : undefined;
}

function refusedLink(error: unknown): never {
  const code = errnoCode(error);
  if (code === "ELOOP" || code === "ENOTDIR") throw new WorkspaceRefusal("tool path passes through a link or a non-directory; links are not followed");
  throw error;
}

/** True when `error` is the descriptor-table overrun the snapshot's depth
 * is bounded by -- EMFILE or ENFILE -- checked without assuming the
 * thrown value's shape, so a non-object throw cannot turn the check
 * itself into a TypeError. Exported for the search child's own error
 * mapping, which classifies the same overrun raised inside the engine
 * walker the snapshot hands to it. */
export function isDescriptorOverrun(error: unknown): boolean {
  const code = errnoCode(error);
  return code === "EMFILE" || code === "ENFILE";
}

/** A descriptor-table overrun is the snapshot's only depth bound, and it
 * refuses in words rather than escaping as a bare errno: any EMFILE or
 * ENFILE the snapshot machinery raises -- the held-directory walk, a source
 * readdir or open, a destination open, the cleanup itself -- becomes this
 * refusal, which a caller can surface with its reason intact. */
function descriptorRefusal(error: unknown): never {
  if (isDescriptorOverrun(error)) throw new WorkspaceRefusal("search snapshot ran out of file descriptors");
  throw error;
}

/** A descriptor on the directory `components` names, walked from the root. */
function openDirectoryWithin(root: string, components: readonly string[], create: boolean): number {
  let fd: number;
  try { fd = openRoot(root); }
  catch (error) { refusedLink(error); }
  try {
    for (const part of components) {
      let next: number;
      try { next = openAt(fd, part, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); }
      catch (error) {
        if (!create || (error as NodeJS.ErrnoException).code !== "ENOENT") refusedLink(error);
        try { mkdirAt(fd, part, 0o755); }
        catch (made) { if ((made as NodeJS.ErrnoException).code !== "EEXIST") throw made; }
        try { next = openAt(fd, part, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); }
        catch (again) { refusedLink(again); }
      }
      closeSync(fd);
      fd = next;
    }
    return fd;
  } catch (error) { closeSync(fd); throw error; }
}

/** Opens the named entry itself, never through a link. */
function openEntryWithin(root: string, path: string, flags: number, mode = 0o644): number {
  const components = componentsWithin(root, path);
  if (components.length === 0) {
    // The workspace itself: a directory, which no tool writes as a file.
    if ((flags & (constants.O_WRONLY | constants.O_RDWR)) !== 0) throw new WorkspaceRefusal("tool path is the workspace itself");
    return openDirectoryWithin(root, [], false);
  }
  const parent = openDirectoryWithin(root, components.slice(0, -1), false);
  try {
    // A FIFO must reach the inode/type guard without waiting for another
    // endpoint. O_NONBLOCK has no effect on ordinary files or directories.
    try { return openAt(parent, components.at(-1)!, flags | constants.O_NOFOLLOW | constants.O_NONBLOCK, mode); }
    catch (error) { refusedLink(error); }
  } finally { closeSync(parent); }
}

/** A regular file with no other name: a hard link would carry a write to
 * wherever else that file is named. */
function ownedFile(fd: number) {
  const stat = fstatSync(fd);
  if (!stat.isFile()) throw new WorkspaceRefusal("tool path is not a regular file");
  if (stat.nlink === 0) throw new WorkspaceRefusal("tool path is no longer a named file");
  if (stat.nlink > 1) throw new WorkspaceRefusal("tool path is a file with other names; it is not written through");
  return stat;
}

/** Borrows the newly opened file description for the callback. On Darwin its
 * descriptor alias shares the cursor; this is not an independent reopen. */
export async function withFileWithin<T>(root: string, path: string, use: (held: string) => Promise<T>): Promise<T> {
  const fd = openEntryWithin(root, path, constants.O_RDONLY);
  try { ownedFile(fd); return await use(descriptorPath(fd)); } finally { closeSync(fd); }
}

export function readWithin(root: string, path: string): Buffer {
  const fd = openEntryWithin(root, path, constants.O_RDONLY);
  try {
    ownedFile(fd);
    const size = fstatSync(fd).size;
    const buffer = Buffer.alloc(size);
    let filled = 0;
    while (filled < size) { const count = readSync(fd, buffer, filled, size - filled, filled); if (count === 0) break; filled += count; }
    return buffer.subarray(0, filled);
  } finally { closeSync(fd); }
}
/** One bounded, stable input snapshot through the ordinary descriptor-relative
 * file boundary. This does not alter the vendor read tool's existing behavior. */
export function readBoundedWithin(root: string, path: string, maximum: number): Buffer {
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new WorkspaceRefusal("invalid source byte bound");
  const fd = openEntryWithin(root, path, constants.O_RDONLY);
  try {
    ownedFile(fd);
    const before = sampleFile(fd);
    if (before.size < 0n || before.size > BigInt(maximum)) throw new WorkspaceRefusal("SOURCE_UNREADABLE: source exceeds its effective byte bound");
    const size = Number(before.size), bytes = Buffer.alloc(size + 1);
    let used = 0;
    while (used < bytes.length) {
      const count = readSync(fd, bytes, used, bytes.length - used, used);
      if (count === 0) break;
      used += count;
    }
    if (used !== size || !sameSample(before, sampleFile(fd))) throw new WorkspaceRefusal("SOURCE_CHANGED: source changed during its snapshot");
    return bytes.subarray(0, size);
  } finally { closeSync(fd); }
}

export function accessWithin(root: string, path: string, write: boolean): void {
  const fd = openEntryWithin(root, path, write ? constants.O_RDWR : constants.O_RDONLY);
  try { ownedFile(fd); } finally { closeSync(fd); }
}

export function writeWithin(root: string, path: string, content: string | Buffer): void {
  // Opened without truncating, checked, then emptied: a file with another
  // name is refused before a byte of it changes.
  const fd = openEntryWithin(root, path, constants.O_WRONLY | constants.O_CREAT, 0o644);
  try {
    ownedFile(fd);
    ftruncateSync(fd, 0);
    const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    for (let at = 0; at < bytes.length; ) at += writeSync(fd, bytes, at, bytes.length - at, at);
  } finally { closeSync(fd); }
}

/** The refusal text `writeWithinUnchanged` raises when the opened inode is
 * not the one the caller read. Exported so a caller that must translate the
 * refusal into another failure contract (the bundled hashline runtime's
 * `[E_PATH_CHANGED]` wording) can recognize it exactly instead of matching
 * on a paraphrase. */
export const FILE_CHANGED_REFUSAL = "tool path resolves to a different file than the one read";

/** Inode identity for anchored edits, or exact input text for computed fixes. */
export type WriteExpectation = { dev: number; ino: number } | { text: string };
export const FILE_CONTENT_CHANGED_REFUSAL = "tool file contents changed since the fix was computed; recompute the fix";

/** Observable identity, ownership and content-change evidence on the held
 * inode. Equal timestamps alone do not prove that no mutation happened. */
type FileSample = { size: bigint; dev: bigint; ino: bigint; nlink: bigint; mtimeNs: bigint; ctimeNs: bigint };
function sampleFile(fd: number): FileSample {
  const stat = fstatSync(fd, { bigint: true });
  return { size: stat.size, dev: stat.dev, ino: stat.ino, nlink: stat.nlink, mtimeNs: stat.mtimeNs, ctimeNs: stat.ctimeNs };
}
function sameSample(left: FileSample, right: FileSample): boolean {
  // A new alias is observable even when timestamps share one filesystem tick.
  return left.nlink === 1n && right.nlink === 1n && left.size === right.size && left.dev === right.dev && left.ino === right.ino &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

/** Open without O_CREAT and check the caller's expectation on that descriptor
 * before truncation. Hashline retains its dev+ino identity semantics; computed
 * fixes compare exact UTF-8 input bytes to detect in-place concurrent writes,
 * and then sample the same descriptor again -- a writer that landed an append
 * (or any other mutation) after the comparison would be truncated away, so
 * the refused span covers the whole validation-to-truncation window rather
 * than only the read. A writer that mutates after that final sample is beyond
 * a check-and-write without kernel locking, and this does not claim otherwise:
 * concurrent writers outside the shared writer's serialization are detected
 * up to the truncation, not excluded.
 * The shared tool writer calls this inside its serialization boundary. */
export function writeWithinUnchanged(root: string, path: string, content: string, expected: WriteExpectation): void {
  const fd = openEntryWithin(root, path, "text" in expected ? constants.O_RDWR : constants.O_WRONLY);
  try {
    ownedFile(fd);
    if ("text" in expected) {
      const opened = sampleFile(fd);
      const bytes = Buffer.alloc(Number(opened.size));
      let filled = 0;
      while (filled < bytes.length) {
        const count = readSync(fd, bytes, filled, bytes.length - filled, filled);
        if (count === 0) break;
        filled += count;
      }
      if (filled !== bytes.length || !bytes.equals(Buffer.from(expected.text, "utf8")))
        throw new WorkspaceRefusal(FILE_CONTENT_CHANGED_REFUSAL);
      if (!sameSample(opened, sampleFile(fd))) throw new WorkspaceRefusal(FILE_CONTENT_CHANGED_REFUSAL);
    } else {
      const stat = ownedFile(fd);
      if (stat.dev !== expected.dev || stat.ino !== expected.ino) throw new WorkspaceRefusal(FILE_CHANGED_REFUSAL);
    }
    ftruncateSync(fd, 0);
    const bytes = Buffer.from(content, "utf8");
    for (let at = 0; at < bytes.length; ) at += writeSync(fd, bytes, at, bytes.length - at, at);
  } finally { closeSync(fd); }
}

export function mkdirWithin(root: string, path: string): void {
  closeSync(openDirectoryWithin(root, componentsWithin(root, path), true));
}

export function isDirectoryWithin(root: string, path: string): boolean {
  const fd = openEntryWithin(root, path, constants.O_RDONLY);
  try { return fstatSync(fd).isDirectory(); } finally { closeSync(fd); }
}

export function existsWithin(root: string, path: string): boolean {
  try { closeSync(openEntryWithin(root, path, constants.O_RDONLY)); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

/** G10-02: pathname walkers see only a private copy of approved inodes, never
 * the mutable workspace. The selected file/subtree and its ancestor ignore
 * files stay held while read; unrelated siblings are never walked.
 * No links are copied. Depth is not refused: the source side holds one descriptor per
 * open level -- the workspace is the untrusted tree, so a component swapped
 * mid-copy cannot redirect a read -- and the destination side holds one per
 * open level too. The private `oma-search-*` tree is only mode-700: a same-uid
 * racer can still rename its directories or plant names inside it, so the
 * copy's own writes are made through directory-relative operations -- a
 * held parent cannot be swapped for a link, and a planted leaf name only
 * ever fails the copy closed (EEXIST/ELOOP), never carries a write through.
 * Both sides cost one descriptor per open level, so an OS descriptor bound
 * is the only depth limit and it refuses honestly, in words, rather than
 * quietly dropping back to path writes.
 *
 * `named` is a declaration, not a notification: it is called with each
 * candidate name BEFORE that directory is created, so a caller that names
 * the copy to a supervising parent can order the announcement ahead of the
 * fs effect -- a copy that exists was always declared first. A `named` that
 * cannot carry the declaration must throw: the snapshot then fails before
 * anything is made rather than exist undeclared. */
export interface SearchSnapshotSelection {
  /** Runs the pinned tool over names and allowed ignore controls only. */
  select?: (snapshot: string, target: string) => AsyncIterable<string>;
  namesOnly?: boolean;
  observed?: (metrics: {paths:number;selectedFiles:number;readBytes:number;copiedBytes:number;elapsedMs:number}) => void;
}
const fingerprint = (fd: number): string => {
  const s=fstatSync(fd,{bigint:true});return [s.dev,s.ino,s.size,s.mode,s.nlink,s.mtimeNs,s.ctimeNs].join(":");
};
export async function withSearchSnapshot<T>(root: string, path: string,
  signal: AbortSignal | undefined, use: (snapshot: string, target: string) => Promise<T>,
  progress?: () => void, named?: (snapshotName: string) => void, selection?: SearchSnapshotSelection): Promise<T> {
  try {
    return await searchSnapshot(root, path, signal, use, progress, named, selection);
  } catch (error) {
    // One boundary wording for the descriptor bound, wherever it fired.
    return descriptorRefusal(error);
  }
}

/** Snapshot cleanup never follows a planted link, including links to directories. */
function removeSnapshotAt(parent: number, name: string): void {
  let fd: number;
  try { fd = openAt(parent, name, constants.O_RDONLY | constants.O_DIRECTORY); }
  catch (error) {
    const code = errnoCode(error);
    if (code === "ENOENT") return;
    if (code !== "ENOTDIR" && code !== "ELOOP") throw error;
    try { unlinkAt(parent, name); }
    catch (missing) { if (errnoCode(missing) !== "ENOENT") throw missing; }
    return;
  }
  try { for (const entry of directoryNames(fd)) removeSnapshotAt(fd, entry); }
  finally { closeSync(fd); }
  try { unlinkAt(parent, name, true); }
  catch (error) { if (errnoCode(error) !== "ENOENT") throw error; }
}

async function searchSnapshot<T>(root: string, path: string,
  signal: AbortSignal | undefined, use: (snapshot: string, target: string) => Promise<T>,
  progress?: () => void, named?: (snapshotName: string) => void, selection?: SearchSnapshotSelection): Promise<T> {
  const parts = componentsWithin(root, path);
  if (parts.includes(".git")) throw new WorkspaceRefusal("repository internals are not a search input");
  const temp = openDirectoryWithin(tmpdir(), [], false);
  let baseName = "";
  try {
    // Declare-then-create, the ordering the parent sweep needs: the name is
    // announced before the directory exists, so a child killed or stopped in
    // the gap still had its copy's name delivered -- an undeclared snapshot
    // can never exist. A name already taken announces again fresh.
    for (;;) {
      baseName = `oma-search-${randomUUID()}`;
      named?.(baseName);
      try { mkdirAt(temp, baseName, 0o700); break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    }
  } catch (error) { closeSync(temp); throw error; }
  const snapshot = join(tmpdir(), baseName, "workspace");
  let destination: number | undefined, metadata: number | undefined;
  const started=Date.now(), metrics={paths:0,selectedFiles:0,readBytes:0,copiedBytes:0,elapsedMs:0};
  const record=(path:string,stamp:string):void=>{
    if(metadata === undefined)return;
    const bytes=Buffer.from(JSON.stringify({path,stamp})+"\n");for(let at=0;at<bytes.length;)at+=writeSync(metadata,bytes,at,bytes.length-at);
  };
  const check = (): void => { if (signal?.aborted) throw new WorkspaceRefusal("search aborted"); };
  /** A fresh name inside a held destination directory. The private tree is
   * mode-700 -- permission bits do not stop a same-uid racer -- so every
   * entry is named through the held parent, and a descriptor-table overrun
   * refuses in words instead of degrading to path writes. The same refusal
   * reaches every other site at the `withSearchSnapshot` boundary. */
  const openDestination = (parent: number, name: string, flags: number, mode?: number): number => {
    try { return openAt(parent, name, flags, mode); }
    catch (error) { return descriptorRefusal(error); }
  };
  // `fd` is the descriptor held on the source entry and `parent` the one
  // held on its name's directory inside the private copy, so neither side
  // can be swapped out from under the entry this call resolves.
  const copy = async (fd: number, parent: number, name: string, sourceRelative: string): Promise<void> => {
    check(); progress?.();
    const stat = fstatSync(fd), stamp=fingerprint(fd); metrics.paths++;
    if (stat.isDirectory()) {
      record(sourceRelative,stamp);
      mkdirAt(parent, name, 0o700);
      const into = openDestination(parent, name, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try {
        for (const entry of directoryNames(fd)) {
          check(); progress?.();
          // Repository internals are not a search input. An empty .git at the
          // copy's root stops parent ignore discovery without importing config.
          // A listed name is one directory entry -- anything else is not one.
          if (entry === ".git" || entry === "." || entry === ".." || entry.includes("/") || entry.includes("\0")) continue;
          let child: number;
          try { child = openAt(fd, entry, (selection !== undefined && process.platform === "linux" && !ANCESTOR_IGNORE_FILES.includes(entry as typeof ANCESTOR_IGNORE_FILES[number]) ? 0x200000 /* O_PATH: names need no payload access */ : constants.O_RDONLY) | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
          catch (error) {
            if (["ENOENT", "ELOOP"].includes(errnoCode(error) ?? "")) continue;
            throw error;
          }
          try {
            const current = fstatSync(child);
            if (current.isDirectory() || (current.isFile() && current.nlink === 1))
              await copy(child, into, entry, sourceRelative ? `${sourceRelative}/${entry}` : entry);
          } finally { closeSync(child); }
        }
      } finally { closeSync(into); }
    } else {
      ownedFile(fd);
      const out = openDestination(parent, name,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        if (selection !== undefined && !ANCESTOR_IGNORE_FILES.includes(name as typeof ANCESTOR_IGNORE_FILES[number])) {
          const bytes=Buffer.from(JSON.stringify({stamp}));
          for(let at=0;at<bytes.length;)at+=writeSync(out,bytes,at,bytes.length-at);
          return;
        }
        record(sourceRelative,stamp);
        const buffer = Buffer.alloc(Math.min(stat.size + 1, 64 * 1024));
        let used = 0;
        for (;;) {
          check(); progress?.();
          const count = readSync(fd, buffer, 0, buffer.length, null);
          if (count === 0) break;
          used += count;metrics.readBytes+=count;metrics.copiedBytes+=count;
          if (used > stat.size) throw new WorkspaceRefusal("search input grew during snapshot");
          for (let at = 0; at < count;) at += writeSync(out, buffer, at, count - at);
          await setImmediate();
        }
        if (used !== stat.size) throw new WorkspaceRefusal("search input changed during snapshot");
        ownedFile(fd);
        if(fingerprint(fd)!==stamp)throw new WorkspaceRefusal("search input changed during snapshot");
      } finally { closeSync(out); }
    }
    if(fingerprint(fd)!==stamp)throw new WorkspaceRefusal("search input changed during snapshot");
    await setImmediate();
  };
  try {
    destination = openAt(temp, baseName, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    if(selection !== undefined)metadata=openDestination(destination,"metadata",constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    // Hold the selected entry, not just a validation of its pathname. Ancestor
    // descriptors supply only ignore files, never a walk of their siblings.
    const sources: number[] = [openDirectoryWithin(root, [], false)];
    try {
      for (const [index, part] of parts.entries()) {
        check();
        try { sources.push(openAt(sources.at(-1)!, part, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK |
          (index < parts.length - 1 ? constants.O_DIRECTORY : 0))); }
        catch (error) { refusedLink(error); }
      }
      const selected = sources.at(-1)!;
      if (!fstatSync(selected).isDirectory()) ownedFile(selected);
      if (parts.length === 0) {
        await copy(selected, destination, "workspace", "");
      } else {
        mkdirAt(destination, "workspace", 0o700);
        let into = openDestination(destination, "workspace", constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        try {
          for (const [index, part] of parts.entries()) {
            record(parts.slice(0,index).join("/"),fingerprint(sources[index]!));
            // Keep the ancestor chain at its original workspace-relative
            // location so rooted ignore patterns and result paths retain
            // their meaning. Only engine-recognized ignore inputs belong in
            // this skeleton; copying any other sibling defeats scoped search.
            for (const ignore of ANCESTOR_IGNORE_FILES) {
              check();
              if (index === parts.length - 1 && ignore === part) continue;
              let held: number;
              try { held = openAt(sources[index]!, ignore, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
              catch (error) {
                if (["ENOENT", "ELOOP"].includes(errnoCode(error) ?? "")) continue;
                throw error;
              }
              try {
                const stat = fstatSync(held);
                if (stat.isFile() && stat.nlink === 1) await copy(held, into, ignore, [...parts.slice(0,index),ignore].join("/"));
              } finally { closeSync(held); }
            }
            if (index === parts.length - 1) {
              await copy(selected, into, part, parts.join("/"));
            } else {
              mkdirAt(into, part, 0o700);
              const next = openDestination(into, part, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
              closeSync(into); into = next;
            }
          }
        } finally { closeSync(into); }
      }
    } finally { for (let index = sources.length - 1; index >= 0; index--) closeSync(sources[index]!); }
    const copied = openAt(destination, "workspace", constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { mkdirAt(copied, ".git", 0o700); } finally { closeSync(copied); }
    check();
    if(selection?.select !== undefined && !selection.namesOnly) {
      for await(const selectedPath of selection.select(snapshot,join(snapshot,...parts))) {
        check();progress?.();
        const selectedParts=componentsWithin(snapshot,selectedPath), path=selectedParts.join("/");
        if(selectedParts.includes(".git"))throw new WorkspaceRefusal("selection entered repository internals");
        metrics.selectedFiles++;
        // Ignore control bytes were already copied and are checked below.
        if(ANCESTOR_IGNORE_FILES.includes(basename(path) as typeof ANCESTOR_IGNORE_FILES[number]))continue;
        const marker=JSON.parse(readWithin(snapshot,path).toString("utf8")) as {stamp?:unknown};
        if(typeof marker.stamp!=="string")throw new WorkspaceRefusal("search metadata changed during selection");
        const source=openEntryWithin(root,path,constants.O_RDONLY|constants.O_NONBLOCK);
        try {
          ownedFile(source);if(fingerprint(source)!==marker.stamp)throw new WorkspaceRefusal("search input changed during selection");
          const destination=openEntryWithin(snapshot,path,constants.O_WRONLY);
          try {
            ownedFile(destination);ftruncateSync(destination,0);
            const bytes=Buffer.alloc(65536);let used=0;
            for(;;){check();progress?.();const count=readSync(source,bytes,0,bytes.length,null);if(count===0)break;
              used+=count;metrics.readBytes+=count;metrics.copiedBytes+=count;
              for(let at=0;at<count;)at+=writeSync(destination,bytes,at,count-at);await setImmediate();
            }
            if(fingerprint(source)!==marker.stamp || used!==fstatSync(source).size)throw new WorkspaceRefusal("search input changed during copy");
            record(path,marker.stamp);
          }finally{closeSync(destination);}
        }finally{closeSync(source);}
      }
    }
    if(metadata !== undefined) {
      // Directory/control/selected-file observations are spooled, not a
      // whole-tree path array. A renamed tree or changed ignore file refuses.
      const bytes=Buffer.alloc(65536);let offset=0,tail="";
      const decoder=utf8Decoder();
      for(;;){const count=readSync(metadata,bytes,0,bytes.length,offset);offset+=count;
        tail+=decoder.decode(bytes.subarray(0,count),{stream:count>0});
        for(;;){const end=tail.indexOf("\n");if(end<0)break;const item=JSON.parse(tail.slice(0,end)) as {path:string;stamp:string};tail=tail.slice(end+1);
          const held=openEntryWithin(root,item.path,process.platform === "linux" ? 0x200000 : constants.O_RDONLY);
          try{if(fingerprint(held)!==item.stamp)throw new WorkspaceRefusal("search paths or ignore controls changed during selection");}finally{closeSync(held);}
          check();progress?.();
        }
        if(count===0)break;await setImmediate();
      }
      if(tail)throw new WorkspaceRefusal("search metadata is incomplete");
    }
    metrics.elapsedMs=Date.now()-started;selection?.observed?.(metrics);
    return await use(snapshot, join(snapshot, ...parts));
  } finally {
    if(metadata !== undefined)closeSync(metadata);
    if (destination !== undefined) closeSync(destination);
    try { removeSnapshotAt(temp, baseName); } finally { closeSync(temp); }
  }
}

export function readdirWithin(root: string, path: string): string[] {
  const fd = openDirectoryWithin(root, componentsWithin(root, path), false);
  try { return directoryNames(fd); } finally { closeSync(fd); }
}

export { createResult, readResult, isResultReference, utf8Prefix, RESULT_PREVIEW_BYTES, RESULT_PAGE_BYTES } from "./results.js";
export type { ResultReference, ResultRange } from "./results.js";
