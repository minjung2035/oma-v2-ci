/** TUI-007/008/009: the Config screen's view of host authority.
 *
 * `config.json` stays the host-owned closed schema of CFG-001. This module
 * projects the few fields arch §23.6 exposes, transforms them purely, and
 * writes the result back atomically with a fresh policy revision (CFG-005).
 * It never invents a model, a quota or a profile that the host did not declare.
 */
import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import { join } from "node:path";
import type { EffortLevel, HostConfigV1, ModelProfile } from "../../../implementation/contracts.js";
import { StoreError } from "../../domain/errors.js";
import { EFFORT_LEVELS, loadConfigurationSnapshot, loadEditableConfiguration, validateConfig,
  type ConfigurationSnapshot, type ValidatedConfigCandidate } from "../../config.js";
import { observeExtensionAsset, type ConfigurationLayout } from "../../config/operations.js";
import { DEPLOYMENT_LAYOUT } from "../../domain/deployment.js";
import { projectSettingsPathAt } from "../../storage/paths.js";
import type { DurabilityObserver } from "../../storage/durable-fs.js";
import {
  commitInlineConfiguration, commitManagedGeneration, createInlineConfiguration, managedRolesOf,
  type ManagedLimits, type ManagedCommit, type ManagedEdit, type ManagedRoleSource, type ManagedSource,
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

/** DR24: a model and its effort, chosen from the engine's own lists. */
export interface EngineModelChoice { readonly provider: string; readonly model: string; readonly thinking?: EffortLevel }
/** What a Config field is set to: an option, a number, or a model from the engine's list. */
export type FieldValue = string | number | EngineModelChoice;
/** The model profile a Worker's own choice from the engine's list is kept in. */
export const WORKER_MODEL_PROFILE = "worker";

/** A model profile that leaves the model to the engine: its default, as its own settings name it. */
export function followsEngine(profile: ModelProfile | undefined): boolean {
  return profile?.provider === "pi" && profile.model === "current";
}

/** A name the engine's screen reported, or null when it is not one. */
export function engineName(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= CONFIG_BOUNDS.engineNameChars.value ? value : null;
}

/** An engine choice as the engine's screen reported it, or null when it is not one. */
export function engineModelChoiceOf(value: Readonly<Record<string, unknown>>): EngineModelChoice | null {
  const provider = engineName(value.provider), model = engineName(value.model);
  if (provider === null || model === null) return null;
  if (value.thinking !== undefined && !(EFFORT_LEVELS as readonly unknown[]).includes(value.thinking)) return null;
  return Object.freeze({ provider, model, ...(value.thinking === undefined ? {} : { thinking: value.thinking as EffortLevel }) });
}

/** DR24: what a Worker runs, as the Worker model row says it. */
export function workerModelText(config: HostConfigV1, workerProfile: string | null): string {
  const name = workerProfile === null ? undefined : config.agentProfiles[workerProfile]?.modelProfile;
  const profile = name === undefined ? undefined : config.modelProfiles[name];
  if (profile === undefined) return "unknown";
  if (name === config.agentProfiles[config.principalProfile]?.modelProfile) return "Same as the Principal";
  if (followsEngine(profile)) return "The engine's default";
  return `${profile.provider}/${profile.model}${profile.thinking === undefined ? "" : ` · ${profile.thinking}`}`;
}

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
  /** What an edit is committed against: the snapshot it was read as, or (WP14.03)
   * the editing input of a bundle a declared extension file is missing from. */
  readonly snapshot: ManagedSource | null;
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
  workerProfileOf(config) === null ? "No worker profile: configure a non-Principal agent profile first" : null;
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
  snapshot: ManagedSource | null = null,
 ): Settings {
  const workerProfile = workerProfileOf(config);
  return Object.freeze({ path, snapshot, layout, config, workerProfile, fields: fieldsOf(config, workerProfile) });
}

/** DR24: a project's OMA settings -- its model and agent profiles, workers,
 * integration, limits -- held once, beside the societies of its sessions and
 * in none of them. Every session's society configuration is made from it, so
 * a setting saved in one session holds in the next and in the others. */
export function projectSettingsPath(dataRoot: string, project: string): string {
  return projectSettingsPathAt(dataRoot, project);
}

/** What a session's society has of its own: its name and the installation
 * and rootfs it runs with, and (DR25) where the Human's installed packages
 * are. The rest is the project's. */
export interface SessionOwn {
  readonly society: string; readonly node: string; readonly libdir: string;
  readonly rootfs: string; readonly deploymentDigest: string; readonly packages?: string | undefined;
}

export function sessionConfigOf(project: HostConfigV1, own: SessionOwn): HostConfigV1 {
  return { ...project, society: own.society,
    installation: { node: own.node, libdir: own.libdir, rootfs: own.rootfs, deploymentDigest: own.deploymentDigest,
      ...(own.packages === undefined ? {} : { packages: own.packages }) } };
}

/** DR25: the roles a configuration runs as, whole -- a bundle's authored
 * roles, or an inline configuration's: the core extension and no prompt,
 * which is how an engine runs a role an inline configuration names. */
export function roleSetOf(source: ManagedSource): Record<string, ManagedRoleSource> {
  const set: Record<string, ManagedRoleSource> = Object.create(null);
  for (const name of Object.keys(source.config.agentProfiles)) {
    const role = source.authoredRoles[name]?.value;
    set[name] = role === undefined
      ? Object.freeze({ extensions: Object.freeze([DEPLOYMENT_LAYOUT.extension]), prompt: Buffer.alloc(0) })
      : Object.freeze({ extensions: Object.freeze([...role.extensions as string[]]),
        prompt: Buffer.from(source.roles[name]?.prompt ?? "", "utf8") });
  }
  return set;
}

/** DR25: commits a whole role set with the candidate -- how an inline
 * configuration becomes a managed bundle, and how a session's configuration
 * takes on its project's roles. The same writer, the same proof by the
 * loader, the same refusal of a source changed since it was read. */
export function commitRoleSet(snapshot: ManagedSource, config: HostConfigV1,
  roleSet: Readonly<Record<string, ManagedRoleSource>>, faults?: DurabilityObserver): ManagedCommit {
  const after = roleRevisionInput(managedRolesOf(snapshot, {}, config, roleSet));
  if (snapshot.layout.kind === "operations" &&
      sameMeaning(config, after, snapshot.config, roleRevisionInput(managedRolesOf(snapshot, {}, snapshot.config))))
    return Object.freeze({ kind: "unchanged", generation: null });
  return commitManagedGeneration(snapshot, { config: revised(config, after), roleSet }, faults);
}

/** A configuration as last committed: runnable, or -- when only a declared
 * extension file is gone -- the editing input its repair is made from. */
export function readSettingsForEditing(path: string): Settings {
  try { return readSettings(path); }
  catch (error) {
    let editable: ReturnType<typeof loadEditableConfiguration>;
    try { editable = loadEditableConfiguration(path); } catch { throw error; }
    return settingsOf(path, editable.config, editable.layout, editable);
  }
}

/** DR25: a project's settings are a managed bundle, so each role's
 * extensions can be chosen; an inline one becomes one, running as it did. */
export function projectBundle(path: string): Settings {
  const settings = readSettingsForEditing(path);
  if (settings.layout.kind === "operations") return settings;
  commitRoleSet(settings.snapshot!, settings.config, roleSetOf(settings.snapshot!));
  return readSettingsForEditing(path);
}

/** DR24/DR25: a session's configuration is its project's -- host settings,
 * models and roles, their extensions, prompts and tool surfaces -- with the
 * session's own name, rootfs and installation. An extension the project
 * names whose file is gone is left out of the session, never loaded in its
 * place, and reported; the project keeps it until the Human turns it off. */
export function deriveSessionSettings(project: Settings, path: string, own: SessionOwn): { readonly settings: Settings; readonly missing: readonly string[] } {
  if (project.snapshot === null) throw new StoreError("UNSUPPORTED_PROFILE", "a session is made only from the project's committed settings");
  const config = sessionConfigOf(project.config, own);
  const roots = { libdir: config.installation.libdir, packages: config.installation.packages };
  const missing = new Set<string>();
  const roleSet: Record<string, ManagedRoleSource> = Object.create(null);
  for (const [name, role] of Object.entries(roleSetOf(project.snapshot))) {
    const present = role.extensions.filter(entry => {
      if (observeExtensionAsset(roots, entry).kind !== "missing") return true;
      missing.add(entry); return false;
    });
    roleSet[name] = Object.freeze({ ...role, extensions: Object.freeze(present) });
  }
  if (lstatSync(path, { throwIfNoEntry: false }) === undefined) writeSettings(path, config);
  const session = readSettingsForEditing(path);
  commitRoleSet(session.snapshot!, config, roleSet);
  return Object.freeze({ settings: readSettings(path), missing: Object.freeze([...missing].sort()) });
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
export function applyField(settings: Settings, field: string, value: FieldValue): HostConfigV1 {
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
function commitInlineEdit(snapshot: Pick<ConfigurationSnapshot, "config" | "layout" | "sourceFiles">, config: HostConfigV1, faults?: DurabilityObserver): ManagedCommit {
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
    return [name, { extensions: role.extensions,
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
  readonly transform: (settings: Settings, value: FieldValue) => HostConfigV1;
}

/** D05: seeds are read by the first bootstrap only. */
const seedsBlocked = (_config: HostConfigV1, bootstrap: BootstrapState): string | null =>
  bootstrap === "done" ? "Society already bootstrapped: does not apply to existing workers" : null;

const DESCRIPTOR_SOURCE = {
  [PRINCIPAL_MODEL]: Object.freeze({
    label: "Principal model",
    apply: "next-session",
    view: (config: HostConfigV1) => ({
      kind: "choice" as const,
      value: config.agentProfiles[config.principalProfile]?.modelProfile ?? "",
      options: Object.keys(config.modelProfiles).sort(),
    }),
    transform: (settings: Settings, value: FieldValue) => {
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
    transform: (settings: Settings, value: FieldValue) => {
      const config = settings.config;
      const name = workerTarget(settings);
      const profile = config.agentProfiles[name];
      assertKnown(profile !== undefined, "worker profile is missing from host config");
      if (typeof value === "object") {
        // DR24: a model from the engine's list is kept in the Worker's own
        // model profile, with the limits the Worker ran with; a profile of that
        // name another agent runs is not taken over.
        const shared = Object.entries(config.agentProfiles)
          .some(([other, agent]) => other !== name && agent.modelProfile === WORKER_MODEL_PROFILE);
        assertKnown(!shared, `model profile ${WORKER_MODEL_PROFILE} is another agent's`);
        const { thinking: _previous, ...base } = config.modelProfiles[profile!.modelProfile]!;
        return { ...config,
          modelProfiles: { ...config.modelProfiles, [WORKER_MODEL_PROFILE]: { ...base, provider: value.provider, model: value.model,
            ...(value.thinking === undefined ? {} : { thinking: value.thinking }) } },
          agentProfiles: { ...config.agentProfiles, [name]: { ...profile!, modelProfile: WORKER_MODEL_PROFILE } } };
      }
      assertKnown(typeof value === "string" && Object.hasOwn(config.modelProfiles, value), "unknown model profile");
      return { ...config, agentProfiles: { ...config.agentProfiles,
        [name]: { ...profile!, modelProfile: value as string } } };
    },
  }),
  [WORKER_LIMIT]: Object.freeze({
    label: "Max created workers",
    apply: "restart",
    view: (config: HostConfigV1) => ({
      kind: "number" as const, value: config.quota.societyAgents, min: 0, max: Number.MAX_SAFE_INTEGER,
    }),
    transform: (settings: Settings, value: FieldValue) => {
      assertKnown(typeof value === "number" && Number.isSafeInteger(value) && value >= 0, "worker limit must be a non-negative integer");
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
    transform: (settings: Settings, value: FieldValue) => {
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
      ? "No bootstrap workers: increase Initial workers first" : seedsBlocked(config, bootstrap),
    view: (config: HostConfigV1, workerProfile: string | null) => ({
      kind: "choice" as const, value: workerProfile ?? "", options: residentProfiles(config),
    }),
    transform: (settings: Settings, value: FieldValue) => {
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
    transform: (settings: Settings, value: FieldValue) => {
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
export function commitField(settings: Settings, field: string, value: FieldValue, bootstrap: BootstrapState = "unknown"): FieldCommit {
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
