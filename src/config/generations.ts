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
  chmodSync, closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync,
  readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import type { HostConfigV1 } from "../../implementation/contracts.js";
import { StoreError, normalizeStorageFailure } from "../domain/errors.js";
import { validateConfig, type ConfigurationSnapshot, type ValidatedConfigCandidate } from "../config.js";
import { readConfigurationSource } from "./operations.js";
import {
  ensureDurableDirectory, fsyncDir, writeExclusiveFsyncedFile, faultAt, isDurabilityFault, type DurabilityObserver,
} from "../storage/durable-fs.js";

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
function assertCurrent(snapshot: ManagedSource): void {
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

function sameBytes(directory: string, files: ReadonlyMap<string, Buffer>): boolean {
  try {
    for (const [name, bytes] of files) if (!readFileSync(join(directory, name)).equals(bytes)) return false;
    return true;
  } catch { return false; }
}

/** Writes the generation below `generations/.staging-*`, flushes every file and
 * directory, makes it read-only and renames it into place within the same
 * parent. An identical generation already present is reused as is. */
function publishGeneration(generations: string, id: string, published: ReadonlyMap<string, Buffer>, faults?: DurabilityObserver): void {
  const target = join(generations, id);
  if (lstatSync(target, { throwIfNoEntry: false })) {
    if (!sameBytes(target, published)) throw new StoreError("STORE_CORRUPT", `managed generation ${id} holds other bytes`);
    return;
  }
  const staging = join(generations, `.staging-${randomUUID()}`);
  mkdirSync(staging, { mode: 0o700 });
  for (const directory of ["roles", "prompts"]) mkdirSync(join(staging, directory), { mode: 0o700 });
  for (const [name, bytes] of published) writeExclusiveFsyncedFile(join(staging, name), bytes, 0o400, faults);
  for (const directory of ["roles", "prompts"]) { chmodSync(join(staging, directory), 0o500); fsyncDir(join(staging, directory), faults); }
  chmodSync(staging, 0o500);
  fsyncDir(staging, faults);
  faultAt(faults, "derived-rename", "before", target);
  renameSync(staging, target);
  faultAt(faults, "derived-rename", "after-visible", target);
  fsyncDir(generations, faults);
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
  const temporary = join(root, `.${basename(manifest)}.${randomUUID()}.tmp`);
  writeExclusiveFsyncedFile(temporary, pointer, 0o600, faults);
  let renamed = false;
  try {
    assertReproduces(temporary, edit.config, roles);
    assertCurrent(snapshot);
    faultAt(faults, "derived-rename", "before", manifest);
    renameSync(temporary, manifest);
    renamed = true;
    faultAt(faults, "derived-rename", "after-visible", manifest);
  } catch (error) {
    // A simulated crash stops here like process loss; the quiescent collection
    // removes a manifest temporary a real crash leaves behind.
    if (!renamed && !isDurabilityFault(error)) { try { unlinkSync(temporary); } catch { /* collected later */ } }
    throw error;
  }
  try {
    fsyncDir(root, faults);
  } catch (error) {
    if (isDurabilityFault(error)) throw error;
    unconfirmed.add(root);
    const cause = storeFailure(error);
    throw new StoreError(cause.code, `configuration generation ${id} was published but its durability is unconfirmed; the next edit re-checks it`, { cause: error });
  }
  recordCommitted(base, id);
  return Object.freeze({ kind: "committed", generation: id });
}

/** Last-known-good bookkeeping: an append-only list of published generations.
 * A failure here loses only which older generation a quiescent collection
 * keeps besides the current one; it never undoes the commit. */
function recordCommitted(base: string, id: string): void {
  try {
    const fd = openSync(join(base, JOURNAL), constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    try { writeSync(fd, `${id}\n`); fsyncSync(fd); } finally { closeSync(fd); }
  } catch { /* bookkeeping only */ }
}

/** Quiescent collection: called only by the society owner while no broker or
 * other reader of the society runs. Keeps the current generation and the one
 * committed before it; removes every other generation and every staging
 * directory. Age alone never selects a generation. */
export function collectManagedGenerations(snapshot: Pick<ConfigurationSnapshot, "layout">): readonly string[] {
  const current = managedGenerationOf(snapshot);
  if (current === null || snapshot.layout.kind !== "operations") return [];
  const base = join(dirname(snapshot.layout.index), MANAGED_DIRECTORY);
  const generations = join(base, "generations");
  let history: string[] = [];
  try { history = readFileSync(join(base, JOURNAL), "utf8").split("\n").filter(line => GENERATION_ID.test(line)); } catch { /* none */ }
  const earlier = history.filter(id => id !== current);
  const keep = new Set([current, ...(earlier.length > 0 ? [earlier[earlier.length - 1]!] : [])]);
  const removed: string[] = [];
  for (const entry of readdirSync(generations)) {
    if (keep.has(entry)) continue;
    if (!GENERATION_ID.test(entry) && !entry.startsWith(".staging-")) continue;
    const path = join(generations, entry);
    const chmodTree = (directory: string): void => {
      chmodSync(directory, 0o700);
      for (const child of readdirSync(directory)) if (statSync(join(directory, child)).isDirectory()) chmodTree(join(directory, child));
    };
    chmodTree(path);
    rmSync(path, { recursive: true, force: true });
    removed.push(entry);
  }
  if (removed.length > 0) fsyncDir(generations);
  // Manifest temporaries a crashed commit left beside the index: only the
  // exact names this writer creates, never other files of the bundle root.
  const root = dirname(snapshot.layout.index);
  const temporary = new RegExp(`^\\.${basename(snapshot.layout.index).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.[0-9a-f-]{36}\\.tmp$`);
  let swept = false;
  for (const entry of readdirSync(root)) if (temporary.test(entry)) { unlinkSync(join(root, entry)); removed.push(entry); swept = true; }
  if (swept) fsyncDir(root);
  return Object.freeze(removed);
}
