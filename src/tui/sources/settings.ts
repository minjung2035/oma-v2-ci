/** TUI-007/008/009: the Config screen's view of host authority.
 *
 * `config.json` stays the host-owned closed schema of CFG-001. This module
 * projects the few fields arch §23.6 exposes, transforms them purely, and
 * writes the result back atomically with a fresh policy revision (CFG-005).
 * It never invents a model, a quota or a profile that the host did not declare.
 */
import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import type { HostConfigV1 } from "../../../implementation/contracts.js";
import { StoreError } from "../../domain/errors.js";
import { loadConfigurationSnapshot, validateConfig, type ConfigurationSnapshot, type ValidatedConfigCandidate } from "../../config.js";
import type { ConfigurationLayout } from "../../config/operations.js";
import type { DurabilityObserver } from "../../storage/durable-fs.js";
import {
  commitInlineConfiguration, commitManagedGeneration, createInlineConfiguration, managedRolesOf,
  type ManagedLimits, type ManagedCommit, type ManagedEdit, type ManagedSource,
} from "../../config/generations.js";
import type { ApplyScope, ConfigField } from "../model.js";
import { CONFIG_BOUNDS } from "../limits.js";

export const PRINCIPAL_MODEL = "principal-model";
export const WORKER_MODEL = "worker-model";
export const WORKER_LIMIT = "worker-limit";
export const INITIAL_WORKERS = "initial-workers";
export const WORKER_PROFILE = "worker-profile";
export const WORKER_INTEGRATE = "worker-integrate";
export const EDITABLE_FIELDS = Object.freeze([
  PRINCIPAL_MODEL,
  WORKER_MODEL,
  WORKER_LIMIT,
  INITIAL_WORKERS,
  WORKER_PROFILE,
  WORKER_INTEGRATE,
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
  /** The profile a Worker edit changes, or null when there is none of its own. */
  readonly workerProfile: string | null;
  readonly fields: readonly ConfigField[];
}

/** P0V-51, P0-1: the profile a "Worker" field shows and changes, or null. The
 * Principal's own profile is never it: a configuration with a Principal only
 * is valid, and in it a Worker edit has no target -- it is refused, not
 * applied to the Principal the screen does not say it is changing. */
export function workerProfileOf(config: HostConfigV1): string | null {
  const own = (name: string | null | undefined): name is string =>
    typeof name === "string" && name !== config.principalProfile && Object.hasOwn(config.agentProfiles, name);
  const seeded = config.initialResidents[0]?.profile;
  if (own(seeded)) return seeded;
  const child = config.agentProfiles[config.principalProfile]?.childProfile;
  if (own(child)) return child;
  return Object.keys(config.agentProfiles).find(name => own(name)) ?? null;
}

/** Resident profiles exclude the Principal's own profile: the Config screen
 * never offers to run Residents under Principal authority, and with none there
 * is nothing to offer.
 */
export function residentProfiles(config: HostConfigV1): readonly string[] {
  return Object.keys(config.agentProfiles).filter(name => name !== config.principalProfile).sort();
}

/** WP15: a Worker field with no Worker profile to change. */
const noWorkerProfile = (config: HostConfigV1): string | null =>
  workerProfileOf(config) === null ? "Worker profile 없음: Principal 외의 agent profile을 먼저 설정하세요" : null;
/** The Worker profile a transform changes; its absence is refused, never a fallback. */
function workerTarget(settings: Settings): string {
  const name = settings.workerProfile;
  assertKnown(name !== null, "there is no worker profile to change");
  return name!;
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

export function fieldsOf(config: HostConfigV1, workerProfile: string | null, bootstrap: BootstrapState = "unknown"): readonly ConfigField[] {
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

/** DR12, P0-2: whether two configurations mean the same -- the one answer for
 * both layouts. The policy revision is derived from the meaning, so it is left
 * out; in a bundle the roles' prompts, extensions and tool surfaces are part of
 * the meaning (an inline config has none). */
function sameMeaning(left: HostConfigV1, leftRoles: Record<string, unknown>, right: HostConfigV1, rightRoles: Record<string, unknown>): boolean {
  const meaning = (value: HostConfigV1, roles: Record<string, unknown>) =>
    JSON.stringify([{ ...value, integration: { ...value.integration, policyRevision: "" } }, roles]);
  return meaning(left, leftRoles) === meaning(right, rightRoles);
}
function revised(config: HostConfigV1, roles?: Readonly<Record<string, unknown>>): ValidatedConfigCandidate {
  return validateConfig({ ...config, integration: { ...config.integration, policyRevision: revisionFor(config, roles) } });
}

/** DR12, P0-3: an inline `config.json` is committed by the generation owner
 * (config/generations.ts): the expected version is the snapshot the edit was
 * read as, and the loader reproduces the candidate before the commit point. */
function commitInlineEdit(snapshot: ConfigurationSnapshot, config: HostConfigV1, faults?: DurabilityObserver): ManagedCommit {
  if (sameMeaning(config, {}, snapshot.config, {})) return Object.freeze({ kind: "unchanged", generation: null });
  return commitInlineConfiguration(snapshot, revised(config), faults);
}

/** Compatibility facade: arbitrary HostConfigV1 is never handed to the writer.
 * A missing file is created, never overwritten if another start made it first;
 * an existing one is committed against the version read just now. */
export function writeSettings(path: string, config: HostConfigV1): HostConfigV1 {
  const candidate = revised(validateConfig(config));
  if (lstatSync(path, { throwIfNoEntry: false }) === undefined) {
    if (createInlineConfiguration(path, candidate) === "existing") return loadConfigurationSnapshot(path).config;
    return candidate;
  }
  const snapshot = loadConfigurationSnapshot(path);
  if (snapshot.layout.kind === "inline") { commitInlineEdit(snapshot, candidate); return loadConfigurationSnapshot(path).config; }
  commitManagedEdit(snapshot, candidate);
  return loadConfigurationSnapshot(path).config;
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
  if (sameMeaning(config, roleRevisionInput(after), snapshot.config, roleRevisionInput(before)))
    return Object.freeze({ kind: "unchanged", generation: null });
  return commitManagedGeneration(snapshot, { config: revised(config, roleRevisionInput(after)), roles }, faults, limits);
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
  readonly view: (config: HostConfigV1, workerProfile: string | null) => EditableFieldView;
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
    blocked: noWorkerProfile,
    view: (config: HostConfigV1, workerProfile: string | null) => ({
      kind: "choice" as const,
      value: workerProfile === null ? "" : config.agentProfiles[workerProfile]?.modelProfile ?? "",
      options: Object.keys(config.modelProfiles).sort(),
    }),
    transform: (settings: Settings, value: string | number) => {
      const config = settings.config;
      assertKnown(typeof value === "string" && Object.hasOwn(config.modelProfiles, value), "unknown model profile");
      const name = workerTarget(settings);
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
      // A seed needs a Worker profile only when one is added.
      const count = value as number;
      return withSeedCount(settings.config, count, count > settings.config.initialResidents.length ? workerTarget(settings) : "");
    },
  }),
  [WORKER_PROFILE]: Object.freeze({
    label: "Bootstrap worker profile",
    apply: "bootstrap-only",
    // D05: with no seeds there is no target; the selection is not kept anywhere.
    blocked: (config: HostConfigV1, bootstrap: BootstrapState) => config.initialResidents.length === 0
      ? "bootstrap worker 없음: Initial workers를 먼저 늘리세요" : seedsBlocked(config, bootstrap),
    view: (config: HostConfigV1, workerProfile: string | null) => ({
      kind: "choice" as const, value: workerProfile ?? "", options: residentProfiles(config),
    }),
    transform: (settings: Settings, value: string | number) => {
      const config = settings.config;
      assertKnown(config.initialResidents.length > 0, "there are no bootstrap workers to change");
      // The profiles the screen offers are the ones a Resident may run under.
      assertKnown(typeof value === "string" && residentProfiles(config).includes(value), "unknown agent profile");
      // Existing Resident specs are immutable; only not-yet-created bootstrap seeds change.
      return { ...config, initialResidents: config.initialResidents.map(resident => ({ ...resident, profile: value as string })) };
    },
  }),
  // DR4, TUI-019: the role capability the Human decides. `code.integrate` is
  // the host's to give (A-002); an agent created afterwards has it, one that
  // exists keeps its frozen spec (LIFE-008).
  [WORKER_INTEGRATE]: Object.freeze({
    label: "Worker integrate",
    apply: "new-agents",
    blocked: noWorkerProfile,
    view: (config: HostConfigV1, workerProfile: string | null) => ({
      kind: "choice" as const,
      value: workerProfile !== null && config.agentProfiles[workerProfile]?.capabilities.includes("code.integrate") ? "on" : "off",
      options: ["off", "on"],
    }),
    transform: (settings: Settings, value: string | number) => {
      assertKnown(value === "on" || value === "off", "worker integrate is on or off");
      const config = settings.config;
      const name = workerTarget(settings);
      const profile = config.agentProfiles[name];
      assertKnown(profile !== undefined, "worker profile is missing from host config");
      const others = profile!.capabilities.filter(capability => capability !== "code.integrate");
      const capabilities = value === "on" ? [...others, "code.integrate" as const] : others;
      return { ...config, agentProfiles: { ...config.agentProfiles, [name]: { ...profile!, capabilities } } };
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
  // P0-3: every edit is transform -> whole validation -> one commit, against
  // the snapshot it was read as.
  if (settings.snapshot === null)
    throw new StoreError("UNSUPPORTED_PROFILE", "a configuration is edited only from the snapshot it was read as");
  const committed = settings.layout.kind === "inline"
    ? commitInlineEdit(settings.snapshot, applied) : commitManagedEdit(settings.snapshot, applied);
  return Object.freeze({ kind: committed.kind === "unchanged" ? "unchanged" : "saved" });
}
