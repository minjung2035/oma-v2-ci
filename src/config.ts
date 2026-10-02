import { tieredPolicyCheck } from "./domain/integration-policy.js";
// MUST [CFG-001/002/005]: closed host configuration, no unlimited defaults.
import {
  readConfigurationSource,
  readEditableConfigurationSource,
  type AuthoredRoleSource,
  type ConfigurationFileIdentity,
  type ConfigurationLayout,
  type ConfigurationReadObserver,
  type RoleSettings,
} from "./config/operations.js";
import type { AgentProfile, EffortLevel, HostConfigV1, ModelProfile, ResourceLimits } from "../implementation/contracts.js";
import { StoreError } from "./domain/errors.js";
import { isValidActorName, isValidSocietyName, isValidWirePath } from "./domain/identifiers.js";
import { isCapability } from "./domain/capabilities.js";
import { RESOURCE_FIELDS } from "./domain/resources.js";
import { PROTOCOL_LIMIT_FIELDS } from "./domain/limits.js";
import type { IntegerField } from "./domain/integer-fields.js";
import { isDeploymentDigest } from "./domain/deployment.js";
import { isLogResponseFrameLimit } from "./protocol/log-response.js";
import { isAbsolute, normalize } from "node:path";
export { resolveChildSpec } from "./domain/child-policy.js";

/** DR24: the engine's effort levels, in its order. */
export const EFFORT_LEVELS: readonly EffortLevel[] = Object.freeze(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

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
  for (const key of Object.keys(fields)) needInt(record[key], `${what}.${key}`, fields[key]!.minInclusive);
}
declare const VALIDATED_CONFIG: unique symbol;
/** A complete deep snapshot produced only by the canonical runtime validator. */
export type ValidatedConfigCandidate = HostConfigV1 & { readonly [VALIDATED_CONFIG]: true };

function freezeResources(resources: ResourceLimits): ResourceLimits {
  return Object.freeze({ ...resources });
}

function validatedSnapshot(config: HostConfigV1): ValidatedConfigCandidate {
  const modelProfiles: Record<string, ModelProfile> = Object.create(null);
  for (const [name, profile] of Object.entries(config.modelProfiles))
    modelProfiles[name] = Object.freeze({ ...profile });
  const agentProfiles: Record<string, AgentProfile> = Object.create(null);
  for (const [name, profile] of Object.entries(config.agentProfiles))
    agentProfiles[name] = Object.freeze({
      ...profile,
      capabilities: Object.freeze([...profile.capabilities]),
      delegable: Object.freeze([...profile.delegable]),
      resources: freezeResources(profile.resources),
    }) as AgentProfile;
  const checks = config.integration.checks.map(check => {
    const env = Object.assign(Object.create(null), check.env) as Record<string, string>;
    return Object.freeze({
      ...check,
      argv: Object.freeze([...check.argv]),
      env: Object.freeze(env),
      resources: freezeResources(check.resources),
    });
  });
  const snapshot = {
    ...config,
    installation: Object.freeze({ ...config.installation }),
    modelProfiles: Object.freeze(modelProfiles),
    agentProfiles: Object.freeze(agentProfiles),
    initialResidents: Object.freeze(config.initialResidents.map(row => Object.freeze({ ...row }))),
    quota: Object.freeze({ ...config.quota }),
    integration: Object.freeze({
      ...config.integration,
      ...(config.integration.tiered === undefined ? {} : { tiered: Object.freeze({ ...config.integration.tiered,
        rules: Object.freeze(config.integration.tiered.rules.map(rule => Object.freeze({ ...rule,
          statuses: Object.freeze([...rule.statuses]) }))) }) }),
      protectedPaths: Object.freeze([...config.integration.protectedPaths]),
      checks: Object.freeze(checks),
    }),
    limits: Object.freeze({ ...config.limits }),
    features: Object.freeze({ ...config.features }),
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
  return Object.freeze({
    config: validateConfig(source.host),
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
  return Object.freeze({
    config: validateConfig(source.host),
    roles: Object.freeze(Object.fromEntries(Object.entries(source.roles).map(([name, role]) => [name, Object.freeze({ prompt: role.prompt })]))),
    layout: source.layout,
    authoredRoles: source.authoredRoles,
    sourceFiles: source.files,
    extensionAssets: "unread" as const,
  });
}

/** Compatibility facade for callers that do not need authored source identities. */
export function loadConfiguration(path: string) {
  const snapshot = loadConfigurationSnapshot(path);
  return Object.freeze({ config: snapshot.config, roles: snapshot.roles });
}
export function loadConfig(path: string): HostConfigV1 { return loadConfiguration(path).config; }
/** DR13, P0-5: the host policy a running broker decides by now -- for an
 * integration's revision and facts, and for a child's spec. One reader, one
 * answer for "cannot be obtained": the file unreadable, or read mid-edit and
 * invalid, is BROKER_UNAVAILABLE, not a changed policy; the work waits (a
 * refusal to retry under the same key, or an accepted operation left for
 * recovery). A readable policy of another society is a changed one. */
export function readCurrentHostPolicy(path: string, society: string, load: (path: string) => HostConfigV1 = loadConfig): HostConfigV1 {
  let current: HostConfigV1;
  try { current = load(path); }
  catch (error) { throw new StoreError("BROKER_UNAVAILABLE", "the host policy cannot be read now", { cause: error }); }
  if (current.society !== society) throw new StoreError("POLICY_CHANGED", "host policy society identity changed");
  return current;
}

export function validateConfig(raw: unknown): ValidatedConfigCandidate {
  const cfg = closedRecord(raw, ["schemaVersion", "society", "installation", "modelProfiles", "agentProfiles", "principalProfile", "initialResidents", "quota", "integration", "limits", "features"], "root");
  if (cfg.schemaVersion !== 1) err("schemaVersion must be 1");
  const society = needString(cfg.society, "society");
  if (!isValidSocietyName(society)) err("invalid society name");
  const installation = closedRecord(cfg.installation, ["node", "libdir", "rootfs", "deploymentDigest"], "installation", ["packages"]);
  const node = needString(installation.node, "installation.node");
  const libdir = needString(installation.libdir, "installation.libdir");
  const rootfs = needString(installation.rootfs, "installation.rootfs");
  const deploymentDigest = needString(installation.deploymentDigest, "installation.deploymentDigest");
  if (!isDeploymentDigest(deploymentDigest)) err("installation.deploymentDigest must be a lowercase SHA-256 digest");
  // DR25: where the extensions `oma pi install` installed live, when any role may name one.
  const packages = installation.packages === undefined ? undefined : needString(installation.packages, "installation.packages");
  if (packages !== undefined && (!isAbsolute(packages) || normalize(packages) !== packages || packages === "/"))
    err("installation.packages must be a normalized absolute directory");

  const modelProfiles = needRecord(cfg.modelProfiles, "modelProfiles");
  for (const [name, value] of Object.entries(modelProfiles)) {
    const profile = closedRecord(value, ["provider", "model", "credentialRef", "codecRevision", "pricingRevision", "maxInputTokens", "maxOutputTokens", "inferenceTimeoutSeconds"], `modelProfiles.${name}`, ["thinking"]);
    if (profile.thinking !== undefined && !(EFFORT_LEVELS as readonly unknown[]).includes(profile.thinking))
      err(`modelProfiles.${name}.thinking must be one of ${EFFORT_LEVELS.join(", ")}`);
    for (const key of ["provider", "model", "credentialRef", "codecRevision", "pricingRevision"]) needString(profile[key], `modelProfiles.${name}.${key}`);
    for (const key of ["maxInputTokens", "maxOutputTokens", "inferenceTimeoutSeconds"]) needInt(profile[key], `modelProfiles.${name}.${key}`, 1);
  }
  const agentProfiles = needRecord(cfg.agentProfiles, "agentProfiles");
  const profileNames = new Set(Object.keys(agentProfiles));
  for (const [name, value] of Object.entries(agentProfiles)) {
    const profile = closedRecord(value, ["modelProfile", "capabilities", "delegable", "childProfile", "resources"], `agentProfiles.${name}`);
    const modelProfile = needString(profile.modelProfile, `agentProfiles.${name}.modelProfile`);
    if (!Object.hasOwn(modelProfiles, modelProfile)) err(`agentProfiles.${name}.modelProfile unknown`);
    if (!Array.isArray(profile.capabilities) || !Array.isArray(profile.delegable)) err(`agentProfiles.${name} capabilities/delegable arrays required`);
    if (!profile.capabilities.every(isCapability) || !profile.delegable.every(isCapability)) err(`agentProfiles.${name} contains unknown capability`);
    if (profile.childProfile !== null && typeof profile.childProfile !== "string") err(`agentProfiles.${name}.childProfile must be a string or null`);
    if (typeof profile.childProfile === "string" && !profileNames.has(profile.childProfile)) err(`agentProfiles.${name}.childProfile unknown`);
    needIntegerFields(needRecord(profile.resources, `agentProfiles.${name}.resources`), RESOURCE_FIELDS, `agentProfiles.${name}.resources`);
  }
  const principalProfile = needString(cfg.principalProfile, "principalProfile");
  if (!profileNames.has(principalProfile)) err("principalProfile unknown");
  const initialResidents = needArray(cfg.initialResidents, "initialResidents");
  const residentNames = new Set<string>();
  for (const value of initialResidents) {
    const row = closedRecord(value, ["name", "profile", "brief"], "initialResidents entry");
    const name = needString(row.name, "initialResidents.name");
    if (!isValidActorName(name)) err("initialResidents.name invalid");
    if (residentNames.has(name)) err("initialResidents.name duplicate");
    residentNames.add(name);
    const profile = needString(row.profile, "initialResidents.profile");
    if (!profileNames.has(profile)) err("initialResidents.profile unknown");
    needString(row.brief, "initialResidents.brief");
  }
  const quota = closedRecord(cfg.quota, ["societyAgents", "lineageAgents", "societyUnits", "lineageUnits", "principalReservedUnits", "inferenceSlots", "principalReservedSlots", "storageBytes"], "quota");
  for (const key of Object.keys(quota)) needInt(quota[key], `quota.${key}`, 0);
  const societyAgents = needInt(quota.societyAgents, "quota.societyAgents", 0);
  const lineageAgents = needInt(quota.lineageAgents, "quota.lineageAgents", 0);
  const societyUnits = needInt(quota.societyUnits, "quota.societyUnits", 0);
  const principalReservedUnits = needInt(quota.principalReservedUnits, "quota.principalReservedUnits", 0);
  const inferenceSlots = needInt(quota.inferenceSlots, "quota.inferenceSlots", 1);
  const principalReservedSlots = needInt(quota.principalReservedSlots, "quota.principalReservedSlots", 0);
  needInt(quota.storageBytes, "quota.storageBytes", 1);
  if (lineageAgents > societyAgents) err("quota.lineageAgents exceeds quota.societyAgents");
  if (initialResidents.length > societyAgents) err("initialResidents exceed quota.societyAgents");
  if (principalReservedUnits > societyUnits) err("quota.principalReservedUnits exceeds quota.societyUnits");
  if (principalReservedSlots > inferenceSlots) err("quota.principalReservedSlots exceeds quota.inferenceSlots");

  const integration = closedRecord(cfg.integration, ["policyRevision", "protectedPaths", "checks"], "integration", ["tiered"]);
  if (integration.tiered !== undefined && tieredPolicyCheck(integration.tiered) !== null) err("integration.tiered has invalid rules or authority");
  const policyRevision = needString(integration.policyRevision, "integration.policyRevision");
  const protectedPaths = needArray(integration.protectedPaths, "integration.protectedPaths");
  if (protectedPaths.some(value => typeof value !== "string" || (value !== "/" && !isValidWirePath(value.endsWith("/") ? value.slice(0, -1) : value)) || /[*?[\]{}!]/.test(value))) err("integration.protectedPaths must be safe literal paths");
  const checks = needArray(integration.checks, "integration.checks");
  for (const [index, value] of checks.entries()) {
    const row = closedRecord(value, ["id", "argv", "env", "resources"], `integration.checks[${index}]`);
    needString(row.id, `integration.checks[${index}].id`);
    const argv = needArray(row.argv, `integration.checks[${index}].argv`);
    if (argv.some(item => typeof item !== "string")) err(`integration.checks[${index}].argv must be strings`);
    const env = needRecord(row.env, `integration.checks[${index}].env`);
    for (const [key, item] of Object.entries(env)) if (typeof item !== "string") err(`integration.checks[${index}].env.${key} must be a string`);
    needIntegerFields(needRecord(row.resources, `integration.checks[${index}].resources`), RESOURCE_FIELDS, `integration.checks[${index}].resources`);
  }
  const limits = needRecord(cfg.limits, "limits");
  needIntegerFields(limits, PROTOCOL_LIMIT_FIELDS, "limits");
  if (!isLogResponseFrameLimit(limits.frameBytes)) err("limits.frameBytes must support a complete log response and uint32 framing");
  const featureKeys = ["notmuch", "reflinkSeed", "formalApproval", "egress"];
  const features = closedRecord(cfg.features, featureKeys, "features");
  for (const key of featureKeys) if (features[key] !== false) err(`features.${key} must be false in Core v1 default build`);
  return validatedSnapshot({
    schemaVersion: 1, society, installation: { node, libdir, rootfs, deploymentDigest, ...(packages === undefined ? {} : { packages }) },
    modelProfiles: Object.assign(Object.create(null), modelProfiles) as HostConfigV1["modelProfiles"],
    agentProfiles: Object.assign(Object.create(null), agentProfiles) as HostConfigV1["agentProfiles"],
    principalProfile, initialResidents: initialResidents as HostConfigV1["initialResidents"], quota: quota as HostConfigV1["quota"],
    integration: { policyRevision, ...(integration.tiered === undefined ? {} : { tiered: integration.tiered as NonNullable<HostConfigV1["integration"]["tiered"]> }), protectedPaths: protectedPaths as string[], checks: checks as HostConfigV1["integration"]["checks"] },
    limits: limits as unknown as HostConfigV1["limits"], features: { notmuch: false, reflinkSeed: false, formalApproval: false, egress: false },
  });
}
