// MUST [CFG-001/002/005]: closed host configuration, no unlimited defaults.
import { readConfigurationSource } from "./config/operations.js";
import type { AgentProfile, HostConfigV1, ModelProfile, ResourceLimits } from "../implementation/contracts.js";
import { StoreError } from "./domain/errors.js";
import { isValidActorName, isValidSocietyName, isValidWirePath } from "./domain/identifiers.js";
import { isCapability } from "./domain/capabilities.js";
import { RESOURCE_FIELDS } from "./domain/resources.js";
import { PROTOCOL_LIMIT_FIELDS } from "./domain/limits.js";
import type { IntegerField } from "./domain/integer-fields.js";
import { isDeploymentDigest } from "./domain/deployment.js";
import { isLogResponseFrameLimit } from "./protocol/log-response.js";
export { resolveChildSpec } from "./domain/child-policy.js";

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
function closedKeys(record: Record<string, unknown>, keys: readonly string[], what: string): void {
  for (const key of Object.keys(record)) if (!keys.includes(key)) err(what === "root" ? `unknown top-level field ${key}` : `${what}.${key} unknown`);
  for (const key of keys) if (!Object.hasOwn(record, key)) err(`${what}.${key} is required`);
}
function closedRecord(value: unknown, keys: readonly string[], what: string): Record<string, unknown> {
  const record = needRecord(value, what); closedKeys(record, keys, what); return record;
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


/** Resolve the optional split authoring format once at process startup. */
export function loadConfiguration(path: string) {
  const source = readConfigurationSource(path);
  return Object.freeze({ config: validateConfig(source.host), roles: source.roles });
}
export function loadConfig(path: string): HostConfigV1 { return loadConfiguration(path).config; }

export function validateConfig(raw: unknown): ValidatedConfigCandidate {
  const cfg = closedRecord(raw, ["schemaVersion", "society", "installation", "modelProfiles", "agentProfiles", "principalProfile", "initialResidents", "quota", "integration", "limits", "features"], "root");
  if (cfg.schemaVersion !== 1) err("schemaVersion must be 1");
  const society = needString(cfg.society, "society");
  if (!isValidSocietyName(society)) err("invalid society name");
  const installation = closedRecord(cfg.installation, ["node", "libdir", "rootfs", "deploymentDigest"], "installation");
  const node = needString(installation.node, "installation.node");
  const libdir = needString(installation.libdir, "installation.libdir");
  const rootfs = needString(installation.rootfs, "installation.rootfs");
  const deploymentDigest = needString(installation.deploymentDigest, "installation.deploymentDigest");
  if (!isDeploymentDigest(deploymentDigest)) err("installation.deploymentDigest must be a lowercase SHA-256 digest");

  const modelProfiles = needRecord(cfg.modelProfiles, "modelProfiles");
  for (const [name, value] of Object.entries(modelProfiles)) {
    const profile = closedRecord(value, ["provider", "model", "credentialRef", "codecRevision", "pricingRevision", "maxInputTokens", "maxOutputTokens", "inferenceTimeoutSeconds"], `modelProfiles.${name}`);
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

  const integration = closedRecord(cfg.integration, ["policyRevision", "protectedPaths", "checks"], "integration");
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
    schemaVersion: 1, society, installation: { node, libdir, rootfs, deploymentDigest },
    modelProfiles: Object.assign(Object.create(null), modelProfiles) as HostConfigV1["modelProfiles"],
    agentProfiles: Object.assign(Object.create(null), agentProfiles) as HostConfigV1["agentProfiles"],
    principalProfile, initialResidents: initialResidents as HostConfigV1["initialResidents"], quota: quota as HostConfigV1["quota"],
    integration: { policyRevision, protectedPaths: protectedPaths as string[], checks: checks as HostConfigV1["integration"]["checks"] },
    limits: limits as unknown as HostConfigV1["limits"], features: { notmuch: false, reflinkSeed: false, formalApproval: false, egress: false },
  });
}
