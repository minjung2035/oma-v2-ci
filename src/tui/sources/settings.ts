/** TUI-007/008/009: the Config screen's view of host authority.
 *
 * `config.json` stays the host-owned closed schema of CFG-001. This module
 * projects the few fields arch §23.6 exposes, transforms them purely, and
 * writes the result back atomically with a fresh policy revision (CFG-005).
 * It never invents a model, a quota or a profile that the host did not declare.
 */
import { createHash } from "node:crypto";
import type { HostConfigV1 } from "../../../implementation/contracts.js";
import { StoreError } from "../../domain/errors.js";
import { loadConfigurationSnapshot, validateConfig, type ConfigurationSnapshot, type ValidatedConfigCandidate } from "../../config.js";
import type { ConfigurationLayout } from "../../config/operations.js";
import { replaceDerivedFile, type DurabilityObserver } from "../../storage/durable-fs.js";
import { commitManagedGeneration, managedRolesOf, type ManagedLimits, type ManagedCommit, type ManagedEdit, type ManagedSource } from "../../config/generations.js";
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

/** The authored layout behind the composed config. A split bundle is edited
 * as a whole managed generation whose manifest is replaced last (D02/WP13),
 * never patched file by file and never flattened into its index.
 *
 * The layout itself is the loader's answer, not this screen's. This module used
 * to walk the manifest a second time with a weaker containment rule; what a
 * bundle contains has one owner, and a screen that writes must ask it.
 */
export type ConfigLayout = ConfigurationLayout;

export interface Settings {
  readonly path: string;
  readonly snapshot: ConfigurationSnapshot | null;
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

/** WP15/D05: whether this society's one bootstrap has happened, as observed.
 * The broker bootstraps only an empty registry, so the Principal row in an
 * observed status means seeds are no longer read; without an observation it
 * is unknown, never assumed. */
export type BootstrapState = "pending" | "done" | "unknown";
export function bootstrapStateOf(observation: { readonly kind: string; readonly statuses?: readonly { readonly agent: string }[] }): BootstrapState {
  if (observation.kind !== "observed" || observation.statuses === undefined) return "unknown";
  return observation.statuses.some(status => status.agent === "principal") ? "done" : "pending";
}

export function fieldsOf(config: HostConfigV1, workerProfile: string, bootstrap: BootstrapState = "unknown"): readonly ConfigField[] {
  const editable = EDITABLE_FIELDS
    .map(field => {
      const descriptor = EDITABLE_FIELD_DESCRIPTORS[field];
      return Object.freeze({
        id: field,
        label: descriptor.label,
        apply: descriptor.apply,
        blocked: descriptor.blocked?.(config, bootstrap) ?? null,
        ...descriptor.view(config, workerProfile),
      }) as ConfigField;
    });
  return Object.freeze([
    ...editable,
    Object.freeze({ kind: "link" as const, id: EXTENSIONS, label: "Extensions" }),
  ]);
}

export function settingsOf(
  path: string,
  config: HostConfigV1,
  layout: ConfigLayout = { kind: "inline", path },
  snapshot: ConfigurationSnapshot | null = null,
 ): Settings {
  const workerProfile = workerProfileOf(config);
  return Object.freeze({ path, snapshot, layout, config, workerProfile, fields: fieldsOf(config, workerProfile) });
}

export function readSettings(path: string): Settings {
  const snapshot = loadConfigurationSnapshot(path);
  return settingsOf(path, snapshot.config, snapshot.layout, snapshot);
}

/** CFG-005: a config replacement must carry a new policy revision. Deriving it
 * from the content hash makes the value deterministic and guarantees it only
 * changes when the policy content actually changed.
 */
export function revisionFor(config: HostConfigV1, roles?: Readonly<Record<string, unknown>>): string {
  const withoutRevision = { ...config, integration: { ...config.integration, policyRevision: "" } };
  const hash = createHash("sha256").update(JSON.stringify(withoutRevision));
  // D02/CFG-005: in a bundle the roles' prompts, extension selection and tool
  // surfaces are policy too; an inline config has none, so its value is unchanged.
  if (roles !== undefined) hash.update("\n").update(JSON.stringify(roles));
  return `rev-${hash.digest("hex").slice(0, CONFIG_BOUNDS.revisionDigestHex.value)}`;
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
 * Only for an inline `config.json`; a split bundle is published as a managed
 * generation by `commitManagedEdit`.
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

/** D02/WP13: the one writer of a split bundle. The candidate is revised over
 * its effective config and roles, compared with the snapshot it was derived
 * from (a same-semantic save publishes nothing), validated whole, and handed
 * to the generation writer, which refuses a snapshot that is no longer current.
 */
export function commitManagedEdit(snapshot: ManagedSource, config: HostConfigV1, roles: ManagedEdit["roles"] = {},
  faults?: DurabilityObserver, limits?: ManagedLimits): ManagedCommit {
  const before = managedRolesOf(snapshot, {}, snapshot.config);
  const after = managedRolesOf(snapshot, roles, config);
  const semantic = (value: HostConfigV1, described: Record<string, unknown>) =>
    JSON.stringify([{ ...value, integration: { ...value.integration, policyRevision: "" } }, described]);
  if (semantic(config, roleRevisionInput(after)) === semantic(snapshot.config, roleRevisionInput(before)))
    return Object.freeze({ kind: "unchanged", generation: null });
  const revised = validateConfig({ ...config,
    integration: { ...config.integration, policyRevision: revisionFor(config, roleRevisionInput(after)) } });
  return commitManagedGeneration(snapshot, { config: revised, roles }, faults, limits);
}
function roleRevisionInput(roles: ReturnType<typeof managedRolesOf>): Record<string, unknown> {
  return Object.fromEntries(Object.keys(roles).sort().map(name => {
    const role = roles[name]!;
    return [name, { extensions: role.extensions, toolSurface: role.toolSurface ?? null,
      prompt: createHash("sha256").update(role.prompt).digest("hex") }];
  }));
}

type EditableFieldView =
  | { readonly kind: "choice"; readonly value: string; readonly options: readonly string[] }
  | { readonly kind: "number"; readonly value: number; readonly min: number; readonly max: number };

export interface EditableFieldDescriptor {
  readonly label: string;
  readonly apply: ApplyScope;
  /** WP15: why an edit would have no target or no effect now, or null. The
   * same descriptor owns label, value, apply time and this refusal. */
  readonly blocked?: (config: HostConfigV1, bootstrap: BootstrapState) => string | null;
  readonly view: (config: HostConfigV1, workerProfile: string) => EditableFieldView;
  readonly transform: (settings: Settings, value: string | number) => HostConfigV1;
}

/** D05: seeds are read by the first bootstrap only. */
const seedsBlocked = (_config: HostConfigV1, bootstrap: BootstrapState): string | null =>
  bootstrap === "done" ? "이미 bootstrap된 society: 기존 worker에 적용되지 않음" : null;

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
  }),
  [INITIAL_WORKERS]: Object.freeze({
    label: "Initial workers",
    apply: "bootstrap-only",
    blocked: seedsBlocked,
    view: (config: HostConfigV1) => ({
      kind: "number" as const, value: config.initialResidents.length, min: 0, max: CONFIG_BOUNDS.maxInitialWorkers.value,
    }),
    transform: (settings: Settings, value: string | number) => {
      assertKnown(typeof value === "number" && Number.isSafeInteger(value) && value >= 0, "initial workers must be a non-negative integer");
      return withSeedCount(settings.config, value as number, settings.workerProfile);
    },
  }),
  [WORKER_PROFILE]: Object.freeze({
    label: "Bootstrap worker profile",
    apply: "bootstrap-only",
    // D05: with no seeds there is no target; the selection is not kept anywhere.
    blocked: (config: HostConfigV1, bootstrap: BootstrapState) => config.initialResidents.length === 0
      ? "bootstrap worker 없음: Initial workers를 먼저 늘리세요" : seedsBlocked(config, bootstrap),
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
  }),
} satisfies Readonly<Record<EditableField, EditableFieldDescriptor>>;

const PLACEMENT: Readonly<Record<EditableField, EditableFieldDescriptor>> =
  Object.freeze(Object.assign(Object.create(null), DESCRIPTOR_SOURCE));
export const EDITABLE_FIELD_DESCRIPTORS = PLACEMENT;

/** Writes one confirmed Config value (CFG-005). The composed config is
 * validated first, so an unknown model or profile is refused before anything is
 * written; an inline config is replaced as one file, a split bundle is
 * published as one managed generation.
 */
export type FieldCommit = { readonly kind: "saved" } | { readonly kind: "unchanged" };
export function commitField(settings: Settings, field: string, value: string | number, bootstrap: BootstrapState = "unknown"): FieldCommit {
  if (!Object.hasOwn(EDITABLE_FIELD_DESCRIPTORS, field))
    throw new StoreError("INVALID_REQUEST", `unknown settings field ${field}`);
  const descriptor = EDITABLE_FIELD_DESCRIPTORS[field as EditableField];
  // WP15: the screen does not offer a blocked field; the writer refuses it too.
  const blocked = descriptor.blocked?.(settings.config, bootstrap) ?? null;
  if (blocked !== null) throw new StoreError("INVALID_REQUEST", blocked);
  const applied = validateConfig(descriptor.transform(settings, value));
  if (settings.layout.kind === "inline") {
    const { integration: _before, ...current } = settings.config;
    const { integration: _after, ...next } = applied;
    if (JSON.stringify(next) === JSON.stringify(current)) return Object.freeze({ kind: "unchanged" });
    writeValidatedSettings(settings.layout.path, applied);
    return Object.freeze({ kind: "saved" });
  }
  if (settings.snapshot === null)
    throw new StoreError("UNSUPPORTED_PROFILE", "a split configuration is edited only from the snapshot it was read as");
  return Object.freeze({ kind: commitManagedEdit(settings.snapshot, applied).kind === "unchanged" ? "unchanged" : "saved" });
}
