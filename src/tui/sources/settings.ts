/** TUI-007/008/009: the Config screen's view of host authority.
 *
 * `config.json` stays the host-owned closed schema of CFG-001. This module
 * projects the few fields arch §23.6 exposes, transforms them purely, and
 * writes the result back atomically with a fresh policy revision (CFG-005).
 * It never invents a model, a quota or a profile that the host did not declare.
 */
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, relative } from "node:path";
import type { HostConfigV1 } from "../../../implementation/contracts.js";
import { StoreError } from "../../domain/errors.js";
import { loadConfig } from "../../config.js";
import { replaceDerivedFile } from "../../storage/durable-fs.js";
import type { ConfigField } from "../model.js";

export const PRINCIPAL_MODEL = "principal-model";
export const WORKER_MODEL = "worker-model";
export const WORKER_LIMIT = "worker-limit";
export const INITIAL_WORKERS = "initial-workers";
export const WORKER_PROFILE = "worker-profile";
export const EXTENSIONS = "extensions";

/** The authored layout behind the composed config. A split bundle keeps role
 * files and host.json as the real owners, so a Config edit must patch those
 * rather than flattening the bundle into its index (CFG-005, operations).
 */
export type ConfigLayout =
  | { readonly kind: "inline"; readonly path: string }
  | {
      readonly kind: "operations";
      readonly index: string;
      readonly host: string;
      readonly roles: Readonly<Record<string, string>>;
    };

export interface Settings {
  readonly path: string;
  readonly layout: ConfigLayout;
  readonly config: HostConfigV1;
  readonly workerProfile: string;
  readonly fields: readonly ConfigField[];
}

function workerProfileOf(config: HostConfigV1): string {
  const seeded = config.initialResidents[0]?.profile;
  if (seeded !== undefined && config.agentProfiles[seeded]) return seeded;
  const child = config.agentProfiles[config.principalProfile]?.childProfile;
  if (child !== null && child !== undefined && config.agentProfiles[child]) return child;
  const other = Object.keys(config.agentProfiles).find(name => name !== config.principalProfile);
  if (other !== undefined) return other;
  return config.principalProfile;
}

/** Resident profiles exclude the Principal's own profile: the Config screen
 * never offers to run Residents under Principal authority.
 */
export function residentProfiles(config: HostConfigV1): readonly string[] {
  const names = Object.keys(config.agentProfiles).filter(name => name !== config.principalProfile).sort();
  return names.length > 0 ? names : [config.principalProfile];
}

export function fieldsOf(config: HostConfigV1, workerProfile: string): readonly ConfigField[] {
  const models = Object.keys(config.modelProfiles).sort();
  const principalModel = config.agentProfiles[config.principalProfile]?.modelProfile ?? "";
  const workerModel = config.agentProfiles[workerProfile]?.modelProfile ?? "";
  return Object.freeze([
    Object.freeze({ kind: "choice" as const, id: PRINCIPAL_MODEL, label: "Principal model",
      value: principalModel, options: models, apply: "next-session" as const }),
    Object.freeze({ kind: "choice" as const, id: WORKER_MODEL, label: "Worker model",
      value: workerModel, options: models, apply: "next-activation" as const }),
    Object.freeze({ kind: "number" as const, id: WORKER_LIMIT, label: "Worker limit",
      value: config.quota.societyAgents, min: 1, max: 4096, apply: "restart" as const }),
    Object.freeze({ kind: "number" as const, id: INITIAL_WORKERS, label: "Initial workers",
      value: config.initialResidents.length, min: 0, max: 64, apply: "bootstrap-only" as const }),
    Object.freeze({ kind: "choice" as const, id: WORKER_PROFILE, label: "Worker profile",
      value: workerProfile, options: residentProfiles(config), apply: "next-activation" as const }),
    Object.freeze({ kind: "link" as const, id: EXTENSIONS, label: "Extensions" }),
  ]);
}

function readJsonObject(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    throw new StoreError("INVALID_REQUEST", `${path} must contain a JSON object`);
  return parsed as Record<string, unknown>;
}

/** Relative references inside a bundle stay inside it: the same containment the
 * operations loader enforces, repeated here because this module writes.
 */
function bundlePath(root: string, value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0 || isAbsolute(value))
    throw new StoreError("INVALID_REQUEST", `${what} must be a relative path`);
  const resolved = normalize(join(root, value));
  const inside = relative(root, resolved);
  if (inside.startsWith("..") || isAbsolute(inside))
    throw new StoreError("INVALID_REQUEST", `${what} escapes the configuration bundle`);
  return resolved;
}

export function layoutOf(path: string): ConfigLayout {
  let index: string;
  let source: Record<string, unknown>;
  try { index = realpathSync(path); source = readJsonObject(index); }
  catch { return Object.freeze({ kind: "inline" as const, path }); }
  if (source.kind !== "oma-operations-v1") return Object.freeze({ kind: "inline" as const, path: index });
  const root = dirname(index);
  const declared = source.roles;
  if (declared === null || typeof declared !== "object" || Array.isArray(declared))
    throw new StoreError("INVALID_REQUEST", "operations config roles must be an object");
  const roles: Record<string, string> = {};
  for (const [name, file] of Object.entries(declared as Record<string, unknown>))
    roles[name] = bundlePath(root, file, `roles.${name}`);
  return Object.freeze({
    kind: "operations" as const,
    index,
    host: bundlePath(root, source.host, "host"),
    roles: Object.freeze(roles),
  });
}

export function settingsOf(path: string, config: HostConfigV1, layout: ConfigLayout = { kind: "inline", path }): Settings {
  const workerProfile = workerProfileOf(config);
  return Object.freeze({ path, layout, config, workerProfile, fields: fieldsOf(config, workerProfile) });
}

export function readSettings(path: string): Settings {
  return settingsOf(path, loadConfig(path), layoutOf(path));
}

/** CFG-005: a config replacement must carry a new policy revision. Deriving it
 * from the content hash makes the value deterministic and guarantees it only
 * changes when the policy content actually changed.
 */
export function revisionFor(config: HostConfigV1): string {
  const withoutRevision = { ...config, integration: { ...config.integration, policyRevision: "" } };
  return `rev-${createHash("sha256").update(JSON.stringify(withoutRevision)).digest("hex").slice(0, 32)}`;
}

function assertKnown(present: boolean, message: string): void {
  if (!present) throw new StoreError("UNSUPPORTED_PROFILE", message);
}

function withSeedCount(config: HostConfigV1, count: number, profile: string): HostConfigV1 {
  const current = config.initialResidents;
  if (count <= current.length) return { ...config, initialResidents: current.slice(0, count) };
  const used = new Set(current.map(resident => resident.name));
  // CFG-002 keeps every seed field required, so a grown seed reuses the brief
  // the host already wrote rather than inventing an empty one the loader would
  // reject on the next start.
  const brief = current[current.length - 1]?.brief ?? "OMA resident.";
  const grown = [...current];
  let ordinal = 1;
  while (grown.length < count) {
    if (ordinal > 4096) throw new StoreError("INVALID_REQUEST", "no free bootstrap seed name");
    const name = `worker-${ordinal}`;
    ordinal += 1;
    if (used.has(name)) continue;
    used.add(name);
    grown.push({ name, profile, brief });
  }
  return { ...config, initialResidents: grown };
}

/** Pure. Returns the config that the caller then writes; it does not touch disk
 * so that the transform can be tested against the closed schema directly.
 */
export function applyField(settings: Settings, field: string, value: string | number): HostConfigV1 {
  const config = settings.config;
  switch (field) {
    case PRINCIPAL_MODEL: {
      assertKnown(typeof value === "string" && config.modelProfiles[value] !== undefined, "unknown model profile");
      const profile = config.agentProfiles[config.principalProfile];
      assertKnown(profile !== undefined, "principal profile is missing from host config");
      return { ...config, agentProfiles: { ...config.agentProfiles,
        [config.principalProfile]: { ...profile!, modelProfile: value as string } } };
    }
    case WORKER_MODEL: {
      assertKnown(typeof value === "string" && config.modelProfiles[value] !== undefined, "unknown model profile");
      const name = settings.workerProfile;
      const profile = config.agentProfiles[name];
      assertKnown(profile !== undefined, "worker profile is missing from host config");
      return { ...config, agentProfiles: { ...config.agentProfiles,
        [name]: { ...profile!, modelProfile: value as string } } };
    }
    case WORKER_PROFILE: {
      assertKnown(typeof value === "string" && config.agentProfiles[value] !== undefined, "unknown agent profile");
      // TUI-009: an existing Resident keeps its frozen spec reference. Only the
      // bootstrap seed, which has not created anything yet, follows this value.
      return { ...config, initialResidents: config.initialResidents.map(resident => ({ ...resident, profile: value as string })) };
    }
    case WORKER_LIMIT: {
      assertKnown(typeof value === "number" && Number.isSafeInteger(value) && value > 0, "worker limit must be a positive integer");
      return { ...config, quota: { ...config.quota, societyAgents: value as number } };
    }
    case INITIAL_WORKERS: {
      assertKnown(typeof value === "number" && Number.isSafeInteger(value) && value >= 0, "initial workers must be a non-negative integer");
      return withSeedCount(config, value as number, settings.workerProfile);
    }
    default:
      throw new StoreError("INVALID_REQUEST", `unknown settings field ${field}`);
  }
}

/** FS-002/CFG-001: host authority is replaced atomically, never edited in place.
 * The written bytes are revalidated by the caller's next read; this function
 * does not report success for a file it could not render.
 *
 * Only for an inline `config.json`. A split bundle must be patched at its real
 * owners instead, which `commitField` does.
 */
export function writeSettings(path: string, config: HostConfigV1): HostConfigV1 {
  const revised: HostConfigV1 = { ...config, integration: { ...config.integration, policyRevision: revisionFor(config) } };
  replaceDerivedFile(path, `${JSON.stringify(revised, null, 2)}\n`, 0o600);
  return revised;
}

function writeJsonObject(path: string, body: Record<string, unknown>): void {
  replaceDerivedFile(path, `${JSON.stringify(body, null, 2)}\n`, 0o600);
}

/** Merges into the file as authored, so fields this screen does not model —
 * role `toolSurface`, prompts, anything a later host adds — survive the edit.
 */
function patchFile(path: string, patch: (current: Record<string, unknown>) => Record<string, unknown>): void {
  let current: Record<string, unknown>;
  try { current = readJsonObject(path); }
  catch { throw new StoreError("STORE_CORRUPT", `configuration file became unreadable: ${path}`); }
  writeJsonObject(path, patch(current));
}

function roleFileOf(layout: Extract<ConfigLayout, { kind: "operations" }>, profile: string): string {
  const path = layout.roles[profile];
  if (path === undefined)
    throw new StoreError("UNSUPPORTED_PROFILE", `the configuration bundle has no role file for "${profile}"`);
  return path;
}

function patchRoleModel(layout: Extract<ConfigLayout, { kind: "operations" }>, profile: string, model: string): void {
  patchFile(roleFileOf(layout, profile), current => {
    const agentProfile = current.agentProfile;
    if (agentProfile === null || typeof agentProfile !== "object" || Array.isArray(agentProfile))
      throw new StoreError("STORE_CORRUPT", `role "${profile}" has no agentProfile object`);
    return { ...current, agentProfile: { ...(agentProfile as Record<string, unknown>), modelProfile: model } };
  });
}

/** Writes one confirmed Config value to whichever file actually owns it, then
 * records the new policy revision (CFG-005). The composed config is validated
 * first, so an unknown model or profile is refused before anything is written.
 */
export function commitField(settings: Settings, field: string, value: string | number): void {
  const applied = applyField(settings, field, value);
  const revision = revisionFor(applied);
  if (settings.layout.kind === "inline") {
    writeSettings(settings.layout.path, applied);
    return;
  }
  const layout = settings.layout;
  switch (field) {
    case PRINCIPAL_MODEL:
      patchRoleModel(layout, settings.config.principalProfile, String(value));
      break;
    case WORKER_MODEL:
      patchRoleModel(layout, settings.workerProfile, String(value));
      break;
    case WORKER_LIMIT:
      patchFile(layout.host, current => {
        const quota = current.quota;
        if (quota === null || typeof quota !== "object" || Array.isArray(quota))
          throw new StoreError("STORE_CORRUPT", "host file has no quota object");
        return { ...current, quota: { ...(quota as Record<string, unknown>), societyAgents: value } };
      });
      break;
    case INITIAL_WORKERS:
    case WORKER_PROFILE:
      patchFile(layout.host, current => ({ ...current, initialResidents: applied.initialResidents }));
      break;
    default:
      throw new StoreError("INVALID_REQUEST", `unknown settings field ${field}`);
  }
  patchFile(layout.host, current => {
    const integration = current.integration;
    if (integration === null || typeof integration !== "object" || Array.isArray(integration))
      throw new StoreError("STORE_CORRUPT", "host file has no integration object");
    return { ...current, integration: { ...(integration as Record<string, unknown>), policyRevision: revision } };
  });
}
