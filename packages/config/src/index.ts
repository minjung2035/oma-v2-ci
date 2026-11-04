import { checkPipelineCheck, frozenPipeline } from "@oma/domain/check-pipeline";
import { EFFORT_LEVELS } from "@oma/domain/settings";
import { tieredPolicyCheck, integrationCheckEnvironment } from "@oma/domain/integration-policy";
import type { IntegrationCheckSnapshot } from "@oma/contracts/integration";
import { policyRevisionCheck } from "@oma/domain/mail-values";
// MUST [CFG-001/002/005]: closed host configuration, no unlimited defaults.
import {
  readConfigurationSource,
  readEditableConfigurationSource,
  type AuthoredRoleSource,
  type ConfigurationFileIdentity,
  type ConfigurationLayout,
  type ConfigurationReadObserver,
  type RoleSettings,
} from "./operations.js";
import type { AgentProfile, EffortLevel, HostConfig, ModelProfile } from "@oma/contracts";
import { DEFAULT_MAX_WORKERS, FIRST_WORKER_RECOVERY_PREFIX, HOST_CONFIGURATION_VERSION } from "@oma/domain/config-format";
import { StoreError } from "@oma/domain/errors";
import { ACTOR_NAME_RE, isValidActorName, isValidRequestKey, isValidSocietyName, isValidWirePath } from "@oma/domain/identifiers";
import { isCapability } from "@oma/domain/capabilities";
import { LEGACY_CREATE_BRIEF_BYTES, MIN_MIXED_BATCH_MESSAGES, PROTOCOL_LIMIT_FIELDS } from "@oma/domain/limits";
import { mailBodyBytesFits, minimumMailBodyBytes } from "@oma/domain/review-bounds";
import type { IntegerField } from "@oma/domain/integer-fields";
import { isDeploymentDigest } from "@oma/domain/deployment";
import { MIN_BATCH_VIEW_FRAME_BYTES } from "@oma/protocol/batch-view";
import { isLogResponseFrameLimit } from "@oma/protocol/log-response";
import { isAbsolute, normalize } from "node:path";
import { assertManagedJournalFormat } from "./state-format.js";

function err(message: string): never { throw new StoreError("INVALID_REQUEST", `config: ${message}`); }
function needString(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0) err(`${what} must be a non-empty string`);
  return value;
}
function needInt(value: unknown, what: string, minInclusive: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minInclusive) err(`${what} must be a safe integer >= ${minInclusive}`);
  return value;
}
function needRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) err(`${what} must be an object`);
  return value as Record<string, unknown>;
}
function needArray(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) err(`${what} must be an array`);
  return value;
}
/** A closed record: `keys` are required, `optional` may be absent, nothing else is allowed. */
function closedKeys(record: Record<string, unknown>, keys: readonly string[], what: string, optional: readonly string[] = []): void {
  for (const key of Object.keys(record))
    if (!keys.includes(key) && !optional.includes(key)) err(what === "root" ? `unknown top-level field ${key}` : `${what}.${key} unknown`);
  for (const key of keys) if (!Object.hasOwn(record, key)) err(`${what}.${key} is required`);
}
function closedRecord(value: unknown, keys: readonly string[], what: string, optional: readonly string[] = []): Record<string, unknown> {
  const record = needRecord(value, what); closedKeys(record, keys, what, optional); return record;
}
function needIntegerFields(record: Record<string, unknown>, fields: Readonly<Record<string, IntegerField>>, what: string): void {
  closedKeys(record, Object.keys(fields), what);
  for (const key of Object.keys(fields)) {
    const field = fields[key]!;
    needInt(record[key], `${what}.${key}`, field.minInclusive);
    if (field.maxInclusive !== undefined && (record[key] as number) > field.maxInclusive)
      err(`${what}.${key} must be <= ${field.maxInclusive}`);
  }
}
declare const VALIDATED_CONFIG: unique symbol;
/** A complete deep snapshot produced only by the canonical runtime validator. */
export type ValidatedConfigCandidate = HostConfig & { readonly [VALIDATED_CONFIG]: true };

function validatedSnapshot(config: HostConfig): ValidatedConfigCandidate {
  const modelProfiles: Record<string, ModelProfile> = Object.create(null);
  for (const [name, profile] of Object.entries(config.modelProfiles))
    modelProfiles[name] = Object.freeze({ ...profile });
  const agentProfiles: Record<string, AgentProfile> = Object.create(null);
  for (const [name, profile] of Object.entries(config.agentProfiles))
    agentProfiles[name] = Object.freeze({
      ...profile,
      capabilities: Object.freeze([...profile.capabilities]),
      delegable: Object.freeze([...profile.delegable]),
    }) as AgentProfile;
  const checks = config.integration.checks.map(check => {
    const env = Object.assign(Object.create(null), check.env) as Record<string, string>;
    return Object.freeze({
      ...check,
      argv: Object.freeze([...check.argv]),
      env: Object.freeze(env),
    });
  });
  const snapshot = {
    ...config,
    ...(config.storage === undefined ? {} : { storage: Object.freeze({ ...config.storage }) }),
    ...(config.resources === undefined ? {} : { resources: Object.freeze({ ...config.resources }) }),
    installation: Object.freeze({ ...config.installation }),
    modelProfiles: Object.freeze(modelProfiles),
    agentProfiles: Object.freeze(agentProfiles),
    ...(config.firstWorkerRecovery === undefined ? {} : { firstWorkerRecovery: Object.freeze({ ...config.firstWorkerRecovery }) }),
    initialResidents: Object.freeze(config.initialResidents.map(row => Object.freeze({ ...row }))),
    integration: Object.freeze({
      ...config.integration,
      ...(config.integration.pipeline === undefined ? {} : { pipeline: frozenPipeline(config.integration.pipeline) }),
      ...(config.integration.tiered === undefined ? {} : { tiered: Object.freeze({ ...config.integration.tiered,
        rules: Object.freeze(config.integration.tiered.rules.map(rule => Object.freeze({ ...rule,
          statuses: Object.freeze([...rule.statuses]) }))) }) }),
      protectedPaths: Object.freeze([...config.integration.protectedPaths]),
      checks: Object.freeze(checks),
    }),
    limits: Object.freeze({ ...config.limits }),
  };
  // The brand is type-only; validation, copying and recursive freezing above are
  // the runtime proof. No caller can construct this type without this boundary.
  return Object.freeze(snapshot) as unknown as ValidatedConfigCandidate;
}


export interface ConfigurationSnapshot {
  readonly config: ValidatedConfigCandidate;
  readonly roles: Readonly<Record<string, RoleSettings>>;
  readonly layout: ConfigurationLayout;
  readonly authoredRoles: Readonly<Record<string, AuthoredRoleSource>>;
  readonly sourceFiles: readonly ConfigurationFileIdentity[];
}

/** Resolve and read one complete authored source closure from one manifest read. */
export function loadConfigurationSnapshot(path: string, observer?: ConfigurationReadObserver): ConfigurationSnapshot {
  const source = readConfigurationSource(path, observer);
  const config = validateConfig(source.host);
  if (source.layout.kind === "operations") assertManagedJournalFormat(source.layout.index);
  return Object.freeze({
    config,
    roles: source.roles,
    layout: source.layout,
    authoredRoles: source.authoredRoles,
    sourceFiles: source.files,
  });
}

/** WP14.03: an editing input for a bundle whose declared extension assets may
 * be missing. The host configuration is validated whole; extension assets are
 * not dereferenced, so this is never a runnable configuration. */
export interface EditableConfiguration {
  readonly config: ValidatedConfigCandidate;
  readonly roles: Readonly<Record<string, { readonly prompt: string }>>;
  readonly layout: ConfigurationLayout;
  readonly authoredRoles: Readonly<Record<string, AuthoredRoleSource>>;
  readonly sourceFiles: readonly ConfigurationFileIdentity[];
  readonly extensionAssets: "unread";
}
export function loadEditableConfiguration(path: string): EditableConfiguration {
  const source = readEditableConfigurationSource(path);
  const config = validateConfig(source.host);
  if (source.layout.kind === "operations") assertManagedJournalFormat(source.layout.index);
  return Object.freeze({
    config,
    roles: Object.freeze(Object.fromEntries(Object.entries(source.roles).map(([name, role]) => [name, Object.freeze({ prompt: role.prompt })]))),
    layout: source.layout,
    authoredRoles: source.authoredRoles,
    sourceFiles: source.files,
    extensionAssets: "unread" as const,
  });
}

/** Runnable configuration and role settings from the canonical snapshot loader. */
export function loadConfiguration(path: string) {
  const snapshot = loadConfigurationSnapshot(path);
  return Object.freeze({ config: snapshot.config, roles: snapshot.roles });
}
export function loadConfig(path: string): HostConfig { return loadConfiguration(path).config; }
/** DR13, P0-5: the host policy a running broker decides by now -- for an
 * integration's revision and facts, and for a child's spec. One reader, one
 * answer for "cannot be obtained": the file unreadable, or read mid-edit and
 * invalid, is BROKER_UNAVAILABLE, not a changed policy; the work waits (a
 * refusal to retry under the same key, or an accepted operation left for
 * recovery). A readable policy of another society is a changed one. */
export function readCurrentHostPolicy(path: string, society: string, load: (path: string) => HostConfig = loadConfig): HostConfig {
  let current: HostConfig;
  try { current = load(path); }
  catch (error) { throw new StoreError("BROKER_UNAVAILABLE", "the host policy cannot be read now", { cause: error }); }
  if (current.society !== society) throw new StoreError("POLICY_CHANGED", "host policy society identity changed");
  return current;
}

export function validateConfig(raw: unknown): ValidatedConfigCandidate {
  const cfg = needRecord(raw, "root");
  if (cfg.schemaVersion !== 4 && cfg.schemaVersion !== HOST_CONFIGURATION_VERSION)
    err(`unsupported development configuration schema; expected ${HOST_CONFIGURATION_VERSION}. Use a new development state directory`);
  closedKeys(cfg, ["schemaVersion", "society", "installation", "modelProfiles", "agentProfiles", "principalProfile", "initialResidents", "integration", "limits"], "root", ["maxWorkers", "firstWorkerRecovery", "resources", "storage", "collaborationFreshMutations"]);
  const maxWorkers = cfg.maxWorkers === undefined ? DEFAULT_MAX_WORKERS : needInt(cfg.maxWorkers, "maxWorkers", 1);
  const society = needString(cfg.society, "society");
  if (!isValidSocietyName(society)) err("invalid society name");
  const installation = closedRecord(cfg.installation, ["node", "libdir", "deploymentDigest"], "installation", ["packages"]);
  const node = needString(installation.node, "installation.node");
  const libdir = needString(installation.libdir, "installation.libdir");
  // CFG-001: the installation root this configuration names is judged by the
  // same rule its consumers judge it by (runtime/assets.ts `runtimeAssets`,
  // native/directory-layout): an inline config.json has no other judge, and one
  // this validator accepts must not become a project settings file, or a
  // generation, that those consumers refuse. The installation's own spelling
  // `${libdir}/` is a normalized absolute path and stays accepted.
  if (!isAbsolute(libdir) || libdir === "/" || libdir.includes("\0") || normalize(libdir) !== libdir)
    err("installation.libdir must be a normalized absolute directory");
  const deploymentDigest = needString(installation.deploymentDigest, "installation.deploymentDigest");
  if (!isDeploymentDigest(deploymentDigest)) err("installation.deploymentDigest must be a lowercase SHA-256 digest");
  // DR25: where the extensions `oma pi install` installed live, when any role may name one.
  const packages = installation.packages === undefined ? undefined : needString(installation.packages, "installation.packages");
  if (packages !== undefined && (!isAbsolute(packages) || normalize(packages) !== packages || packages === "/"))
    err("installation.packages must be a normalized absolute directory");

  const modelProfiles = needRecord(cfg.modelProfiles, "modelProfiles");
  for (const [name, value] of Object.entries(modelProfiles)) {
    const profile = closedRecord(value, ["provider", "model", "inferenceTimeoutSeconds"], `modelProfiles.${name}`, ["thinking"]);
    if (profile.thinking !== undefined && !(EFFORT_LEVELS as readonly unknown[]).includes(profile.thinking))
      err(`modelProfiles.${name}.thinking must be one of ${EFFORT_LEVELS.join(", ")}`);
    for (const key of ["provider", "model"]) needString(profile[key], `modelProfiles.${name}.${key}`);
    needInt(profile.inferenceTimeoutSeconds, `modelProfiles.${name}.inferenceTimeoutSeconds`, 1);
  }
  const agentProfiles = needRecord(cfg.agentProfiles, "agentProfiles");
  const profileNames = new Set(Object.keys(agentProfiles));
  for (const [name, value] of Object.entries(agentProfiles)) {
    if (!ACTOR_NAME_RE.test(name)) err("invalid role profile name");
    const profile = closedRecord(value, ["modelProfile", "capabilities", "delegable", "childProfile"], `agentProfiles.${name}`);
    const modelProfile = needString(profile.modelProfile, `agentProfiles.${name}.modelProfile`);
    if (!Object.hasOwn(modelProfiles, modelProfile)) err(`agentProfiles.${name}.modelProfile unknown`);
    if (!Array.isArray(profile.capabilities) || !Array.isArray(profile.delegable)) err(`agentProfiles.${name} capabilities/delegable arrays required`);
    if (!profile.capabilities.every(isCapability) || !profile.delegable.every(isCapability)) err(`agentProfiles.${name} contains unknown capability`);
    if (profile.childProfile !== null && typeof profile.childProfile !== "string") err(`agentProfiles.${name}.childProfile must be a string or null`);
    if (typeof profile.childProfile === "string" && !profileNames.has(profile.childProfile)) err(`agentProfiles.${name}.childProfile unknown`);
  }
  const principalProfile = needString(cfg.principalProfile, "principalProfile");
  if (!profileNames.has(principalProfile)) err("principalProfile unknown");
  if (Object.hasOwn(cfg, "collaborationFreshMutations") &&
      (cfg.schemaVersion !== 5 || cfg.collaborationFreshMutations !== "closed"))
    err("collaborationFreshMutations requires configuration 5 and the explicit value closed; omit it to retain normal admission checks");
  let storage: HostConfig["storage"];
  if (cfg.storage !== undefined) {
    if (cfg.schemaVersion !== 5) err("storage requires configuration version 5");
    const value = closedRecord(cfg.storage, ["closeMode"], "storage");
    if (value.closeMode !== "keep-hot" && value.closeMode !== "on-close") err("storage.closeMode must be keep-hot or on-close");
    storage = { closeMode: value.closeMode as "keep-hot" | "on-close" };
  }
  let resources: HostConfig["resources"];
  if (cfg.resources !== undefined) {
    if (cfg.schemaVersion !== 5) err("resource profiles require configuration version 5");
    const resource = closedRecord(cfg.resources, ["version"], "resources", ["cpuCores", "memoryMaxBytes", "swapMaxBytes", "tasksMax", "checkWallTimeMs", "tmpfsMaxBytes", "maxConcurrentCheckPipelines"]);
    if (resource.version !== 1) err("unsupported resource profile version");
    for (const [key, value] of Object.entries(resource)) {
      if (key === "version") continue;
      if (key === "cpuCores") { if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) err("resources.cpuCores must be positive"); }
      else needInt(value, `resources.${key}`, key === "swapMaxBytes" ? 0 : 1);
    }
    resources = resource as unknown as HostConfig["resources"];
  }
  const initialResidents = needArray(cfg.initialResidents, "initialResidents");
  if (cfg.schemaVersion === 5 && initialResidents.length < 1) err("new Society settings require at least one initial Worker");
  let firstWorkerRecovery: HostConfig["firstWorkerRecovery"];
  if (cfg.firstWorkerRecovery !== undefined) {
    if (cfg.schemaVersion !== 5) err("first Worker recovery requires configuration version 5");
    const recovery = closedRecord(cfg.firstWorkerRecovery, ["version", "key", "name", "profile", "brief"], "firstWorkerRecovery");
    if (recovery.version !== 1) err("unsupported first Worker recovery version");
    const key = needString(recovery.key, "firstWorkerRecovery.key");
    if (!/^[a-zA-Z0-9_-]+$/.test(key) || !isValidRequestKey(`${FIRST_WORKER_RECOVERY_PREFIX}${key}`)) err("invalid first Worker recovery key");
    const name = needString(recovery.name, "firstWorkerRecovery.name");
    if (!isValidActorName(name)) err("invalid first Worker recovery name");
    const profile = needString(recovery.profile, "firstWorkerRecovery.profile");
    if (!profileNames.has(profile) || profile === principalProfile) err("first Worker recovery requires a Worker profile");
    const brief = needString(recovery.brief, "firstWorkerRecovery.brief");
    if (Buffer.byteLength(brief, "utf8") > LEGACY_CREATE_BRIEF_BYTES) err("firstWorkerRecovery.brief exceeds the creation payload bound");
    firstWorkerRecovery = { version: 1, key, name, profile, brief };
  }
  if (initialResidents.length > maxWorkers) err("initialResidents exceeds maxWorkers");
  const residentNames = new Set<string>();
  for (const value of initialResidents) {
    const row = closedRecord(value, ["name", "profile", "brief"], "initialResidents entry");
    const name = needString(row.name, "initialResidents.name");
    if (!isValidActorName(name)) err("initialResidents.name invalid");
    if (residentNames.has(name)) err("initialResidents.name duplicate");
    residentNames.add(name);
    const profile = needString(row.profile, "initialResidents.profile");
    if (!profileNames.has(profile)) err("initialResidents.profile unknown");
    const brief = needString(row.brief, "initialResidents.brief");
    if (Buffer.byteLength(brief, "utf8") > LEGACY_CREATE_BRIEF_BYTES) err("initialResidents.brief exceeds the creation payload bound");
  }
  const integration = closedRecord(cfg.integration, ["policyRevision", "protectedPaths", "checks"], "integration", ["tiered", "pipeline"]);
  if (integration.tiered !== undefined && tieredPolicyCheck(integration.tiered) !== null) err("integration.tiered has invalid rules or authority");
  const policyRevision = needString(integration.policyRevision, "integration.policyRevision");
  if (policyRevisionCheck(policyRevision) !== null) err("integration.policyRevision must be 1..128 UTF-8 bytes without control characters");
  const protectedPaths = needArray(integration.protectedPaths, "integration.protectedPaths");
  if (protectedPaths.some(value => typeof value !== "string" || (value !== "/" && !isValidWirePath(value.endsWith("/") ? value.slice(0, -1) : value)) || /[*?[\]{}!]/.test(value))) err("integration.protectedPaths must be safe literal paths");
  const checks = needArray(integration.checks, "integration.checks");
  if (integration.pipeline !== undefined && (cfg.schemaVersion !== 5 || checkPipelineCheck(integration.pipeline) !== null || checks.length !== 0)) err("a version 2 pipeline requires configuration 5 and replaces the legacy checks array (which must be empty)");
  const checkIds = new Set<string>();
  for (const [index, value] of checks.entries()) {
    const row = closedRecord(value, ["id", "argv", "env"], `integration.checks[${index}]`);
    const id = needString(row.id, `integration.checks[${index}].id`);
    if (checkIds.has(id)) err(`integration.checks[${index}].id duplicate`);
    checkIds.add(id);
    // The executor's canonical validator runs before any configuration is committed.
    try { integrationCheckEnvironment(row as unknown as IntegrationCheckSnapshot, "/", "/"); }
    catch { err(`integration.checks[${index}] contains an unsupported command or environment`); }
  }
  const limits = needRecord(cfg.limits, "limits");
  needIntegerFields(limits, PROTOCOL_LIMIT_FIELDS, "limits");
  if (!isLogResponseFrameLimit(limits.frameBytes)) err("limits.frameBytes must support a complete log response and uint32 framing");
  // R28/AUD-08: the same boundary for the other framed response. A prepared
  // batch view (identity, a manifest id and the notice remainder the producer
  // always emits) must fit the configured frame, or delivery dead-ends on
  // accepted mail; the floor is the codec's own measured constant
  // (protocol/batch-view.ts), not a duplicated number. Paging and elision
  // cover longer manifests and notices; this is only the codec's floor.
  if ((limits.frameBytes as number) < MIN_BATCH_VIEW_FRAME_BYTES)
    err(`limits.frameBytes must carry one prepared batch view (identity, one manifest id and the bounded notice); minimum ${MIN_BATCH_VIEW_FRAME_BYTES} bytes`);
  // AV-07: bounds the grammar accepts but the runtime cannot serve are refused
  // at commit, not discovered later as INTERNAL_ERROR on accepted work. The
  // floors are measured by the same constants the emission paths use
  // (mail/review-bounds.ts, domain/limits.ts via mail/batch-policy.ts), so
  // they track the runtime rather than duplicating it.
  // Bound all possible peer bundles under this capacity. Model at least one
  // vote conservatively so zero-peer fallback mail also fits.
  const normalPeerFloor = (integration.tiered as { highPeerFloor?: number } | undefined)?.highPeerFloor ?? 1;
  const approvalVotes = Math.max(1, Math.min(normalPeerFloor, maxWorkers - 1));
  if (!mailBodyBytesFits(limits.mailBodyBytes as number, limits.subjectBytes as number, approvalVotes)) {
    const minimum = minimumMailBodyBytes(limits.subjectBytes as number, approvalVotes);
    if (minimum === null)
      err(`limits.subjectBytes and integration.tiered.highPeerFloor are too large for any safe integer limits.mailBodyBytes; ` +
        `an approval request carries the requester's reason plus a bound vote body per required vote`);
    err(`limits.mailBodyBytes=${limits.mailBodyBytes} cannot hold the configured review thread, completion-notice part, or approval request; ` +
      `try ${minimum} bytes for limits.subjectBytes=${limits.subjectBytes} and the ${approvalVotes} approval votes required by integration.tiered.highPeerFloor and maxWorkers`);
  }
  if ((limits.batchMaxMessages as number) < MIN_MIXED_BATCH_MESSAGES)
    err(`limits.batchMaxMessages must be at least ${MIN_MIXED_BATCH_MESSAGES}; a single-message batch starves an actor whose direct and public mail are both pending`);
  return validatedSnapshot({
    schemaVersion: cfg.schemaVersion as 4 | 5, society, ...(cfg.collaborationFreshMutations === undefined ? {} : { collaborationFreshMutations: "closed" as const }), ...(storage === undefined ? {} : { storage }), ...(resources === undefined ? {} : { resources }), ...(firstWorkerRecovery === undefined ? {} : { firstWorkerRecovery }), installation: { node, libdir, deploymentDigest, ...(packages === undefined ? {} : { packages }) },
    modelProfiles: Object.assign(Object.create(null), modelProfiles) as HostConfig["modelProfiles"],
    agentProfiles: Object.assign(Object.create(null), agentProfiles) as HostConfig["agentProfiles"],
    principalProfile, maxWorkers, initialResidents: initialResidents as HostConfig["initialResidents"],
    integration: { policyRevision, ...(integration.pipeline === undefined ? {} : { pipeline: integration.pipeline as NonNullable<HostConfig["integration"]["pipeline"]> }), ...(integration.tiered === undefined ? {} : { tiered: integration.tiered as NonNullable<HostConfig["integration"]["tiered"]> }), protectedPaths: protectedPaths as string[], checks: checks as HostConfig["integration"]["checks"] },
    limits: limits as unknown as HostConfig["limits"],
  });
}
