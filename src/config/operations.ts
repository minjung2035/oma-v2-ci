/** Host-owned authoring format. Reads data/assets, never imports extensions or
 * changes the closed HostConfigV1/wire/ledger format. No live reload. */
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
import { StoreError, unobserved } from "../domain/errors.js";
import { DEPLOYMENT_LAYOUT } from "../domain/deployment.js";
import { ACTOR_NAME_RE } from "../domain/identifiers.js";
import { parseJsonObject } from "../frame.js";
import {
  planToolSurface,
  type GroupMemberRef,
  type GroupSpec,
  type ToolSurfaceConfig,
  type ToolSurfacePlan,
} from "../domain/tool-surface.js";

export interface RoleSettings {
  readonly prompt: string;
  readonly extensions: readonly Readonly<{ path: string; sha256: string }>[];
  /** TSP-002: validated at load. null means the role shows every registered
   * tool, which is the behaviour of a role that declares nothing.
   */
  readonly toolSurface: ToolSurfacePlan | null;
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
export const CONFIGURATION_SOURCE_LIMITS = Object.freeze({ files: 256, bytes: 8 * 1024 * 1024 });
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
  constructor(private readonly observer?: ConfigurationReadObserver) {}
  add(path: string, stat: Stats, content: Buffer): void {
    const identity = Object.freeze({
      path, dev: stat.dev, ino: stat.ino, bytes: content.length,
      mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
    const prior = this.identities.get(path);
    if (prior && (prior.dev !== identity.dev || prior.ino !== identity.ino || prior.sha256 !== identity.sha256))
      return invalid("configuration file identity changed within one snapshot");
    if (!prior) this.identities.set(path, identity);
    const files = this.identities.size;
    const total = [...this.identities.values()].reduce((sum, value) => sum + value.bytes, 0);
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
    if (!before.isFile() || before.size > 1024 * 1024)
      return invalid("expected a regular file of at most 1 MiB");
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
    closure?.add(path, after, value);
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
/** The shape of one entry: a normalized relative path to a JS/TS file. */
export function extensionEntryProblem(entry: string): string | null {
  if (!entry || entry.includes("\0") || entry.includes("\\") || isAbsolute(entry) ||
      entry.split("/").some(part => !part || part === "." || part === ".."))
    return "extension entry must be a normalized relative file path";
  if (!/\.(?:js|mjs|ts)$/.test(entry)) return "extension must be a local JS/TS file";
  return null;
}
export type ExtensionAsset =
  | { readonly kind: "present"; readonly path: string; readonly sha256: string }
  | { readonly kind: "missing" }
  | { readonly kind: "refused"; readonly reason: string };
/** WP14.01 observation adapter: the file an entry names, judged exactly as
 * the loader judges it -- inside libdir, reached through no symlink, a
 * regular file of at most 1 MiB. A missing file is reported as missing, so a
 * declaration can be removed without opening an asset that is not there. */
export function observeExtensionAsset(libdir: string, entry: string): ExtensionAsset {
  const problem = extensionEntryProblem(entry);
  if (problem) return Object.freeze({ kind: "refused", reason: problem });
  if (!lstatSync(resolve(libdir, entry), { throwIfNoEntry: false })) return Object.freeze({ kind: "missing" });
  try {
    const path = localPath(libdir, entry);
    return Object.freeze({ kind: "present", path, sha256: createHash("sha256").update(bytes(path)).digest("hex") });
  } catch (error) {
    return Object.freeze({ kind: "refused", reason: error instanceof Error ? error.message : String(error) });
  }
}
function roleSettings(
  root: string,
  libdir: string,
  role: Record<string, unknown>,
  closure: SourceClosure,
  assets: boolean,
): RoleSettings {
  const entries = role.extensions;
  const listProblem = extensionListProblem(entries);
  if (listProblem) return invalid(listProblem);
  const extensions = !assets ? [] : (entries as string[]).map((entry) => {
    const path = localPath(libdir, entry);
    return Object.freeze({
      path,
      sha256: createHash("sha256").update(bytes(path, closure)).digest("hex"),
    });
  });
  const prompt = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  }).decode(bytes(localPath(root, role.promptFile), closure));
  return Object.freeze({
    prompt,
    extensions: Object.freeze(extensions),
    toolSurface: toolSurfaceOf(role.toolSurface),
  });
}
function stringList(value: unknown, name: string): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
    return invalid(`${name} must be an array of strings`);
  return value as readonly string[];
}
/** Shape-checks the authored block, then hands the meaning to the single
 * canonical validator in src/domain/tool-surface.ts. Cycles, duplicates and
 * unknown references are that validator's decision, not this parser's.
 */
function toolSurfaceOf(value: unknown): ToolSurfacePlan | null {
  if (value === undefined || value === null) return null;
  const block = closedWithOptional(
    value,
    [],
    ["defaultMode", "direct", "disabled", "groups", "roots"],
    "toolSurface",
  );
  const declaredMode = block.defaultMode ?? "DIRECT";
  if (declaredMode !== "DIRECT" && declaredMode !== "DISABLED")
    return invalid("toolSurface.defaultMode must be DIRECT or DISABLED");
  const rawGroups = block.groups === undefined ? [] : block.groups;
  if (!Array.isArray(rawGroups)) return invalid("toolSurface.groups must be an array");
  const groups: GroupSpec[] = rawGroups.map((entry, index) => {
    const group = closed(entry, ["name", "description", "members"], `toolSurface.groups[${index}]`);
    if (typeof group.name !== "string" || typeof group.description !== "string")
      return invalid(`toolSurface.groups[${index}] name and description must be strings`);
    if (!Array.isArray(group.members))
      return invalid(`toolSurface.groups[${index}].members must be an array`);
    const members: GroupMemberRef[] = group.members.map((member, position) => {
      const entryRecord = record(member, `toolSurface.groups[${index}].members[${position}]`);
      const keys = Object.keys(entryRecord);
      if (keys.length !== 1 || (keys[0] !== "tool" && keys[0] !== "group"))
        return invalid(`toolSurface.groups[${index}].members[${position}] must be {tool} or {group}`);
      const target = entryRecord[keys[0]!];
      if (typeof target !== "string")
        return invalid(`toolSurface.groups[${index}].members[${position}] target must be a string`);
      return keys[0] === "tool" ? { tool: target } : { group: target };
    });
    return { name: group.name, description: group.description, members };
  });
  const config: ToolSurfaceConfig = {
    defaultMode: declaredMode,
    direct: stringList(block.direct, "toolSurface.direct"),
    disabled: stringList(block.disabled, "toolSurface.disabled"),
    groups,
    roots: stringList(block.roots, "toolSurface.roots"),
  };
  return planToolSurface(config);
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
    const profiles: Record<string, unknown> = Object.create(null);
    const roles: Record<string, RoleSettings> = Object.create(null);
    const authoredRoles: Record<string, AuthoredRoleSource> = Object.create(null);
    for (const [name, file] of Object.entries(layout.roles)) {
      const role = closedWithOptional(
        json(file, closure),
        ["agentProfile", "extensions", "promptFile"],
        ["toolSurface"],
        `role ${name}`,
      );
      profiles[name] = role.agentProfile;
      authoredRoles[name] = Object.freeze({ path: file, value: Object.freeze({ ...role }) });
      roles[name] = roleSettings(root, installation.libdir, role, closure, assets);
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
