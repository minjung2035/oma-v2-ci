import { EFFORT_LEVELS } from "@oma/domain/settings";
import { tieredPolicyCheck } from "@oma/domain/integration-policy";
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
import { HOST_CONFIGURATION_VERSION } from "@oma/domain/config-format";
import { StoreError } from "@oma/domain/errors";
import { isValidActorName, isValidSocietyName, isValidWirePath } from "@oma/domain/identifiers";
import { isCapability } from "@oma/domain/capabilities";
import { MIN_MIXED_BATCH_MESSAGES, PROTOCOL_LIMIT_FIELDS } from "@oma/domain/limits";
import { mailBodyBytesFits, minimumMailBodyBytes } from "@oma/domain/review-bounds";
import type { IntegerField } from "@oma/domain/integer-fields";
import { isDeploymentDigest } from "@oma/domain/deployment";
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
    installation: Object.freeze({ ...config.installation }),
    modelProfiles: Object.freeze(modelProfiles),
    agentProfiles: Object.freeze(agentProfiles),
    initialResidents: Object.freeze(config.initialResidents.map(row => Object.freeze({ ...row }))),
    integration: Object.freeze({
      ...config.integration,
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
  if (cfg.schemaVersion !== HOST_CONFIGURATION_VERSION)
    err(`unsupported development configuration schema; expected ${HOST_CONFIGURATION_VERSION}. Use a new development state directory`);
  closedKeys(cfg, ["schemaVersion", "society", "installation", "modelProfiles", "agentProfiles", "principalProfile", "initialResidents", "integration", "limits"], "root");
  const society = needString(cfg.society, "society");
  if (!isValidSocietyName(society)) err("invalid society name");
  const installation = closedRecord(cfg.installation, ["node", "libdir", "deploymentDigest"], "installation", ["packages"]);
  const node = needString(installation.node, "installation.node");
  const libdir = needString(installation.libdir, "installation.libdir");
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
  const integration = closedRecord(cfg.integration, ["policyRevision", "protectedPaths", "checks"], "integration", ["tiered"]);
  if (integration.tiered !== undefined && tieredPolicyCheck(integration.tiered) !== null) err("integration.tiered has invalid rules or authority");
  const policyRevision = needString(integration.policyRevision, "integration.policyRevision");
  const protectedPaths = needArray(integration.protectedPaths, "integration.protectedPaths");
  if (protectedPaths.some(value => typeof value !== "string" || (value !== "/" && !isValidWirePath(value.endsWith("/") ? value.slice(0, -1) : value)) || /[*?[\]{}!]/.test(value))) err("integration.protectedPaths must be safe literal paths");
  const checks = needArray(integration.checks, "integration.checks");
  for (const [index, value] of checks.entries()) {
    const row = closedRecord(value, ["id", "argv", "env"], `integration.checks[${index}]`);
    needString(row.id, `integration.checks[${index}].id`);
    const argv = needArray(row.argv, `integration.checks[${index}].argv`);
    if (argv.some(item => typeof item !== "string")) err(`integration.checks[${index}].argv must be strings`);
    const env = needRecord(row.env, `integration.checks[${index}].env`);
    for (const [key, item] of Object.entries(env)) if (typeof item !== "string") err(`integration.checks[${index}].env.${key} must be a string`);
  }
  const limits = needRecord(cfg.limits, "limits");
  needIntegerFields(limits, PROTOCOL_LIMIT_FIELDS, "limits");
  if (!isLogResponseFrameLimit(limits.frameBytes)) err("limits.frameBytes must support a complete log response and uint32 framing");
  // AV-07: bounds the grammar accepts but the runtime cannot serve are refused
  // at commit, not discovered later as INTERNAL_ERROR on accepted work. The
  // floors are measured by the same constants the emission paths use
  // (mail/review-bounds.ts, domain/limits.ts via mail/batch-policy.ts), so
  // they track the runtime rather than duplicating it.
  // An approval request carries the requester's reason plus one bound vote
  // body per vote the floor requires: the floor model must cover the votes
  // the policy can bind (the runtime falls back to one vote when a live
  // policy has no tiered rules -- a request opened under an earlier policy
  // can still emit one).
  const approvalVotes = (integration.tiered as { highPeerFloor?: number } | undefined)?.highPeerFloor ?? 1;
  if (!mailBodyBytesFits(limits.mailBodyBytes as number, limits.subjectBytes as number, approvalVotes)) {
    const minimum = minimumMailBodyBytes(limits.subjectBytes as number, approvalVotes);
    if (minimum === null)
      err(`limits.subjectBytes and integration.tiered.highPeerFloor are too large for any safe integer limits.mailBodyBytes; ` +
        `an approval request carries the requester's reason plus a bound vote body per required vote`);
    err(`limits.mailBodyBytes must be at least ${minimum} for the configured limits.subjectBytes and integration.tiered.highPeerFloor; ` +
      `a smaller bound cannot always hold a review thread revision, a completion-notice part, or an approval request`);
  }
  if ((limits.batchMaxMessages as number) < MIN_MIXED_BATCH_MESSAGES)
    err(`limits.batchMaxMessages must be at least ${MIN_MIXED_BATCH_MESSAGES}; a single-message batch starves an actor whose direct and public mail are both pending`);
  return validatedSnapshot({
    schemaVersion: HOST_CONFIGURATION_VERSION, society, installation: { node, libdir, deploymentDigest, ...(packages === undefined ? {} : { packages }) },
    modelProfiles: Object.assign(Object.create(null), modelProfiles) as HostConfig["modelProfiles"],
    agentProfiles: Object.assign(Object.create(null), agentProfiles) as HostConfig["agentProfiles"],
    principalProfile, initialResidents: initialResidents as HostConfig["initialResidents"],
    integration: { policyRevision, ...(integration.tiered === undefined ? {} : { tiered: integration.tiered as NonNullable<HostConfig["integration"]["tiered"]> }), protectedPaths: protectedPaths as string[], checks: checks as HostConfig["integration"]["checks"] },
    limits: limits as unknown as HostConfig["limits"],
  });
}
