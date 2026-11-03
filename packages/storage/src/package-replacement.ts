/** Reversible host package publication under the package-store lease.
 * No ledger/receipt authority. A durable preimage precedes every replacement;
 * a new owner rolls an uncommitted install back before invoking another engine. */
import { closeSync, fchmodSync, fstatSync, fsyncSync, readFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { join } from "node:path";
import { directoryNames, mkdirAt, reopenDirectory } from "@oma/file-descriptors";
import { renameAt, statAt } from "@oma/native/posix-files";
import { openDirectory, openRegularBeneath } from "@oma/native/files";
import { withCleanup } from "@oma/native/cleanup";
import { StoreError } from "@oma/domain/errors";
import { decodeUtf8 } from "@oma/domain/utf8";
import { openOwnedDirectory, openOwnedDirectoryPath, removeOwnedEntryAt } from "./directory.js";
import { replaceDerivedEntry, writeExclusiveFsyncedEntry } from "./durable-fs.js";
import { STAGING_PREFIX } from "./package-staging.js";

const PREFIX = ".replacement-local-";
const CHANGE = "change.json", MAX_CONTROL_BYTES = 16 * 1024 * 1024;
interface SavedFile { name: string; existed: boolean; mode: number; sha256: string | null }
interface Change { version: 1; target: string; hadOld: boolean; phase: "prepared" | "installing" | "restoring" | "committed"; files: SavedFile[] }
const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === "ENOENT";
function corrupt(): never { throw new StoreError("STORE_CORRUPT", "local package replacement evidence is invalid; retain its preimages"); }
function parts(target: string): string[] {
  const value = target.split("/");
  if (value[0] !== "local" || value.length < 2 || value.some(part => !part || part === "." || part === ".." || /[\\\0]/.test(part))) corrupt();
  return value;
}
function read(parent: number, name: string): { bytes: Buffer; mode: number } | null {
  let fd: number;
  try { fd = openRegularBeneath(parent, name); } catch (error) { if (missing(error)) return null; throw error; }
  try {
    const before = fstatSync(fd);
    if (before.uid !== process.getuid?.() || before.nlink !== 1 || before.size > MAX_CONTROL_BYTES) corrupt();
    const bytes = readFileSync(fd), after = fstatSync(fd);
    if (bytes.length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) corrupt();
    return { bytes, mode: before.mode & 0o777 };
  } finally { closeSync(fd); }
}
function parentOf(root: number, target: string): { fd: number; name: string; close(): void } | null {
  const names = parts(target), name = names.pop()!; let fd = root;
  try {
    for (const part of names) {
      const next = openOwnedDirectory(fd, part);
      if (fd !== root) closeSync(fd); fd = next;
    }
    const held = fd;
    return { fd, name, close: () => { if (held !== root) closeSync(held); } };
  } catch (error) { if (fd !== root) closeSync(fd); if (missing(error)) return null; throw error; }
}
function decode(bytes: Buffer, names: readonly string[]): Change {
  let raw: unknown; try { raw = JSON.parse(decodeUtf8(bytes)); } catch { return corrupt(); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return corrupt();
  // SAFETY: every field, exact key set, phase and snapshot relation is checked below before use.
  const value = raw as Change;
  if (Object.keys(raw).sort().join() !== "files,hadOld,phase,target,version" || value.version !== 1 || typeof value.target !== "string" ||
      typeof value.hadOld !== "boolean" || !["prepared", "installing", "restoring", "committed"].includes(value.phase) || !Array.isArray(value.files) || value.files.length !== names.length) corrupt();
  parts(value.target);
  for (const [index, file] of value.files.entries()) {
    if (!file || Object.keys(file).sort().join() !== "existed,mode,name,sha256" || file.name !== names[index] || typeof file.existed !== "boolean" ||
        !Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777 || (file.existed ? typeof file.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(file.sha256) : file.sha256 !== null)) corrupt();
  }
  return value;
}
export interface PackageReplacement { commit(): void; rollback(): void; close(): void }
class Replacement implements PackageReplacement {
  private closed = false;
  private settled = false;
  constructor(private root: number, private directory: number, private slot: string, private path: string, private change: Change) {}
  private save(phase: Change["phase"]): void {
    this.change.phase = phase;
    replaceDerivedEntry(this.directory, CHANGE, join(this.path, this.slot, CHANGE), JSON.stringify(this.change) + "\n");
  }
  protect(): void {
    const parent = parentOf(this.root, this.change.target);
    if (parent) try {
      if (this.change.hadOld) { renameAt(parent.fd, parent.name, this.directory, "previous"); fsyncSync(parent.fd); fsyncSync(this.directory); }
    } finally { parent.close(); }
    this.save("installing");
  }
  commit(): void { if (this.settled) return; this.save("committed"); this.settled = true; this.collect(); }
  rollback(): void {
    if (this.settled) return;
    // A failed post-commit cleanup must never roll an installed package back.
    const current = read(this.directory, CHANGE); if (!current) corrupt();
    this.change = decode(current.bytes, this.change.files.map(file => file.name));
    if (this.change.phase === "committed") { this.collect(); return; }
    const before = this.change.phase;
    // Validate all control preimages before the first restoration effect.
    const snapshots = this.change.files.map((file, index) => {
      const saved = file.existed ? read(this.directory, `file-${index}`) : null;
      if (file.existed && (!saved || sha(saved.bytes) !== file.sha256)) corrupt();
      return saved;
    });
    const parent = parentOf(this.root, this.change.target);
    try {
      const previous = statAt(this.directory, "previous", { throwIfNoEntry: false });
      if (this.change.hadOld && !previous && before === "installing") corrupt();
      if (this.change.hadOld && !previous && (!parent || !statAt(parent.fd, parent.name, { throwIfNoEntry: false }))) corrupt();
      this.save("restoring");
      if (parent) {
        if (previous || !this.change.hadOld) removeOwnedEntryAt(parent.fd, parent.name);
        if (previous) renameAt(this.directory, "previous", parent.fd, parent.name);
        fsyncSync(parent.fd); fsyncSync(this.directory);
      } else if (previous) corrupt();
    } finally { parent?.close(); }
    for (const [index, file] of this.change.files.entries()) {
      // AUD-16: the preimage is restored as it existed -- bytes and mode. An
      // exclusive create is masked by this process's umask, so a rollback
      // under a restrictive one (077) would otherwise narrow the recorded
      // mode; this hook sets exactly what was saved. Every other create keeps
      // its umask semantics.
      if (file.existed) replaceDerivedEntry(this.root, file.name, join(this.path, file.name), snapshots[index]!.bytes, file.mode,
        fd => fchmodSync(fd, file.mode));
      else { removeOwnedEntryAt(this.root, file.name); fsyncSync(this.root); }
    }
    this.settled = true;
    this.collect();
  }
  private collect(): void {
    const garbage = `${STAGING_PREFIX}replaced-${randomUUID()}`;
    renameAt(this.root, this.slot, this.root, garbage); fsyncSync(this.root);
    removeOwnedEntryAt(this.root, garbage); fsyncSync(this.root);
  }
  close(): void {
    if (this.closed) return; this.closed = true;
    withCleanup(() => closeSync(this.directory), () => closeSync(this.root));
  }
}
function validateNames(names: readonly string[]): void {
  if (names.length === 0 || new Set(names).size !== names.length || names.some(name => !name || name === "." || name === ".." || /[\/\\\0]/.test(name))) corrupt();
}
/** The caller holds the package-store lease until this change is committed/rolled back and closed. */
export function preparePackageReplacement(path: string, target: string, names: readonly string[]): PackageReplacement {
  validateNames(names); parts(target);
  const root = openOwnedDirectoryPath(path), draft = `${STAGING_PREFIX}change-${randomUUID()}`, slot = `${PREFIX}${randomUUID()}`;
  let directory: number | undefined, published = false;
  try {
    mkdirAt(root, draft, 0o700); directory = openOwnedDirectory(root, draft);
    const files: SavedFile[] = names.map((name, index) => {
      const saved = read(root, name);
      if (saved) writeExclusiveFsyncedEntry(directory!, `file-${index}`, join(path, draft, `file-${index}`), saved.bytes);
      return { name, existed: saved !== null, mode: saved?.mode ?? 0o600, sha256: saved ? sha(saved.bytes) : null };
    });
    const parent = parentOf(root, target);
    let hadOld = false;
    try { hadOld = Boolean(parent && statAt(parent.fd, parent.name, { throwIfNoEntry: false })); } finally { parent?.close(); }
    const change: Change = { version: 1, target, hadOld, phase: "prepared", files };
    writeExclusiveFsyncedEntry(directory, CHANGE, join(path, draft, CHANGE), JSON.stringify(change) + "\n");
    fsyncSync(directory); renameAt(root, draft, root, slot); published = true; fsyncSync(root);
    const replacement = new Replacement(root, directory, slot, path, change);
    try { replacement.protect(); return replacement; }
    catch (error) { return withCleanup(() => { throw error; }, () => replacement.rollback()); }
  } catch (error) {
    return withCleanup(() => { throw error; }, () => {
      try { if (!published) removeOwnedEntryAt(root, draft); }
      finally { try { if (directory !== undefined) closeSync(directory); } finally { closeSync(root); } }
    });
  }
}
/** Read-only admission: no runtime may load an uncommitted replacement after writer death. */
export function assertPackageReplacementSettled(path: string): void {
  const root = openDirectory(path);
  withCleanup(() => {
    if (directoryNames(root).some(name => name.startsWith(PREFIX)))
      throw new StoreError("BROKER_UNAVAILABLE", "a local package replacement must recover before use; run oma pi list");
  }, () => closeSync(root));
}
/** Recover before any package engine/index read, under the same package-store lease. */
export function recoverPackageReplacements(path: string, names: readonly string[]): void {
  validateNames(names);
  const root = openOwnedDirectoryPath(path);
  try {
    for (const slot of directoryNames(root).sort()) {
      if (!slot.startsWith(PREFIX)) continue;
      const held = openOwnedDirectory(root, slot);
      let ownRoot: number | undefined, replacement: Replacement;
      try {
        ownRoot = reopenDirectory(root);
        const saved = read(held, CHANGE); if (!saved) corrupt();
        replacement = new Replacement(ownRoot, held, slot, path, decode(saved.bytes, names));
      } catch (error) { closeSync(held); if (ownRoot !== undefined) closeSync(ownRoot); throw error; }
      withCleanup(() => replacement.rollback(), () => replacement.close());
    }
  } finally { closeSync(root); }
}
