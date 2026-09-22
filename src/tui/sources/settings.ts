/** TUI-007/008/009: the Config screen's view of host authority.
 *
 * `config.json` stays the host-owned closed schema of CFG-001. This module
 * projects the few fields arch §23.6 exposes, transforms them purely, and
 * writes the result back atomically with a fresh policy revision (CFG-005).
 * It never invents a model, a quota or a profile that the host did not declare.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { HostConfigV1 } from "../../../implementation/contracts.js";
import { StoreError } from "../../domain/errors.js";
import { loadConfig, validateConfig, type ValidatedConfigCandidate } from "../../config.js";
import { configurationLayout, type ConfigurationLayout } from "../../config/operations.js";
import { replaceDerivedFile } from "../../storage/durable-fs.js";
import type { ApplyScope, ConfigField } from "../model.js";
import { CONFIG_BOUNDS } from "../limits.js";

export const PRINCIPAL_MODEL = "principal-model";
export const WORKER_MODEL = "worker-model";
export const WORKER_LIMIT = "worker-limit";
export const INITIAL_WORKERS = "initial-workers";
export const WORKER_PROFILE = "worker-profile";
export const EDITABLE_FIELDS = Object.freeze([
  PRINCIPAL_MODEL,
  WORKER_MODEL,
  WORKER_LIMIT,
  INITIAL_WORKERS,
  WORKER_PROFILE,
] as const);
export type EditableField = (typeof EDITABLE_FIELDS)[number];

export const EXTENSIONS = "extensions";

/** The authored layout behind the composed config. A split bundle keeps role
 * files and host.json as the real owners, so a Config edit must patch those
 * rather than flattening the bundle into its index (CFG-005, operations).
 *
 * The layout itself is the loader's answer, not this screen's. This module used
 * to walk the manifest a second time with a weaker containment rule; what a
 * bundle contains has one owner, and a screen that writes must ask it.
 */
export type ConfigLayout = ConfigurationLayout;

export interface Settings {
  readonly path: string;
  readonly layout: ConfigLayout;
  readonly config: HostConfigV1;
  readonly workerProfile: string;
  readonly fields: readonly ConfigField[];
}

function workerProfileOf(config: HostConfigV1): string {
  const seeded = config.initialResidents[0]?.profile;
  if (seeded !== undefined && Object.hasOwn(config.agentProfiles, seeded)) return seeded;
  const child = config.agentProfiles[config.principalProfile]?.childProfile;
  if (child !== null && child !== undefined && Object.hasOwn(config.agentProfiles, child)) return child;
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
  const editable = EDITABLE_FIELDS
    .filter(field => field !== WORKER_PROFILE || config.initialResidents.length > 0)
    .map(field => {
      const descriptor = EDITABLE_FIELD_DESCRIPTORS[field];
      return Object.freeze({
        id: field,
        label: descriptor.label,
        apply: descriptor.apply,
        ...descriptor.view(config, workerProfile),
      }) as ConfigField;
    });
  return Object.freeze([
    ...editable,
    Object.freeze({ kind: "link" as const, id: EXTENSIONS, label: "Extensions" }),
  ]);
}

function readJsonObject(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    throw new StoreError("INVALID_REQUEST", `${path} must contain a JSON object`);
  return parsed as Record<string, unknown>;
}

export function settingsOf(path: string, config: HostConfigV1, layout: ConfigLayout = { kind: "inline", path }): Settings {
  const workerProfile = workerProfileOf(config);
  return Object.freeze({ path, layout, config, workerProfile, fields: fieldsOf(config, workerProfile) });
}

export function readSettings(path: string): Settings {
  return settingsOf(path, loadConfig(path), configurationLayout(path));
}

/** CFG-005: a config replacement must carry a new policy revision. Deriving it
 * from the content hash makes the value deterministic and guarantees it only
 * changes when the policy content actually changed.
 */
export function revisionFor(config: HostConfigV1): string {
  const withoutRevision = { ...config, integration: { ...config.integration, policyRevision: "" } };
  return `rev-${createHash("sha256").update(JSON.stringify(withoutRevision)).digest("hex").slice(0, CONFIG_BOUNDS.revisionDigestHex.value)}`;
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
    if (ordinal > CONFIG_BOUNDS.seedNameAttempts.value) throw new StoreError("INVALID_REQUEST", "no free bootstrap seed name");
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
  if (!Object.hasOwn(EDITABLE_FIELD_DESCRIPTORS, field))
    throw new StoreError("INVALID_REQUEST", `unknown settings field ${field}`);
  return EDITABLE_FIELD_DESCRIPTORS[field as EditableField].transform(settings, value);
}

/** FS-002/CFG-001: host authority is replaced atomically, never edited in place.
 * The complete candidate is validated before rendering; a later read independently
 * re-observes the committed bytes.
 *
 * Only for an inline `config.json`. A split bundle must be patched at its real
 * owners instead, which `commitField` does.
 */
function writeValidatedSettings(path: string, candidate: ValidatedConfigCandidate): ValidatedConfigCandidate {
  const revised = validateConfig({
    ...candidate,
    integration: { ...candidate.integration, policyRevision: revisionFor(candidate) },
  });
  replaceDerivedFile(path, `${JSON.stringify(revised, null, 2)}\n`, 0o600);
  return revised;
}

/** Compatibility facade: arbitrary HostConfigV1 is never handed to the writer. */
export function writeSettings(path: string, config: HostConfigV1): HostConfigV1 {
  return writeValidatedSettings(path, validateConfig(config));
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
    return { ...current, agentProfile: { ...requireObject(current.agentProfile, `role "${profile}" agentProfile`), modelProfile: model } };
  });
}

/** Where each field actually lives in a split bundle. Declared once so the
 * routing cannot drift from the transform above; adding a field without a
 * placement fails to compile.
 */
type FieldPlacement =
  | { readonly at: "role"; readonly profile: (settings: Settings) => string }
  | { readonly at: "host"; readonly patch: (current: Record<string, unknown>, applied: HostConfigV1, value: string | number) => Record<string, unknown> };

type EditableFieldView =
  | { readonly kind: "choice"; readonly value: string; readonly options: readonly string[] }
  | { readonly kind: "number"; readonly value: number; readonly min: number; readonly max: number };

export interface EditableFieldDescriptor {
  readonly label: string;
  readonly apply: ApplyScope;
  readonly view: (config: HostConfigV1, workerProfile: string) => EditableFieldView;
  readonly transform: (settings: Settings, value: string | number) => HostConfigV1;
  readonly placement: FieldPlacement;
}

function requireObject(value: unknown, what: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new StoreError("STORE_CORRUPT", `host file has no ${what} object`);
  return value as Record<string, unknown>;
}

const DESCRIPTOR_SOURCE = {
  [PRINCIPAL_MODEL]: Object.freeze({
    label: "Principal model",
    apply: "next-session",
    view: (config: HostConfigV1) => ({
      kind: "choice" as const,
      value: config.agentProfiles[config.principalProfile]?.modelProfile ?? "",
      options: Object.keys(config.modelProfiles).sort(),
    }),
    transform: (settings: Settings, value: string | number) => {
      const config = settings.config;
      assertKnown(typeof value === "string" && Object.hasOwn(config.modelProfiles, value), "unknown model profile");
      const profile = config.agentProfiles[config.principalProfile];
      assertKnown(profile !== undefined, "principal profile is missing from host config");
      return { ...config, agentProfiles: { ...config.agentProfiles,
        [config.principalProfile]: { ...profile!, modelProfile: value as string } } };
    },
    placement: { at: "role" as const, profile: (settings: Settings) => settings.config.principalProfile },
  }),
  [WORKER_MODEL]: Object.freeze({
    label: "Worker model",
    apply: "next-activation",
    view: (config: HostConfigV1, workerProfile: string) => ({
      kind: "choice" as const,
      value: config.agentProfiles[workerProfile]?.modelProfile ?? "",
      options: Object.keys(config.modelProfiles).sort(),
    }),
    transform: (settings: Settings, value: string | number) => {
      const config = settings.config;
      assertKnown(typeof value === "string" && Object.hasOwn(config.modelProfiles, value), "unknown model profile");
      const name = settings.workerProfile;
      const profile = config.agentProfiles[name];
      assertKnown(profile !== undefined, "worker profile is missing from host config");
      return { ...config, agentProfiles: { ...config.agentProfiles,
        [name]: { ...profile!, modelProfile: value as string } } };
    },
    placement: { at: "role" as const, profile: (settings: Settings) => settings.workerProfile },
  }),
  [WORKER_LIMIT]: Object.freeze({
    label: "Worker limit",
    apply: "restart",
    view: (config: HostConfigV1) => ({
      kind: "number" as const, value: config.quota.societyAgents, min: 1, max: CONFIG_BOUNDS.maxWorkerLimit.value,
    }),
    transform: (settings: Settings, value: string | number) => {
      assertKnown(typeof value === "number" && Number.isSafeInteger(value) && value > 0, "worker limit must be a positive integer");
      return { ...settings.config, quota: { ...settings.config.quota, societyAgents: value as number } };
    },
    placement: {
      at: "host" as const,
      patch: (current: Record<string, unknown>, _applied: HostConfigV1, value: string | number) => ({
        ...current, quota: { ...requireObject(current.quota, "quota"), societyAgents: value },
      }),
    },
  }),
  [INITIAL_WORKERS]: Object.freeze({
    label: "Initial workers",
    apply: "bootstrap-only",
    view: (config: HostConfigV1) => ({
      kind: "number" as const, value: config.initialResidents.length, min: 0, max: CONFIG_BOUNDS.maxInitialWorkers.value,
    }),
    transform: (settings: Settings, value: string | number) => {
      assertKnown(typeof value === "number" && Number.isSafeInteger(value) && value >= 0, "initial workers must be a non-negative integer");
      return withSeedCount(settings.config, value as number, settings.workerProfile);
    },
    placement: {
      at: "host" as const,
      patch: (current: Record<string, unknown>, applied: HostConfigV1) => ({ ...current, initialResidents: applied.initialResidents }),
    },
  }),
  [WORKER_PROFILE]: Object.freeze({
    label: "Bootstrap worker profile",
    apply: "bootstrap-only",
    view: (config: HostConfigV1, workerProfile: string) => ({
      kind: "choice" as const, value: workerProfile, options: residentProfiles(config),
    }),
    transform: (settings: Settings, value: string | number) => {
      const config = settings.config;
      assertKnown(config.initialResidents.length > 0, "there are no bootstrap workers to change");
      assertKnown(typeof value === "string" && Object.hasOwn(config.agentProfiles, value), "unknown agent profile");
      // Existing Resident specs are immutable; only not-yet-created bootstrap seeds change.
      return { ...config, initialResidents: config.initialResidents.map(resident => ({ ...resident, profile: value as string })) };
    },
    placement: {
      at: "host" as const,
      patch: (current: Record<string, unknown>, applied: HostConfigV1) => ({ ...current, initialResidents: applied.initialResidents }),
    },
  }),
} satisfies Readonly<Record<EditableField, EditableFieldDescriptor>>;

const PLACEMENT: Readonly<Record<EditableField, EditableFieldDescriptor>> =
  Object.freeze(Object.assign(Object.create(null), DESCRIPTOR_SOURCE));
export const EDITABLE_FIELD_DESCRIPTORS = PLACEMENT;

/** Writes one confirmed Config value to whichever file actually owns it, then
 * records the new policy revision (CFG-005). The composed config is validated
 * first, so an unknown model or profile is refused before anything is written.
 */
export function commitField(settings: Settings, field: string, value: string | number): void {
  if (!Object.hasOwn(EDITABLE_FIELD_DESCRIPTORS, field))
    throw new StoreError("INVALID_REQUEST", `unknown settings field ${field}`);
  const descriptor = EDITABLE_FIELD_DESCRIPTORS[field as EditableField];
  const applied = validateConfig(descriptor.transform(settings, value));
  const revision = revisionFor(applied);
  if (settings.layout.kind === "inline") {
    writeValidatedSettings(settings.layout.path, applied);
    return;
  }
  const layout = settings.layout;
  const placement = descriptor.placement;
  if (placement.at === "role") patchRoleModel(layout, placement.profile(settings), String(value));
  else patchFile(layout.host, current => placement.patch(current, applied, value));
  patchFile(layout.host, current => ({
    ...current,
    integration: { ...requireObject(current.integration, "integration"), policyRevision: revision },
  }));
}
