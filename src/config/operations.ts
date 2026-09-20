/** Host-owned authoring format. Reads data/assets, never imports extensions or
 * changes the closed HostConfigV1/wire/ledger format. No live reload. */
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { StoreError } from "../domain/errors.js";
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
export interface ConfigurationSource {
  readonly host: unknown;
  readonly roles: Readonly<Record<string, RoleSettings>>;
}
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
function bytes(path: string): Buffer {
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
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
    if (
      value.length !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      return invalid("configuration file changed while being read");
    return value;
  } finally {
    closeSync(fd);
  }
}
function json(path: string): Record<string, unknown> {
  return parseJsonObject(bytes(path)).raw;
}
function roleSettings(
  root: string,
  libdir: string,
  role: Record<string, unknown>,
): RoleSettings {
  const entries = role.extensions;
  if (
    !Array.isArray(entries) ||
    entries.length < 1 ||
    entries.length > 16 ||
    entries[0] !== DEPLOYMENT_LAYOUT.extension ||
    entries.some((entry) => typeof entry !== "string") ||
    new Set(entries).size !== entries.length
  )
    return invalid(
      "extensions must start with the trusted OMA extension, be unique, and contain at most 16 files",
    );
  const extensions = entries.map((entry) => {
    const path = localPath(libdir, entry);
    if (!/\.(?:js|mjs|ts)$/.test(path))
      return invalid("extension must be a local JS/TS file");
    return Object.freeze({
      path,
      sha256: createHash("sha256").update(bytes(path)).digest("hex"),
    });
  });
  const prompt = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  }).decode(bytes(localPath(root, role.promptFile)));
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
export function configurationLayout(path: string): ConfigurationLayout {
  try {
    const location = realpathSync(path);
    const source = json(location);
    if (source.kind !== "oma-operations-v1")
      return Object.freeze({ kind: "inline" as const, path: location });
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
    return Object.freeze({
      kind: "operations" as const,
      index: location,
      host: localPath(root, manifest.host),
      models: localPath(root, manifest.models),
      roles: Object.freeze(roles),
    });
  } catch (error) {
    if (error instanceof StoreError) throw error;
    throw new StoreError(
      "INVALID_REQUEST",
      `operations config unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
export function readConfigurationSource(path: string): ConfigurationSource {
  try {
    const layout = configurationLayout(path);
    if (layout.kind === "inline")
      return { host: json(layout.path), roles: Object.freeze({}) };
    const root = dirname(layout.index);
    const host = json(layout.host);
    if (
      Object.hasOwn(host, "modelProfiles") ||
      Object.hasOwn(host, "agentProfiles")
    )
      return invalid("host file must not duplicate models or role policies");
    const models = json(layout.models);
    const installation = record(host.installation, "installation");
    if (
      typeof installation.libdir !== "string" ||
      !isAbsolute(installation.libdir)
    )
      return invalid("installation.libdir must be absolute");
    const profiles: Record<string, unknown> = Object.create(null);
    const roles: Record<string, RoleSettings> = Object.create(null);
    for (const [name, file] of Object.entries(layout.roles)) {
      const role = closedWithOptional(
        json(file),
        ["agentProfile", "extensions", "promptFile"],
        ["toolSurface"],
        `role ${name}`,
      );
      profiles[name] = role.agentProfile;
      roles[name] = roleSettings(root, installation.libdir, role);
    }
    return {
      host: { ...host, modelProfiles: models, agentProfiles: profiles },
      roles: Object.freeze(roles),
    };
  } catch (error) {
    if (error instanceof StoreError) throw error;
    throw new StoreError(
      "INVALID_REQUEST",
      `operations config unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
