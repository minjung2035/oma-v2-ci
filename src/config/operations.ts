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

export interface RoleSettings {
  readonly prompt: string;
  readonly extensions: readonly Readonly<{ path: string; sha256: string }>[];
}
export interface ConfigurationSource {
  readonly host: unknown;
  readonly roles: Readonly<Record<string, RoleSettings>>;
}
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
  return Object.freeze({ prompt, extensions: Object.freeze(extensions) });
}
export function readConfigurationSource(path: string): ConfigurationSource {
  try {
    const location = realpathSync(path);
    const source = json(location);
    if (source.kind !== "oma-operations-v1")
      return { host: source, roles: Object.freeze({}) };
    const manifest = closed(
      source,
      ["kind", "host", "models", "roles"],
      "manifest",
    );
    const root = dirname(location);
    const host = json(localPath(root, manifest.host));
    if (
      Object.hasOwn(host, "modelProfiles") ||
      Object.hasOwn(host, "agentProfiles")
    )
      return invalid("host file must not duplicate models or role policies");
    const models = json(localPath(root, manifest.models));
    const files = record(manifest.roles, "roles");
    if (Object.keys(files).length < 1 || Object.keys(files).length > 64)
      return invalid("expected 1..64 explicitly listed roles");
    const installation = record(host.installation, "installation");
    if (
      typeof installation.libdir !== "string" ||
      !isAbsolute(installation.libdir)
    )
      return invalid("installation.libdir must be absolute");
    const profiles: Record<string, unknown> = Object.create(null);
    const roles: Record<string, RoleSettings> = Object.create(null);
    for (const [name, file] of Object.entries(files)) {
      if (!ACTOR_NAME_RE.test(name))
        return invalid("invalid role profile name");
      const role = closed(
        json(localPath(root, file)),
        ["agentProfile", "extensions", "promptFile"],
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
