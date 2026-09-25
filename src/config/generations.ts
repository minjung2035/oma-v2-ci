/** D02/WP13: managed configuration generations.
 *
 * An operations bundle edited by the product is published as one immutable
 * generation directory below its index root, and the ordinary manifest file is
 * replaced last. A reader resolves the manifest once, so it sees the whole old
 * or the whole new generation; the loader itself is unchanged (reader first).
 *
 *   <root>/config.json                                  the only commit pointer
 *   <root>/.oma-config/generations/<id>/host.json
 *   <root>/.oma-config/generations/<id>/models.json
 *   <root>/.oma-config/generations/<id>/roles/<profile>.json
 *   <root>/.oma-config/generations/<id>/prompts/<profile>.md
 *
 * Manual bundles keep their files: the first managed edit copies them into a
 * generation and switches only the manifest. Generations are read-only once
 * published, so a writer that still patches files in place is refused by the
 * filesystem instead of mutating a generation readers rely on.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync, constants, fchmodSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync,
  readdirSync, readFileSync, readSync, renameSync, unlinkSync, writeSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import type { HostConfigV1 } from "../../implementation/contracts.js";
import { StoreError, normalizeStorageFailure } from "../domain/errors.js";
import { validateConfig, type ConfigurationSnapshot, type ValidatedConfigCandidate } from "../config.js";
import { readConfigurationSource } from "./operations.js";
import {
  ensureDurableDirectory, fsyncDir, fsyncHeldDir, writeExclusiveFsyncedEntry, writeExclusiveFsyncedFile, faultAt, isDurabilityFault,
  type DurabilityObserver,
} from "../storage/durable-fs.js";
import { removeOwnedFile, removeOwnedTree } from "../storage/directory.js";
import { entryAt, openBeneath, openRegularBeneath, withinDirectory } from "../storage/contained-fs.js";

export const MANAGED_DIRECTORY = ".oma-config";
/** D02 editing budget, not a reading rule: a valid bundle of any shape stays
 * readable; only an edit that would exceed these is refused until a quiescent
 * start collects what no reader can still use. The loader's own closure budget
 * (256 files, 8 MiB) bounds one generation, so sixteen fit in far less. */
export interface ManagedLimits { readonly generations: number; readonly bytes: number }
export const MANAGED_LIMITS: ManagedLimits = Object.freeze({ generations: 16, bytes: 256 * 1024 * 1024 });
const GENERATION_ID = /^g-[0-9a-f]{64}$/;
const JOURNAL = "committed";

/** What a managed edit is derived from: a runnable snapshot, or the editable
 * source of WP14's limited repair. Only authored roles, prompts, the source
 * closure and the validated host configuration are used; whether the result
 * runs is proven by the full loader before publication. */
export type ManagedSource = Pick<ConfigurationSnapshot, "config" | "layout" | "authoredRoles" | "sourceFiles"> &
  { readonly roles: Readonly<Record<string, { readonly prompt: string }>> };

/** A role's authored parts a managed edit may carry forward or replace. */
export interface ManagedRole {
  readonly agentProfile: unknown;
  readonly extensions: readonly string[];
  readonly toolSurface?: unknown;
  readonly prompt: Buffer;
}
export interface ManagedEdit {
  /** The complete candidate, already validated and revised by its owner. */
  readonly config: ValidatedConfigCandidate;
  /** Authored role parts that differ from the snapshot (extension selection). */
  readonly roles?: Readonly<Record<string, Partial<Pick<ManagedRole, "extensions">>>>;
}
export type ManagedCommit =
  | { readonly kind: "committed"; readonly generation: string }
  | { readonly kind: "unchanged"; readonly generation: string | null };

function storeFailure(error: unknown): StoreError {
  const normalized = normalizeStorageFailure(error);
  return normalized instanceof StoreError ? normalized
    : new StoreError("INTERNAL_ERROR", normalized instanceof Error ? normalized.message : String(normalized), { cause: error });
}
const json = (value: unknown): Buffer => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

/** Logical files of a generation, named relative to the generation root. The
 * role's promptFile here is the logical `prompts/<profile>.md`; the published
 * file names the generation path instead, which is why the identity is taken
 * over these bytes and never over its own output paths. */
function logicalFiles(config: HostConfigV1, roles: Readonly<Record<string, ManagedRole>>): Map<string, Buffer> {
  const { modelProfiles, agentProfiles: _agentProfiles, ...host } = config;
  const files = new Map<string, Buffer>([["host.json", json(host)], ["models.json", json(modelProfiles)]]);
  for (const name of Object.keys(roles).sort()) {
    const role = roles[name]!;
    files.set(`roles/${name}.json`, json(roleBody(role, `prompts/${name}.md`)));
    files.set(`prompts/${name}.md`, role.prompt);
  }
  return files;
}
function roleBody(role: ManagedRole, promptFile: string): Record<string, unknown> {
  return { agentProfile: role.agentProfile, extensions: [...role.extensions], promptFile,
    ...(role.toolSurface === undefined ? {} : { toolSurface: role.toolSurface }) };
}

/** Generation identity (D02, pinned by golden vectors): SHA-256 over a version
 * line, then for every logical name in byte order its UTF-8 name, a newline,
 * its decimal length, a newline, its exact bytes and a newline. */
export function generationIdOf(files: ReadonlyMap<string, Buffer>): string {
  const hash = createHash("sha256").update("oma-config-generation-v1\n");
  for (const name of [...files.keys()].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) {
    const bytes = files.get(name)!;
    hash.update(`${name}\n${bytes.length}\n`).update(bytes).update("\n");
  }
  return `g-${hash.digest("hex")}`;
}

/** The generation a manifest points at, or null for a manual bundle. Managed
 * means every manifest reference lies in one generation directory. */
export function managedGenerationOf(snapshot: Pick<ConfigurationSnapshot, "layout">): string | null {
  const layout = snapshot.layout;
  if (layout.kind !== "operations") return null;
  const root = dirname(layout.index);
  const owners = new Set<string>();
  for (const file of [layout.host, layout.models, ...Object.values(layout.roles)]) {
    const parts = relative(root, file).split("/");
    if (parts.length < 4 || parts[0] !== MANAGED_DIRECTORY || parts[1] !== "generations" || !GENERATION_ID.test(parts[2]!)) return null;
    owners.add(parts[2]!);
  }
  return owners.size === 1 ? [...owners][0]! : null;
}

/** The roles a managed edit publishes: the snapshot's authored roles with the
 * candidate's agent profiles and any extension selection the edit replaces.
 * Prompt bytes are the ones the loader decoded (UTF-8, BOM kept). */
export function managedRolesOf(snapshot: ManagedSource, edits: ManagedEdit["roles"] = {},
  config: HostConfigV1 = snapshot.config): Record<string, ManagedRole> {
  const roles: Record<string, ManagedRole> = Object.create(null);
  for (const [name, authored] of Object.entries(snapshot.authoredRoles)) {
    const value = authored.value;
    const change = edits[name];
    const extensions = change?.extensions ?? value.extensions;
    if (!Array.isArray(extensions) || extensions.some(entry => typeof entry !== "string"))
      throw new StoreError("INVALID_REQUEST", `role ${name} extensions are not a list of entries`);
    const settings = snapshot.roles[name];
    if (settings === undefined) throw new StoreError("INVALID_REQUEST", `role ${name} has no loaded settings`);
    if (!Object.hasOwn(config.agentProfiles, name))
      throw new StoreError("UNSUPPORTED_PROFILE", `the candidate drops role ${name}`);
    roles[name] = Object.freeze({ agentProfile: config.agentProfiles[name], extensions: Object.freeze([...extensions as string[]]),
      ...(Object.hasOwn(value, "toolSurface") ? { toolSurface: value.toolSurface } : {}),
      prompt: Buffer.from(settings.prompt, "utf8") });
  }
  for (const name of Object.keys(edits)) if (!Object.hasOwn(roles, name))
    throw new StoreError("UNSUPPORTED_PROFILE", `the configuration has no role ${name}`);
  if (Object.keys(config.agentProfiles).some(name => !Object.hasOwn(roles, name)))
    throw new StoreError("UNSUPPORTED_PROFILE", "a managed edit cannot add a role the bundle does not declare");
  return roles;
}

/** Parents whose post-publication flush failed in this process. Until one is
 * flushed, nothing else is published into that bundle (CONFIG-CONTRACT). */
const unconfirmed = new Set<string>();

function currentBytes(path: string): Buffer {
  const stat = lstatSync(path);
  if (!stat.isFile()) throw new StoreError("POLICY_CHANGED", `configuration file is no longer a regular file: ${path}`);
  return readFileSync(path);
}
/** CONFIG-CONTRACT expected version: every file of the closure the edit was
 * read from still holds the bytes it held. The whole commit below is one
 * synchronous run, so no other edit of this process interleaves after this. */
function assertCurrent(snapshot: Pick<ConfigurationSnapshot, "sourceFiles">): void {
  for (const identity of snapshot.sourceFiles) {
    let bytes: Buffer;
    try { bytes = currentBytes(identity.path); }
    catch (error) {
      if (error instanceof StoreError) throw error;
      throw new StoreError("POLICY_CHANGED", `configuration changed since it was read: ${identity.path}`);
    }
    if (createHash("sha256").update(bytes).digest("hex") !== identity.sha256)
      throw new StoreError("POLICY_CHANGED", "configuration changed since it was read; reload it before editing");
  }
}

function treeBytes(root: string): { bytes: number; generations: string[] } {
  let bytes = 0; const generations: string[] = [];
  let entries: string[];
  try { entries = readdirSync(root); } catch { return { bytes, generations }; }
  const walk = (path: string): void => {
    const stat = lstatSync(path);
    if (stat.isDirectory()) for (const entry of readdirSync(path)) walk(join(path, entry));
    else bytes += stat.size;
  };
  for (const entry of entries) {
    if (GENERATION_ID.test(entry)) generations.push(entry);
    walk(join(root, entry));
  }
  return { bytes, generations };
}

/** Whether an existing generation holds exactly these bytes. "No" is an
 * answer: a file that is missing, is a link or not a regular file, or holds
 * other bytes. A file that could not be read (too many open files, an I/O
 * error) is no answer, and is raised as itself rather than reported as a
 * generation holding other bytes (INV02). */
function sameBytes(parent: number, generation: string, files: ReadonlyMap<string, Buffer>): boolean {
  for (const [name, bytes] of files) {
    let fd: number;
    try { fd = openRegularBeneath(parent, `${generation}/${name}`); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error instanceof StoreError && error.code === "STORE_CORRUPT")) return false;
      throw error;
    }
    try { if (!readFileSync(fd).equals(bytes)) return false; } finally { closeSync(fd); }
  }
  return true;
}

/** Writes the generation below `generations/.staging-*`, flushes every file and
 * directory, makes it read-only and renames it into place within the same
 * parent. An identical generation already present is reused as is.
 * FS-005 / architecture section 4: `generations` is resolved once; the check for an existing generation,
 * the staging tree, the rename and the flush all go through that one
 * resolution and descriptors opened beneath it. */
function publishGeneration(generations: string, id: string, published: ReadonlyMap<string, Buffer>, faults?: DurabilityObserver): void {
  const target = join(generations, id);
  withinDirectory(target, (parent, name) => {
    if (lstatSync(entryAt(parent, name), { throwIfNoEntry: false })) {
      if (!sameBytes(parent, name, published)) throw new StoreError("STORE_CORRUPT", `managed generation ${id} holds other bytes`);
      return;
    }
    const stagingName = `.staging-${randomUUID()}`;
    const staging = join(generations, stagingName);
    mkdirSync(entryAt(parent, stagingName), { mode: 0o700 });
    const tree = openBeneath(parent, stagingName, constants.O_RDONLY | constants.O_DIRECTORY);
    try {
      const sub: Record<string, number> = {};
      try {
        for (const directory of ["roles", "prompts"]) {
          mkdirSync(entryAt(tree, directory), { mode: 0o700 });
          sub[directory] = openBeneath(tree, directory, constants.O_RDONLY | constants.O_DIRECTORY);
        }
        for (const [file, bytes] of published) {
          const slash = file.indexOf("/");
          const holder = slash < 0 ? tree : sub[file.slice(0, slash)];
          if (holder === undefined) throw new StoreError("INTERNAL_ERROR", `managed generation file ${file} has no directory`);
          writeExclusiveFsyncedEntry(holder, slash < 0 ? file : file.slice(slash + 1), join(staging, file), bytes, 0o400, faults);
        }
        for (const directory of ["roles", "prompts"]) { fchmodSync(sub[directory]!, 0o500); fsyncHeldDir(sub[directory]!, join(staging, directory), faults); }
      } finally { for (const fd of Object.values(sub)) closeSync(fd); }
      fchmodSync(tree, 0o500);
      fsyncHeldDir(tree, staging, faults);
    } finally { closeSync(tree); }
    faultAt(faults, "derived-rename", "before", target);
    renameSync(entryAt(parent, stagingName), entryAt(parent, name));
    faultAt(faults, "derived-rename", "after-visible", target);
    fsyncHeldDir(parent, generations, faults);
  });
}

/** Proves, with the production loader, that the manifest about to be
 * published reproduces the candidate exactly -- config, prompts, extension
 * entries and tool surfaces -- before it becomes the commit point. */
function assertReproduces(manifest: string, config: HostConfigV1, roles: Readonly<Record<string, ManagedRole>>): void {
  const source = readConfigurationSource(manifest);
  const loaded = validateConfig(source.host);
  if (JSON.stringify(loaded) !== JSON.stringify(validateConfig(config)))
    throw new StoreError("INTERNAL_ERROR", "managed generation does not reproduce the candidate configuration");
  for (const [name, role] of Object.entries(roles)) {
    const authored = source.authoredRoles[name]?.value;
    const settings = source.roles[name];
    if (!authored || !settings || !Buffer.from(settings.prompt, "utf8").equals(role.prompt) ||
        JSON.stringify(authored.extensions) !== JSON.stringify(role.extensions) ||
        JSON.stringify(authored.toolSurface) !== JSON.stringify(role.toolSurface))
      throw new StoreError("INTERNAL_ERROR", `managed generation does not reproduce role ${name}`);
  }
  if (Object.keys(source.authoredRoles).length !== Object.keys(roles).length)
    throw new StoreError("INTERNAL_ERROR", "managed generation does not reproduce the role set");
}

/** D02 writer. Refuses a stale snapshot, an exhausted budget or an unflushed
 * earlier publication; otherwise publishes one generation and replaces the
 * manifest last. Success is returned only after the manifest's parent flush;
 * a failure after the rename is reported as unconfirmed and blocks the next
 * edit of this bundle until the flush succeeds. */
export function commitManagedGeneration(snapshot: ManagedSource, edit: ManagedEdit, faults?: DurabilityObserver,
  limits: ManagedLimits = MANAGED_LIMITS): ManagedCommit {
  const layout = snapshot.layout;
  if (layout.kind !== "operations")
    throw new StoreError("UNSUPPORTED_PROFILE", "only an operations bundle is edited as managed generations");
  const manifest = layout.index;
  const root = dirname(manifest);
  if (unconfirmed.has(root)) {
    try { fsyncDir(root); unconfirmed.delete(root); }
    catch (error) { throw storeFailure(error); }
  }
  assertCurrent(snapshot);
  const roles = managedRolesOf(snapshot, edit.roles, edit.config);

  const logical = logicalFiles(edit.config, roles);
  const id = generationIdOf(logical);
  const current = managedGenerationOf(snapshot);
  if (current === id) return Object.freeze({ kind: "unchanged", generation: id });

  const base = join(root, MANAGED_DIRECTORY);
  const generations = join(base, "generations");
  ensureDurableDirectory(base, 0o700, faults);
  ensureDurableDirectory(generations, 0o700, faults);
  const published = new Map(logical);
  const at = (name: string): string => `${MANAGED_DIRECTORY}/generations/${id}/${name}`;
  for (const name of Object.keys(roles)) published.set(`roles/${name}.json`, json(roleBody(roles[name]!, at(`prompts/${name}.md`))));
  const usage = treeBytes(generations);
  const adding = [...published.values()].reduce((sum, bytes) => sum + bytes.length, 0);
  if (!usage.generations.includes(id) &&
      (usage.generations.length >= limits.generations || usage.bytes + adding > limits.bytes))
    throw new StoreError("LIMIT_EXCEEDED",
      `configuration history is full (${limits.generations} generations or ${limits.bytes} bytes); restart oma to collect unused generations`);
  publishGeneration(generations, id, published, faults);

  const pointer = json({ kind: "oma-operations-v1", host: at("host.json"), models: at("models.json"),
    roles: Object.fromEntries(Object.keys(roles).sort().map(name => [name, at(`roles/${name}.json`)])) });
  const temporaryName = `.${basename(manifest)}.${randomUUID()}.tmp`;
  const temporary = join(root, temporaryName);
  writeExclusiveFsyncedFile(temporary, pointer, 0o600, faults);
  // FS-005 / architecture section 4: the commit point is renamed, cleaned up and flushed through one
  // resolution of the bundle root.
  withinDirectory(manifest, (bundle, manifestName) => {
    let renamed = false;
    try {
      assertReproduces(temporary, edit.config, roles);
      assertCurrent(snapshot);
      faultAt(faults, "derived-rename", "before", manifest);
      renameSync(entryAt(bundle, temporaryName), entryAt(bundle, manifestName));
      renamed = true;
      faultAt(faults, "derived-rename", "after-visible", manifest);
    } catch (error) {
      // A simulated crash stops here like process loss; the quiescent collection
      // removes a manifest temporary a real crash leaves behind.
      if (!renamed && !isDurabilityFault(error)) { try { unlinkSync(entryAt(bundle, temporaryName)); } catch { /* collected later */ } }
      throw error;
    }
    try {
      fsyncHeldDir(bundle, root, faults);
    } catch (error) {
      if (isDurabilityFault(error)) throw error;
      unconfirmed.add(root);
      const cause = storeFailure(error);
      throw new StoreError(cause.code, `configuration generation ${id} was published but its durability is unconfirmed; the next edit re-checks it`, { cause: error });
    }
  });
  recordCommitted(base, current, id);
  return Object.freeze({ kind: "committed", generation: id });
}

/** DR12, P0-3: the inline `config.json` is a one-file generation with the
 * same owner and order as a managed bundle (D02 keeps "validate -> durable
 * replace of the same file" for it): the expected version is the snapshot the
 * edit was derived from, the candidate is written to a private temporary, the
 * production loader reads that temporary back and must reproduce the
 * candidate, the version is checked again, and the rename is the commit
 * point. A committed configuration is therefore always one the loader loads.
 * A failed flush after the rename is reported as unconfirmed and blocks the
 * next edit until the flush succeeds (CONFIG-CONTRACT outcome-unconfirmed). */
export function commitInlineConfiguration(snapshot: Pick<ConfigurationSnapshot, "layout" | "sourceFiles">,
  candidate: ValidatedConfigCandidate, faults?: DurabilityObserver): ManagedCommit {
  const layout = snapshot.layout;
  if (layout.kind !== "inline") throw new StoreError("UNSUPPORTED_PROFILE", "only an inline configuration is committed as one file");
  const path = layout.path;
  const root = dirname(path);
  if (unconfirmed.has(root)) {
    try { fsyncDir(root); unconfirmed.delete(root); }
    catch (error) { throw storeFailure(error); }
  }
  assertCurrent(snapshot);
  const bytes = Buffer.from(`${JSON.stringify(candidate, null, 2)}\n`);
  publishInline(path, bytes, candidate, faults, () => assertCurrent(snapshot), "replace");
  return Object.freeze({ kind: "committed", generation: `inline-${createHash("sha256").update(bytes).digest("hex")}` });
}
/** First run: the configuration is created only where none exists. A start
 * that loses the race reads the winner's, never overwrites it. */
export function createInlineConfiguration(path: string, candidate: ValidatedConfigCandidate, faults?: DurabilityObserver): "created" | "existing" {
  const bytes = Buffer.from(`${JSON.stringify(candidate, null, 2)}\n`);
  return publishInline(path, bytes, candidate, faults, () => undefined, "create");
}
function publishInline(path: string, bytes: Buffer, candidate: ValidatedConfigCandidate, faults: DurabilityObserver | undefined,
  recheck: () => void, mode: "replace" | "create"): "created" | "existing" {
  const root = dirname(path);
  const temporaryName = `.${basename(path)}.${randomUUID()}.tmp`;
  const temporary = join(root, temporaryName);
  writeExclusiveFsyncedFile(temporary, bytes, 0o600, faults);
  let outcome: "created" | "existing" = "created";
  withinDirectory(path, (directory, name) => {
    let published = false;
    try {
      const loaded = validateConfig(readConfigurationSource(temporary).host);
      if (JSON.stringify(loaded) !== JSON.stringify(validateConfig(candidate)))
        throw new StoreError("INTERNAL_ERROR", "the written configuration does not reproduce the candidate");
      recheck();
      faultAt(faults, "derived-rename", "before", path);
      if (mode === "replace") renameSync(entryAt(directory, temporaryName), entryAt(directory, name));
      else {
        try { linkSync(entryAt(directory, temporaryName), entryAt(directory, name)); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; outcome = "existing"; }
        unlinkSync(entryAt(directory, temporaryName));
      }
      published = true;
      faultAt(faults, "derived-rename", "after-visible", path);
    } catch (error) {
      if (!published && !isDurabilityFault(error)) { try { unlinkSync(entryAt(directory, temporaryName)); } catch { /* collected later */ } }
      throw error;
    }
    try { fsyncHeldDir(directory, root, faults); }
    catch (error) {
      if (isDurabilityFault(error)) throw error;
      unconfirmed.add(root);
      const cause = storeFailure(error);
      throw new StoreError(cause.code, `configuration ${path} was published but its durability is unconfirmed; the next edit re-checks it`, { cause: error });
    }
  });
  return outcome;
}

/** Only the newest entries of the journal are ever needed: which generation
 * was committed last, and the one before it. The journal grows by one line per
 * commit, so it is read from its end and never whole (INV10). */
const JOURNAL_TAIL_BYTES = 4096;

/** The generations the journal's tail records, oldest first. A line cut by
 * the window's start or by a crash in the middle of an append is not an entry. */
function journalTail(fd: number): readonly string[] {
  const size = fstatSync(fd).size;
  const length = Math.min(size, JOURNAL_TAIL_BYTES);
  const buffer = Buffer.alloc(length);
  const read = readSync(fd, buffer, 0, length, size - length);
  const lines = buffer.subarray(0, read).toString("utf8").split("\n");
  if (size > length) lines.shift();
  return lines.filter(line => GENERATION_ID.test(line));
}

/** The journal of committed generations, in commit order. The manifest is
 * what says a generation is committed (INV03); the journal only remembers the
 * order, for the collection that keeps the previous generation as the basis of
 * a rollback (WP13). So the committer, which knows exactly which generation the
 * manifest named before its own (`previous`), writes that one first when the
 * journal does not already end with it: a crash between an earlier commit and
 * its record, or an append that failed, would otherwise leave the previous
 * generation unrecorded, and a later collection would remove it as if it had
 * never been committed. A failure here leaves the commit standing; a
 * collection that cannot trust the journal removes no generation. */
function recordCommitted(base: string, previous: string | null, id: string): void {
  try {
    withinDirectory(join(base, JOURNAL), (directory, name) => {
      const fd = openBeneath(directory, name, constants.O_RDWR | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
      try {
        const missing = previous !== null && journalTail(fd).at(-1) !== previous;
        writeSync(fd, missing ? `${previous}\n${id}\n` : `${id}\n`);
        fsyncSync(fd);
      } finally { closeSync(fd); }
    });
  } catch { /* the commit stands; see collectManagedGenerations */ }
}

/** Which generations a collection keeps besides the staging it always removes
 * (INV02: what the journal cannot vouch for is kept, never removed).
 * - The journal cannot be read: every generation is kept.
 * - It ends with the current generation: its record, and the previous one the
 *   committer wrote before it, are exact; the current and that previous are kept.
 * - It ends with another: the current generation's record was lost. The last
 *   recorded one and every generation the tail does not record are kept; only
 *   generations recorded before the last are known to be older than the previous. */
function generationsToKeep(current: string, tail: readonly string[] | null, present: readonly string[]): ReadonlySet<string> | "all" {
  if (tail === null) return "all";
  if (tail.at(-1) === current) {
    const previous = [...tail].reverse().find(id => id !== current);
    return new Set([current, ...(previous === undefined ? [] : [previous])]);
  }
  const recorded = new Set(tail);
  return new Set([current, ...(tail.length > 0 ? [tail.at(-1)!] : []), ...present.filter(id => !recorded.has(id))]);
}

/** Quiescent collection: called only by the society owner while no broker or
 * other reader of the society runs. Keeps the current generation and the one
 * committed before it; removes every other generation and every staging
 * directory. Age alone never selects a generation, and neither does a journal
 * that could not be read (`generationsToKeep`). */
export function collectManagedGenerations(snapshot: Pick<ConfigurationSnapshot, "layout">): readonly string[] {
  if (snapshot.layout.kind === "inline") return collectTemporaries(snapshot.layout.path);
  const current = managedGenerationOf(snapshot);
  if (current === null || snapshot.layout.kind !== "operations") return [];
  const base = join(dirname(snapshot.layout.index), MANAGED_DIRECTORY);
  const generations = join(base, "generations");
  let tail: readonly string[] | null;
  try {
    tail = withinDirectory(join(base, JOURNAL), (directory, name) => {
      const fd = openBeneath(directory, name, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { return journalTail(fd); } finally { closeSync(fd); }
    });
  } catch { tail = null; }
  const entries = readdirSync(generations);
  const keep = generationsToKeep(current, tail, entries.filter(entry => GENERATION_ID.test(entry)));
  const removed: string[] = [];
  for (const entry of entries) {
    // A staging directory was never committed, so no journal is needed to remove it.
    const removable = entry.startsWith(".staging-") || (GENERATION_ID.test(entry) && keep !== "all" && !keep.has(entry));
    if (!removable) continue;
    // FS-005: walked and removed beneath held directories, never through a link.
    removeOwnedTree(join(generations, entry));
    removed.push(entry);
  }
  if (removed.length > 0) fsyncDir(generations);
  return Object.freeze([...removed, ...collectTemporaries(snapshot.layout.index)]);
}
/** Commit-point temporaries a crashed commit left beside the file it would
 * have replaced: only the exact names this writer creates, never other files. */
function collectTemporaries(commitPoint: string): readonly string[] {
  const root = dirname(commitPoint);
  const temporary = new RegExp(`^\\.${basename(commitPoint).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.[0-9a-f-]{36}\\.tmp$`);
  const removed: string[] = [];
  for (const entry of readdirSync(root)) if (temporary.test(entry)) { removeOwnedFile(join(root, entry)); removed.push(entry); }
  if (removed.length > 0) fsyncDir(root);
  return removed;
}
