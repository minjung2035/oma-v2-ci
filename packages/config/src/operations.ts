/** Host-owned authoring format. Reads data/assets, never imports extensions or
 * changes the closed HostConfig/wire/ledger format. No live reload. */
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  type Stats,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { StoreError, unobserved } from "@oma/domain/errors";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
import { ACTOR_NAME_RE } from "@oma/domain/identifiers";
import { parseJsonObject } from "@oma/protocol/frame";
import { fileDigest } from "@oma/storage/file-digest";
import { decodeUtf8 } from "@oma/domain/utf8";

export interface RoleSettings {
  readonly prompt: string;
  readonly extensions: readonly Readonly<{ path: string; sha256: string }>[];
}
export interface ConfigurationFileIdentity {
  readonly path: string;
  readonly dev: number;
  readonly ino: number;
  readonly bytes: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly sha256: string;
}
export interface AuthoredRoleSource {
  readonly path: string;
  readonly value: Readonly<Record<string, unknown>>;
}
export interface ConfigurationSource {
  readonly host: unknown;
  readonly roles: Readonly<Record<string, RoleSettings>>;
  readonly layout: ConfigurationLayout;
  readonly authoredRoles: Readonly<Record<string, AuthoredRoleSource>>;
  readonly files: readonly ConfigurationFileIdentity[];
  /** "unread" only from `readEditableConfigurationSource`: extension assets
   * were not dereferenced, so the roles carry no extension digests and the
   * source is an editing input, never a runnable configuration. */
  readonly extensionAssets: "read" | "unread";
}
/** The closure's working-set bound, not a size policy: one identity row is
 * held per source file while the snapshot is taken, and `bytes` sums only
 * the documents read whole (asset bytes stream through `fileDigest` and are
 * never in memory). A configuration that genuinely needs more than this is
 * not one this loader can hold. */
export const CONFIGURATION_SOURCE_LIMITS = Object.freeze({ files: 4096, bytes: 64 * 1024 * 1024 });
/** One file read whole — a parsed JSON document or a prompt string held in
 * memory. Generous, not a capacity policy: prompts are kilobytes in
 * practice; extension assets are digested streaming and never pass through
 * this bound at all. */
export const CONFIGURATION_DOCUMENT_BYTES = 16 * 1024 * 1024;
/** Test seam: where a snapshot read is. `source-read` follows each file the
 * snapshot closes over, after its bytes are recorded. */
export type ConfigurationReadObserver = (event: Readonly<
  | { phase: "manifest-read"; layout: ConfigurationLayout }
  | { phase: "source-read"; path: string }>) => void;
/** Where the files of a configuration actually live, after containment.
 *
 * This is the single answer to "what is inside this bundle". Every reference is
 * a normalized relative path that resolves inside the bundle root and is not
 * reached through a symlink; anything else is refused here rather than by each
 * caller. Screens that read or write a bundle ask for this instead of walking
 * the manifest themselves -- a second walk is a second rule, and the weaker of
 * the two used to be the one holding the write.
 */
export type ConfigurationLayout =
  | { readonly kind: "inline"; readonly path: string }
  | {
      readonly kind: "operations";
      readonly index: string;
      readonly host: string;
      readonly models: string;
      readonly roles: Readonly<Record<string, string>>;
    };
function invalid(message: string): never {
  throw new StoreError("INVALID_REQUEST", `operations config: ${message}`);
}
/** DR13, P0-5: bytes the loader could not get now are not known to be
 * invalid (`unobserved`); a name the configuration gives that is not there,
 * or bytes read and refused, are INVALID_REQUEST. */
function sourceFailure(error: unknown): StoreError {
  if (error instanceof StoreError) return error;
  return unobserved(error, "the operations config") ??
    new StoreError("INVALID_REQUEST", `operations config unreadable: ${error instanceof Error ? error.message : String(error)}`);
}
function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid(`${name} must be an object`);
  return value as Record<string, unknown>;
}
function closed(
  value: unknown,
  keys: readonly string[],
  name: string,
): Record<string, unknown> {
  const object = record(value, name);
  if (
    Object.keys(object).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(object, key))
  )
    return invalid(`${name} has missing or unknown fields`);
  return object;
}
/** Still closed: every required key must be present and only the named optional
 * keys may additionally appear. An unknown field is rejected as before.
 */
function closedWithOptional(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  name: string,
): Record<string, unknown> {
  const object = record(value, name);
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.hasOwn(object, key)) ||
    Object.keys(object).some((key) => !allowed.has(key))
  )
    return invalid(`${name} has missing or unknown fields`);
  return object;
}
function localPath(root: string, value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\0") ||
    value.includes("\\") ||
    isAbsolute(value) ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  )
    return invalid("expected a normalized relative file path");
  const base = realpathSync(root);
  const path = resolve(base, value);
  const actual = realpathSync(path);
  const offset = relative(base, actual);
  if (
    !offset ||
    offset === ".." ||
    offset.startsWith("../") ||
    isAbsolute(offset) ||
    actual !== path
  )
    return invalid("file path escapes its root or uses a symlink");
  return path;
}
class SourceClosure {
  private readonly identities = new Map<string, ConfigurationFileIdentity>();
  private readonly documentBytes = new Map<string, number>();
  constructor(private readonly observer?: ConfigurationReadObserver) {}
  add(path: string, stat: Stats, sha256: string, document = false): void {
    const identity = Object.freeze({
      path, dev: stat.dev, ino: stat.ino, bytes: stat.size,
      mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs,
      sha256,
    });
    const prior = this.identities.get(path);
    if (prior && (prior.dev !== identity.dev || prior.ino !== identity.ino || prior.sha256 !== identity.sha256))
      return invalid("configuration file identity changed within one snapshot");
    if (!prior) this.identities.set(path, identity);
    const files = this.identities.size;
    if (document) this.documentBytes.set(path, stat.size);
    const total = [...this.documentBytes.values()].reduce((sum, value) => sum + value, 0);
    if (files > CONFIGURATION_SOURCE_LIMITS.files || total > CONFIGURATION_SOURCE_LIMITS.bytes)
      throw new StoreError("LIMIT_EXCEEDED", "configuration source closure exceeds its file or byte budget");
    if (!prior) this.observer?.(Object.freeze({ phase: "source-read", path }));
  }
  finish(manifestPath: string): readonly ConfigurationFileIdentity[] {
    for (const identity of this.identities.values()) {
      if (identity.path === manifestPath) continue; // the initial manifest bytes ARE the snapshot pointer
      const current = lstatSync(identity.path);
      if (!current.isFile() || current.dev !== identity.dev || current.ino !== identity.ino ||
          current.size !== identity.bytes || current.mtimeMs !== identity.mtimeMs || current.ctimeMs !== identity.ctimeMs)
        return invalid("configuration source changed before snapshot completion");
    }
    return Object.freeze([...this.identities.values()]);
  }
}

function bytes(path: string, closure?: SourceClosure): Buffer {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > CONFIGURATION_DOCUMENT_BYTES)
      return invalid(`expected a regular file of at most ${Math.floor(CONFIGURATION_DOCUMENT_BYTES / (1024 * 1024))} MiB`);
    const buffer = Buffer.alloc(before.size + 1);
    let count = 0;
    while (count < buffer.length) {
      const read = readSync(fd, buffer, count, buffer.length - count, count);
      if (read === 0) break;
      count += read;
    }
    const value = buffer.subarray(0, count);
    const after = fstatSync(fd);
    if (value.length !== before.size || after.dev !== before.dev || after.ino !== before.ino ||
        after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
      return invalid("configuration file changed while being read");
    closure?.add(path, after, createHash("sha256").update(value).digest("hex"), true);
    return value;
  } finally { closeSync(fd); }
}
function json(path: string, closure?: SourceClosure): Record<string, unknown> {
  return parseJsonObject(bytes(path, closure)).raw;
}
/** WP14.01: the one rule for a role's extension list, used by the loader and
 * by every editor. Pure: it judges the authored strings, never the files. */
export const EXTENSION_LIST_LIMIT = 16;
export function extensionListProblem(entries: unknown): string | null {
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > EXTENSION_LIST_LIMIT ||
      entries[0] !== DEPLOYMENT_LAYOUT.extension || entries.some(entry => typeof entry !== "string") ||
      new Set(entries).size !== entries.length)
    return `extensions must start with the trusted OMA extension, be unique, and contain at most ${EXTENSION_LIST_LIMIT} files`;
  for (const entry of entries as string[]) { const problem = extensionEntryProblem(entry); if (problem) return problem; }
  return null;
}
/** DR25: an entry naming an extension `oma pi install` installed. The rest is
 * a path relative to `installation.packages`, the one place such packages
 * live; every other entry is relative to `installation.libdir`. */
export const PACKAGE_ENTRY_PREFIX = "packages:";
/** Where an extension's entry lives: the installation's own files, or the packages the Human installed. */
export interface ExtensionRoots { readonly libdir: string; readonly packages?: string | undefined }

/** The shape of one entry: a normalized relative path to a JS/TS file, in the
 * installation or (DR25) among the installed packages. */
export function extensionEntryProblem(entry: string): string | null {
  const path = entry.startsWith(PACKAGE_ENTRY_PREFIX) ? entry.slice(PACKAGE_ENTRY_PREFIX.length) : entry;
  if (!path || path.includes("\0") || path.includes("\\") || isAbsolute(path) ||
      path.split("/").some(part => !part || part === "." || part === ".."))
    return "extension entry must be a normalized relative file path";
  if (!/\.(?:js|mjs|ts)$/.test(path)) return "extension must be a local JS/TS file";
  return null;
}
/** The root an entry is relative to and its path there; a package entry
 * without an installed-package directory names nothing. */
function extensionLocation(roots: ExtensionRoots, entry: string): { readonly root: string; readonly path: string } {
  if (!entry.startsWith(PACKAGE_ENTRY_PREFIX)) return { root: roots.libdir, path: entry };
  if (roots.packages === undefined) return invalid("a package extension needs installation.packages");
  return { root: roots.packages, path: entry.slice(PACKAGE_ENTRY_PREFIX.length) };
}
export type ExtensionAsset =
  | { readonly kind: "present"; readonly path: string; readonly sha256: string }
  | { readonly kind: "missing" }
  | { readonly kind: "refused"; readonly reason: string };
/** WP14.01 observation adapter: the file an entry names, judged exactly as
 * the loader judges it -- inside its root (libdir, or DR25's installed
 * packages), reached through no symlink, a regular file hashed with fixed memory. A
 * missing file is reported as missing, so a declaration can be removed
 * without opening an asset that is not there. */
export function observeExtensionAsset(roots: ExtensionRoots, entry: string): ExtensionAsset {
  const problem = extensionEntryProblem(entry);
  if (problem) return Object.freeze({ kind: "refused", reason: problem });
  let location: { readonly root: string; readonly path: string };
  try { location = extensionLocation(roots, entry); }
  catch (error) { return Object.freeze({ kind: "refused", reason: error instanceof Error ? error.message : String(error) }); }
  try {
    if (!lstatSync(resolve(location.root, location.path), { throwIfNoEntry: false })) return Object.freeze({ kind: "missing" });
    const path = localPath(location.root, location.path);
    return Object.freeze({ kind: "present", path, sha256: fileDigest(path).sha256 });
  } catch (error) {
    return Object.freeze({ kind: "refused", reason: error instanceof Error ? error.message : String(error) });
  }
}
function roleSettings(
  root: string,
  roots: ExtensionRoots,
  role: Record<string, unknown>,
  closure: SourceClosure,
  assets: boolean,
): RoleSettings {
  const entries = role.extensions;
  const listProblem = extensionListProblem(entries);
  if (listProblem) return invalid(listProblem);
  const extensions = !assets ? [] : (entries as string[]).map((entry) => {
    const location = extensionLocation(roots, entry);
    const path = localPath(location.root, location.path);
    const observed = fileDigest(path);
    closure.add(path, observed.stat, observed.sha256);
    return Object.freeze({ path, sha256: observed.sha256 });
  });
  const prompt = decodeUtf8(bytes(localPath(root, role.promptFile), closure));
  return Object.freeze({ prompt, extensions: Object.freeze(extensions) });
}
function stringList(value: unknown, name: string): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
    return invalid(`${name} must be an array of strings`);
  return value as readonly string[];
}
/** Resolves the manifest and nothing else. It does not read the host or role
 * files, so a bundle whose contents are wrong still has a layout -- which is
 * what lets a screen report "this file is corrupt" against the right path
 * rather than silently deciding the bundle was inline and flattening it.
 */
interface ResolvedConfigurationLayout { readonly layout: ConfigurationLayout; readonly index: Record<string, unknown> }
function resolveConfigurationLayout(path: string, closure: SourceClosure): ResolvedConfigurationLayout {
  try {
    const location = realpathSync(path);
    const source = json(location, closure);
    if (source.kind !== "oma-operations-v1")
      return { layout: Object.freeze({ kind: "inline" as const, path: location }), index: source };
    const manifest = closed(
      source,
      ["kind", "host", "models", "roles"],
      "manifest",
    );
    const root = dirname(location);
    const files = record(manifest.roles, "roles");
    if (Object.keys(files).length < 1 || Object.keys(files).length > 64)
      return invalid("expected 1..64 explicitly listed roles");
    const roles: Record<string, string> = Object.create(null);
    for (const [name, file] of Object.entries(files)) {
      if (!ACTOR_NAME_RE.test(name))
        return invalid("invalid role profile name");
      roles[name] = localPath(root, file);
    }
    const layout = Object.freeze({
      kind: "operations" as const,
      index: location,
      host: localPath(root, manifest.host),
      models: localPath(root, manifest.models),
      roles: Object.freeze(roles),
    });
    return { layout, index: source };
  } catch (error) {
    throw sourceFailure(error);
  }
}
export function configurationLayout(path: string): ConfigurationLayout {
  return resolveConfigurationLayout(path, new SourceClosure()).layout;
}
/** WP14.03/CONFIG-CONTRACT: the authored source of a bundle whose extension
 * assets may be missing, for the one limited repair of removing a declared
 * optional entry. Every other rule of the loader still applies. */
export function readEditableConfigurationSource(path: string): ConfigurationSource {
  return readSource(path, undefined, false);
}
export function readConfigurationSource(path: string, observer?: ConfigurationReadObserver): ConfigurationSource {
  return readSource(path, observer, true);
}
function readSource(path: string, observer: ConfigurationReadObserver | undefined, assets: boolean): ConfigurationSource {
  try {
    const closure = new SourceClosure(observer);
    const resolved = resolveConfigurationLayout(path, closure);
    const layout = resolved.layout;
    observer?.(Object.freeze({ phase: "manifest-read", layout }));
    if (layout.kind === "inline")
      return {
        host: resolved.index,
        roles: Object.freeze({}),
        layout,
        authoredRoles: Object.freeze(Object.create(null) as Record<string, AuthoredRoleSource>),
        files: closure.finish(layout.path),
        extensionAssets: "read",
      };
    const root = dirname(layout.index);
    const host = json(layout.host, closure);
    if (Object.hasOwn(host, "modelProfiles") || Object.hasOwn(host, "agentProfiles"))
      return invalid("host file must not duplicate models or role policies");
    const models = json(layout.models, closure);
    const installation = record(host.installation, "installation");
    if (typeof installation.libdir !== "string" || !isAbsolute(installation.libdir))
      return invalid("installation.libdir must be absolute");
    if (installation.packages !== undefined && (typeof installation.packages !== "string" || !isAbsolute(installation.packages)))
      return invalid("installation.packages must be absolute");
    const roots: ExtensionRoots = { libdir: installation.libdir,
      ...(typeof installation.packages === "string" ? { packages: installation.packages } : {}) };
    const profiles: Record<string, unknown> = Object.create(null);
    const roles: Record<string, RoleSettings> = Object.create(null);
    const authoredRoles: Record<string, AuthoredRoleSource> = Object.create(null);
    for (const [name, file] of Object.entries(layout.roles)) {
      // D23: a role file's fields are closed -- a tool surface is OMA's
      // internal policy, never an authored field, so one that appears here
      // fails the load rather than silently taking effect.
      const role = closedWithOptional(
        json(file, closure),
        ["agentProfile", "extensions", "promptFile"],
        [],
        `role ${name}`,
      );
      profiles[name] = role.agentProfile;
      authoredRoles[name] = Object.freeze({ path: file, value: Object.freeze({ ...role }) });
      roles[name] = roleSettings(root, roots, role, closure, assets);
    }
    return {
      host: { ...host, modelProfiles: models, agentProfiles: profiles },
      roles: Object.freeze(roles),
      layout,
      authoredRoles: Object.freeze(authoredRoles),
      files: closure.finish(layout.index),
      extensionAssets: assets ? "read" : "unread",
    };
  } catch (error) {
    throw sourceFailure(error);
  }
}
