import { directoryNames, statAt } from "@oma/native/posix-files";
import { mkdirAt, unlinkAt, renameAt, linkAt } from "@oma/native/posix-files";
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
import type { HostConfig } from "@oma/contracts";
import { StoreError, normalizeStorageFailure, unobserved } from "@oma/domain/errors";
import { validateConfig, type ConfigurationSnapshot, type ValidatedConfigCandidate } from "./index.js";
import { fileDigest } from "@oma/storage/file-digest";
import { readConfigurationSource } from "./operations.js";
import {
  ensureOwnedDurableDirectory, fsyncDir, fsyncHeldDir, writeExclusiveFsyncedEntry, writeExclusiveFsyncedFile, faultAt, isDurabilityFault,
  type DurabilityObserver,
} from "@oma/storage/durable-fs";
import { removeOwnedFile, removeOwnedTree } from "@oma/storage/directory";
import { assertManagedJournalFormat, MANAGED_JOURNAL } from "./state-format.js";
import { openBeneath, openRegularBeneath, withinDirectory } from "@oma/native/files";
import { cleanupAll, withCleanup } from "@oma/native/cleanup";

export const MANAGED_DIRECTORY = ".oma-config";
/** D02 editing budget, not a reading rule: a valid bundle of any shape stays
 * readable; only an edit that would exceed these is refused until a quiescent
 * start collects what no reader can still use. The loader's own closure budget
 * (4096 files, 64 MiB) bounds one generation; the total edit budget remains separate. */
export interface ManagedLimits { readonly generations: number; readonly bytes: number }
export const MANAGED_LIMITS: ManagedLimits = Object.freeze({ generations: 16, bytes: 256 * 1024 * 1024 });
const GENERATION_ID = /^g-[0-9a-f]{64}$/;

/** What a managed edit is derived from: a runnable snapshot, or the editable
 * source of WP14's limited repair. Only authored roles, prompts, the source
 * closure and the validated host configuration are used; whether the result
 * runs is proven by the full loader before publication. */
export type ManagedSource = Pick<ConfigurationSnapshot, "config" | "layout" | "authoredRoles" | "sourceFiles"> &
  { readonly roles: Readonly<Record<string, { readonly prompt: string }>> };

/** A role's authored parts a managed edit may carry forward or replace. D23:
 * a tool surface is OMA's internal policy, so it is no part a managed edit
 * may carry -- a role file that names one fails the load instead. */
export interface ManagedRole {
  readonly agentProfile: unknown;
  readonly extensions: readonly string[];
  readonly prompt: Buffer;
}
/** A role as a whole, for DR25's whole-role-set edits: its extension entries
 * and prompt bytes. Its agent profile is the candidate's. */
export type ManagedRoleSource = Omit<ManagedRole, "agentProfile">;
export interface ManagedEdit {
  /** The complete candidate, already validated and revised by its owner. */
  readonly config: ValidatedConfigCandidate;
  /** Authored role parts that differ from the snapshot (extension selection). */
  readonly roles?: Readonly<Record<string, Partial<Pick<ManagedRole, "extensions">>>>;
  /** DR25: every role, replacing the snapshot's -- how an inline configuration
   * becomes a managed bundle, and how a session's configuration takes on its
   * project's roles. Names exactly the candidate's agent profiles. */
  readonly roleSet?: Readonly<Record<string, ManagedRoleSource>>;
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
function logicalFiles(config: HostConfig, roles: Readonly<Record<string, ManagedRole>>): Map<string, Buffer> {
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
  return { agentProfile: role.agentProfile, extensions: [...role.extensions], promptFile };
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
  config: HostConfig = snapshot.config, roleSet?: ManagedEdit["roleSet"]): Record<string, ManagedRole> {
  const roles: Record<string, ManagedRole> = Object.create(null);
  if (roleSet !== undefined) {
    // DR25: the whole set is the edit's; every agent profile has its role and no other role is named.
    for (const name of Object.keys(roleSet)) if (!Object.hasOwn(config.agentProfiles, name))
      throw new StoreError("UNSUPPORTED_PROFILE", `the role set names ${name}, which the candidate has no agent profile for`);
    for (const name of Object.keys(config.agentProfiles)) {
      const role = roleSet[name];
      if (role === undefined) throw new StoreError("UNSUPPORTED_PROFILE", `the role set has no role for agent profile ${name}`);
      if (!Array.isArray(role.extensions) || role.extensions.some(entry => typeof entry !== "string"))
        throw new StoreError("INVALID_REQUEST", `role ${name} extensions are not a list of entries`);
      roles[name] = Object.freeze({ agentProfile: config.agentProfiles[name], extensions: Object.freeze([...role.extensions]),
        prompt: Buffer.from(role.prompt) });
    }
    return roles;
  }
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

/** CONFIG-CONTRACT expected version: every file of the closure the edit was
 * read from still holds the bytes it held. The whole commit below is one
 * synchronous run, so no other edit of this process interleaves after this.
 * DR13: a file that is gone or holds other bytes has changed; a file that
 * cannot be read now is not known to have changed, and the edit waits. */
function assertCurrent(snapshot: Pick<ConfigurationSnapshot, "sourceFiles">): void {
  for (const identity of snapshot.sourceFiles) {
    let sha256: string;
    try { sha256 = fileDigest(identity.path).sha256; }
    catch (error) {
      if (error instanceof StoreError) throw error;
      throw unobserved(error, `the configuration file ${identity.path}`) ??
        new StoreError("POLICY_CHANGED", `configuration changed since it was read: ${identity.path}`);
    }
    if (sha256 !== identity.sha256)
      throw new StoreError("POLICY_CHANGED", "configuration changed since it was read; reload it before editing");
  }
}

/** The retained generations and their bytes, for the edit budget. No
 * generations directory yet is none; one that cannot be listed is no answer,
 * raised as itself rather than counted as empty (INV02, P0-5). */
function treeBytes(root: string): { bytes: number; generations: string[] } {
  let bytes = 0; const generations: string[] = [];
  let entries: string[];
  try { entries = readdirSync(root); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { bytes, generations }; throw unobserved(error, "the configuration history") ?? error; }
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
  // P0V-90 (R6-13): the same generation holds these files and nothing else. A
  // generation's identity names its whole tree; one with an extra file is not
  // it, whatever the loader happens to read today.
  if (!sameEntries(parent, generation, files)) return false;
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

/** The directories every generation has, whether or not it has files in them. */
const GENERATION_DIRECTORIES = Object.freeze(["roles", "prompts"] as const);

/** Whether the generation's tree is exactly the directories and regular files
 * `files` names. A missing or linked directory is "no"; an unreadable one is
 * raised as itself. */
function sameEntries(parent: number, generation: string, files: ReadonlyMap<string, Buffer>): boolean {
  const directories = new Set<string>(GENERATION_DIRECTORIES);
  for (const name of files.keys()) {
    const parts = name.split("/");
    for (let depth = 1; depth < parts.length; depth++) directories.add(parts.slice(0, depth).join("/"));
  }
  let found = 0;
  const walk = (relativePath: string): boolean => {
    let fd: number;
    try { fd = openBeneath(parent, relativePath === "" ? generation : `${generation}/${relativePath}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP" || (error instanceof StoreError && error.code === "STORE_CORRUPT")) return false;
      throw error;
    }
    try {
      for (const entry of directoryNames(fd)) {
        const path = relativePath === "" ? entry : `${relativePath}/${entry}`;
        const stat = statAt(fd, entry);
        if (stat.isDirectory()) { if (!directories.has(path) || !walk(path)) return false; }
        else if (stat.isFile() && files.has(path)) found++;
        else return false;
      }
      return true;
    } finally { closeSync(fd); }
  };
  return walk("") && found === files.size;
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
    if (statAt(parent, name, { throwIfNoEntry: false })) {
      if (!sameBytes(parent, name, published)) throw new StoreError("STORE_CORRUPT", `managed generation ${id} holds other bytes`);
      return;
    }
    const stagingName = `.staging-${randomUUID()}`;
    const staging = join(generations, stagingName);
    mkdirAt(parent, stagingName, 0o700);
    const tree = openBeneath(parent, stagingName, constants.O_RDONLY | constants.O_DIRECTORY);
    withCleanup(() => {
      const sub: Record<string, number> = {};
      withCleanup(() => {
        for (const directory of GENERATION_DIRECTORIES) {
          mkdirAt(tree, directory, 0o700);
          sub[directory] = openBeneath(tree, directory, constants.O_RDONLY | constants.O_DIRECTORY);
        }
        for (const [file, bytes] of published) {
          const slash = file.indexOf("/");
          const holder = slash < 0 ? tree : sub[file.slice(0, slash)];
          if (holder === undefined) throw new StoreError("INTERNAL_ERROR", `managed generation file ${file} has no directory`);
          writeExclusiveFsyncedEntry(holder, slash < 0 ? file : file.slice(slash + 1), join(staging, file), bytes, 0o400, faults);
        }
        for (const directory of GENERATION_DIRECTORIES) { fchmodSync(sub[directory]!, 0o500); fsyncHeldDir(sub[directory]!, join(staging, directory), faults); }
      }, () => cleanupAll(Object.values(sub).map(fd => () => closeSync(fd))));
      fchmodSync(tree, 0o500);
      fsyncHeldDir(tree, staging, faults);
    }, () => closeSync(tree));
    faultAt(faults, "derived-rename", "before", target);
    renameAt(parent, stagingName, parent, name);
    faultAt(faults, "derived-rename", "after-visible", target);
    fsyncHeldDir(parent, generations, faults);
  });
}

/** Proves, with the production loader, that the manifest about to be
 * published reproduces the candidate exactly -- config, prompts, extension
 * entries and tool surfaces -- before it becomes the commit point. */
function assertReproduces(manifest: string, config: HostConfig, roles: Readonly<Record<string, ManagedRole>>): void {
  const source = readConfigurationSource(manifest);
  const loaded = validateConfig(source.host);
  if (JSON.stringify(loaded) !== JSON.stringify(validateConfig(config)))
    throw new StoreError("INTERNAL_ERROR", "managed generation does not reproduce the candidate configuration");
  for (const [name, role] of Object.entries(roles)) {
    const authored = source.authoredRoles[name]?.value;
    const settings = source.roles[name];
    if (!authored || !settings || !Buffer.from(settings.prompt, "utf8").equals(role.prompt) ||
        JSON.stringify(authored.extensions) !== JSON.stringify(role.extensions))
      throw new StoreError("INTERNAL_ERROR", `managed generation does not reproduce role ${name}`);
  }
  if (Object.keys(source.authoredRoles).length !== Object.keys(roles).length)
    throw new StoreError("INTERNAL_ERROR", "managed generation does not reproduce the role set");
}

/** D02 writer. Refuses a stale snapshot, an exhausted budget or an unflushed
 * earlier publication; otherwise publishes one generation and replaces the
 * manifest last. Success is returned only after the manifest's parent flush;
 * a failure after the rename is reported as unconfirmed and blocks the next
 * edit of this bundle until the flush succeeds.
 *
 * `ownedFrom` is the caller's word for where oma's ownership of this bundle's
 * ancestors begins -- the deepest ancestor it can vouch is oma's own. A bundle
 * inside oma's tree (a project's settings under `.projects`, a society's
 * configuration under the data root) repairs a degraded oma-owned ancestor on
 * the walk, the way the stores do; a bundle the Human's `--config` placed in
 * user space names no such ancestor and the boundary stays `.oma-config`
 * itself. */
export function commitManagedGeneration(snapshot: ManagedSource, edit: ManagedEdit, faults?: DurabilityObserver,
  limits: ManagedLimits = MANAGED_LIMITS, ownedFrom?: string): ManagedCommit {
  const layout = snapshot.layout;
  // DR25: an inline configuration becomes a managed bundle only with a whole
  // role set, published as its first generation; its file becomes the manifest.
  if (layout.kind !== "operations" && edit.roleSet === undefined)
    throw new StoreError("UNSUPPORTED_PROFILE", "only an operations bundle is edited as managed generations");
  const manifest = layout.kind === "operations" ? layout.index : layout.path;
  const root = dirname(manifest);
  const base = join(root, MANAGED_DIRECTORY);
  const generations = join(base, "generations");
  // P0-8: the managed tail beneath the bundle is oma's own -- a mode-000
  // `.oma-config` or `generations` a stray left is repaired, never trusted
  // as-is. The repair boundary is who placed the bundle, which `root` alone
  // cannot say: for a bundle inside oma's own tree the caller names the
  // oma-owned ancestor (`.projects` for a project's settings, the data root
  // for a society's own), and a mode-000 `<project>` or `<society>` a stray
  // left is repaired on the walk the way every other store's tail is. For a
  // bundle the Human's `--config` placed under a directory that is the
  // user's, no ancestor is oma's and the boundary is `base` itself, the
  // first component oma makes beneath the bundle: `dirname(root)` claimed
  // the user's parent as oma's, chmod'ing a directory that is not this
  // product's and unlinking a stray at the bundle's own `.oma-config` slot
  // out of the user's directory to make room. At the boundary oma's own
  // name a stray still refuses -- its parent is not this commit's to write,
  // the same answer the owned ensure gives at every other store's boundary.
  // The repair stands first: the confirmation flush and every file the edit
  // goes on to read and write live beneath the components it makes
  // reachable, so a degraded owned ancestor of `root` refuses here, never
  // silently observed as absent by the reads that follow.
  ensureOwnedDurableDirectory(base, ownedFrom ?? base, 0o700, faults);
  assertManagedJournalFormat(manifest);
  ensureOwnedDurableDirectory(generations, base, 0o700, faults);
  if (unconfirmed.has(root)) {
    try { fsyncDir(root); unconfirmed.delete(root); }
    catch (error) { throw storeFailure(error); }
  }
  assertCurrent(snapshot);
  const roles = managedRolesOf(snapshot, edit.roles, edit.config, edit.roleSet);

  const logical = logicalFiles(edit.config, roles);
  const id = generationIdOf(logical);
  const current = managedGenerationOf(snapshot);
  if (current === id) return Object.freeze({ kind: "unchanged", generation: id });
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
  // P0V-61, P0-3: the order of commits is what a collection keeps the rollback
  // basis by, so it is recorded before the commit point, not after it: a
  // commit whose record could not be written is not made.
  try { recordCommit(base, current, id, faults); }
  catch (error) {
    if (isDurabilityFault(error)) throw error;
    const cause = storeFailure(error);
    throw new StoreError(cause.code, `configuration generation ${id} was not committed: its record could not be written`, { cause: error });
  }

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
      renameAt(bundle, temporaryName, bundle, manifestName);
      renamed = true;
      faultAt(faults, "derived-rename", "after-visible", manifest);
    } catch (error) {
      // A simulated crash stops here like process loss; the quiescent collection
      // removes a manifest temporary a real crash leaves behind.
      if (!renamed && !isDurabilityFault(error)) { try { unlinkAt(bundle, temporaryName); } catch { /* collected later */ } }
      throw error;
    }
    try {
      fsyncHeldDir(bundle, root, faults);
    } catch (error) {
      if (isDurabilityFault(error)) throw error;
      unconfirmed.add(root);
      const cause = storeFailure(error);
      throw new StoreError(cause.code, `configuration generation ${id} was published but its durability is unconfirmed; the next edit re-checks it`, { cause: error, details: { publication: "unconfirmed" } });
    }
  });
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
      if (mode === "replace") renameAt(directory, temporaryName, directory, name);
      else {
        try { linkAt(directory, temporaryName, directory, name); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; outcome = "existing"; }
        unlinkAt(directory, temporaryName);
      }
      published = true;
      faultAt(faults, "derived-rename", "after-visible", path);
    } catch (error) {
      if (!published && !isDurabilityFault(error)) { try { unlinkAt(directory, temporaryName); } catch { /* collected later */ } }
      throw error;
    }
    try { fsyncHeldDir(directory, root, faults); }
    catch (error) {
      if (isDurabilityFault(error)) throw error;
      unconfirmed.add(root);
      const cause = storeFailure(error);
      throw new StoreError(cause.code, `configuration ${path} was published but its durability is unconfirmed; the next edit re-checks it`, { cause: error, details: { publication: "unconfirmed" } });
    }
  });
  return outcome;
}

/** Only the newest records of the journal are ever needed: the one that made
 * the current generation current, which names the generation it replaced. The
 * journal grows by one line per commit, so it is read from its end and never
 * whole (INV10). */
const JOURNAL_TAIL_BYTES = 4096;
/** One current commit: the generation the manifest named before (`-` for
 * none) and the one it names after. No earlier record shape is decoded. */
const COMMIT_RECORD = /^(-|g-[0-9a-f]{64}) (g-[0-9a-f]{64})$/;
interface CommitRecord { readonly previous: string | null; readonly id: string }
function commitRecord(line: string): CommitRecord | null {
  const pair = COMMIT_RECORD.exec(line);
  return pair === null ? null : { previous: pair[1] === "-" ? null : pair[1]!, id: pair[2]! };
}

/** The records of the journal's last window, oldest first, and whether the
 * journal ends on a line boundary -- or null when the window could not be read
 * whole. A line cut by the window's start, or left without its newline by a
 * crash or a short write in the middle of an append, is not a record (P0V-47):
 * only a line the journal ended is one. P0V-72, P0-5: a read may return fewer
 * bytes than it was asked for (read(2)), and what came back is not the
 * window's end; the window is read until it is whole, and an end of file
 * before that is an observation that did not finish. */
function journalTail(fd: number): { readonly records: readonly CommitRecord[]; readonly terminated: boolean } | null {
  const size = fstatSync(fd).size;
  const length = Math.min(size, JOURNAL_TAIL_BYTES);
  const buffer = Buffer.alloc(length);
  for (let filled = 0; filled < length;) {
    const read = readSync(fd, buffer, filled, length - filled, size - length + filled);
    if (read === 0) return null;
    filled += read;
  }
  const lines = buffer.toString("utf8").split("\n");
  // After the last newline: nothing, or an unfinished append. Not a record.
  lines.pop();
  if (size > length) lines.shift();
  const records = lines.map(commitRecord).filter((record): record is CommitRecord => record !== null);
  return { records, terminated: length === 0 || buffer[length - 1] === 0x0a };
}

/** Appends every byte of `text`: a write may take fewer bytes than it was
 * given, and a record written only in part is what P0V-47 is about. */
function appendAll(fd: number, text: string, path: string, faults?: DurabilityObserver): void {
  const bytes = Buffer.from(text, "utf8");
  for (let offset = 0; offset < bytes.length;) {
    faultAt(faults, "file-write", "before", path);
    const written = writeSync(fd, bytes, offset, bytes.length - offset);
    if (written === 0) throw new StoreError("BROKER_UNAVAILABLE", "configuration journal append made no progress");
    offset += written;
    faultAt(faults, "file-write", "after-visible", path);
  }
}

/** The journal of commits. The manifest is what says a generation is
 * committed (INV03); the journal says which one each commit replaced, for the
 * collection that keeps the previous generation as the basis of a rollback
 * (WP13). P0V-61, P0-3: a generation's id is its content, so one returns
 * whenever a configuration does (A, B, A) -- a record of the id alone could
 * not say which occurrence it was, and records lost to failed appends made a
 * journal ending in A look exact while B, the real previous, went unrecorded.
 * So each record names the generation it replaced, and it is written and
 * flushed before the commit point: a commit whose record failed is not made,
 * and a record whose commit did not follow names a generation the manifest
 * never pointed at, which no collection takes for the current one. */
function recordCommit(base: string, previous: string | null, id: string, faults?: DurabilityObserver): void {
  const path = join(base, MANAGED_JOURNAL);
  withinDirectory(path, (directory, name) => {
    const fd = openBeneath(directory, name, constants.O_RDWR | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    try {
      // P0V-47, P0-3: an append a crash cut short is closed off as its own
      // line first, so this record is not glued onto it. A tail that could
      // not be read whole may end anywhere; an empty line costs nothing.
      const tail = journalTail(fd);
      appendAll(fd, `${tail?.terminated === true ? "" : "\n"}${previous ?? "-"} ${id}\n`, path, faults);
      faultAt(faults, "file-fsync", "ambiguous", path);
      fsyncSync(fd);
      faultAt(faults, "file-fsync", "after-visible", path);
    } finally { closeSync(fd); }
    // The journal's name is as durable as its record.
    fsyncHeldDir(directory, base, faults);
  });
}

/** Which generations a collection keeps besides the staging it always removes
 * (INV02: what the journal cannot vouch for is kept, never removed).
 * - The journal cannot be read whole: every generation is kept.
 * - Its last record of the current generation names what that commit
 *   replaced: the current and that previous are kept. Every other generation
 *   is either older than the previous or was published and never committed.
 * - No complete record of the current generation's commit is in the window:
 *   every generation is kept. */
function generationsToKeep(current: string, records: readonly CommitRecord[] | null): ReadonlySet<string> | "all" {
  if (records === null) return "all";
  const last = [...records].reverse().find(record => record.id === current);
  if (last === undefined) return "all";
  return new Set([current, ...(last.previous === null || last.previous === current ? [] : [last.previous])]);
}

/** Quiescent collection: called only by the society owner while no broker or
 * other reader of the society runs. Keeps the current generation and the one
 * committed before it; removes every other generation and every staging
 * directory. Age alone never selects a generation, and neither does a journal
 * that could not be read (`generationsToKeep`). */
export function collectManagedGenerations(snapshot: Pick<ConfigurationSnapshot, "layout">): readonly string[] {
  if (snapshot.layout.kind === "inline") return collectTemporaries(snapshot.layout.path);
  if (snapshot.layout.kind !== "operations") return [];
  assertManagedJournalFormat(snapshot.layout.index);
  const current = managedGenerationOf(snapshot);
  // P0V-97: a first commit killed before its commit point leaves the bundle
  // manual -- no generation is current yet -- and its manifest temporary is
  // still this writer's to collect.
  if (current === null) return collectTemporaries(snapshot.layout.index);
  const base = join(dirname(snapshot.layout.index), MANAGED_DIRECTORY);
  const generations = join(base, "generations");
  let records: readonly CommitRecord[] | null;
  try {
    records = withinDirectory(join(base, MANAGED_JOURNAL), (directory, name) => {
      const fd = openBeneath(directory, name, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { return journalTail(fd)?.records ?? null; } finally { closeSync(fd); }
    });
  } catch { records = null; }
  const entries = readdirSync(generations);
  const keep = generationsToKeep(current, records);
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
