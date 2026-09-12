// MUST [CFG-001/002/005]: closed host configuration. Every field is required;
// unknown fields and unsafe integers are rejected. No unlimited defaults.
import { readFileSync } from "node:fs";
import type { HostConfigV1, Capability, ResolvedAgentSpec } from "../implementation/contracts.js";
import { StoreError } from "./store.js";
import { isValidActorName, isValidSocietyName, isValidWirePath } from "./ids.js";
import { parseJsonObject } from "./frame.js";
import { isCapability } from "./domain/capabilities.js";
import { RESOURCE_FIELDS } from "./domain/resources.js";
import { PROTOCOL_LIMIT_FIELDS } from "./domain/limits.js";
import type { IntegerField } from "./domain/integer-fields.js";

function err(message: string): never {
  throw new StoreError("INVALID_REQUEST", `config: ${message}`);
}

function needString(v: unknown, what: string): string {
  if (typeof v !== "string" || v.length === 0)
    err(`${what} must be a non-empty string`);
  return v;
}

function needInt(v: unknown, what: string, minInclusive: number): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < minInclusive)
    err(`${what} must be a safe integer >= ${minInclusive}`);
  return v;
}

function needRecord(v: unknown, what: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v))
    err(`${what} must be an object`);
  return v as Record<string, unknown>;
}

function needArray(v: unknown, what: string): unknown[] {
  if (!Array.isArray(v)) err(`${what} must be an array`);
  return v;
}

/** The same key set governs both required fields and unknown-field rejection. */
function closedKeys(record: Record<string, unknown>, keys: readonly string[], what: string): void {
  for (const key of Object.keys(record)) {
    if (!keys.includes(key))
      err(what === "root" ? `unknown top-level field ${key}` : `${what}.${key} unknown`);
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key))
      err(`${what}.${key} is required`);
  }
}

function closedRecord(v: unknown, keys: readonly string[], what: string): Record<string, unknown> {
  const record = needRecord(v, what);
  closedKeys(record, keys, what);
  return record;
}

/** Values/ranges come from the domain; config retains its error path and code. */
function needIntegerFields(
  record: Record<string, unknown>,
  fields: Readonly<Record<string, IntegerField>>,
  what: string,
): void {
  closedKeys(record, Object.keys(fields), what);
  for (const key of Object.keys(fields))
    needInt(record[key], `${what}.${key}`, fields[key]!.minInclusive);
}

export function loadConfig(path: string): HostConfigV1 {
  let raw: unknown;
  try {
    raw = parseJsonObject(readFileSync(path)).raw;
  } catch (e) {
    throw new StoreError("INVALID_REQUEST", `config unreadable: ${(e as Error).message}`);
  }
  const cfg = closedRecord(raw, [
    "schemaVersion", "society", "installation", "modelProfiles", "agentProfiles",
    "principalProfile", "initialResidents", "quota", "integration", "limits", "features",
  ], "root");
  if (cfg["schemaVersion"] !== 1) err("schemaVersion must be 1");
  const society = needString(cfg["society"], "society");
  if (!isValidSocietyName(society)) err("invalid society name");

  const installation = closedRecord(cfg["installation"],
    ["node", "libdir", "rootfs", "deploymentDigest"], "installation");
  const node = needString(installation["node"], "installation.node");
  const libdir = needString(installation["libdir"], "installation.libdir");
  const rootfs = needString(installation["rootfs"], "installation.rootfs");
  const deploymentDigest = needString(installation["deploymentDigest"], "installation.deploymentDigest");

  // Named maps are intentionally open; each value has a closed schema.
  const modelProfiles = needRecord(cfg["modelProfiles"], "modelProfiles");
  for (const [name, p] of Object.entries(modelProfiles)) {
    const prof = closedRecord(p, [
      "provider", "model", "credentialRef", "codecRevision", "pricingRevision",
      "maxInputTokens", "maxOutputTokens", "inferenceTimeoutSeconds",
    ], `modelProfiles.${name}`);
    for (const k of ["provider", "model", "credentialRef", "codecRevision", "pricingRevision"])
      needString(prof[k], `modelProfiles.${name}.${k}`);
    for (const k of ["maxInputTokens", "maxOutputTokens", "inferenceTimeoutSeconds"])
      needInt(prof[k], `modelProfiles.${name}.${k}`, 1);
  }

  const agentProfiles = needRecord(cfg["agentProfiles"], "agentProfiles");
  const profileNames = new Set(Object.keys(agentProfiles));
  for (const [name, p] of Object.entries(agentProfiles)) {
    const prof = closedRecord(p,
      ["modelProfile", "capabilities", "delegable", "childProfile", "resources"],
      `agentProfiles.${name}`);
    const modelProfile = needString(prof["modelProfile"], `agentProfiles.${name}.modelProfile`);
    if (!Object.prototype.hasOwnProperty.call(modelProfiles, modelProfile))
      err(`agentProfiles.${name}.modelProfile unknown`);
    if (!Array.isArray(prof["capabilities"]) || !Array.isArray(prof["delegable"]))
      err(`agentProfiles.${name} capabilities/delegable arrays required`);
    if (!prof["capabilities"].every(isCapability) || !prof["delegable"].every(isCapability))
      err(`agentProfiles.${name} contains unknown capability`);
    if (prof["childProfile"] !== null && typeof prof["childProfile"] !== "string")
      err(`agentProfiles.${name}.childProfile must be a string or null`);
    if (typeof prof["childProfile"] === "string" && !profileNames.has(prof["childProfile"]))
      err(`agentProfiles.${name}.childProfile unknown`);
    needIntegerFields(needRecord(prof["resources"], `agentProfiles.${name}.resources`),
      RESOURCE_FIELDS, `agentProfiles.${name}.resources`);
  }

  const principalProfile = needString(cfg["principalProfile"], "principalProfile");
  if (!profileNames.has(principalProfile)) err("principalProfile unknown");
  const initialResidents = needArray(cfg["initialResidents"], "initialResidents");
  const residentNames = new Set<string>();
  for (const r of initialResidents) {
    const row = closedRecord(r, ["name", "profile", "brief"], "initialResidents entry");
    const name = needString(row["name"], "initialResidents.name");
    if (!isValidActorName(name)) err("initialResidents.name invalid");
    if (residentNames.has(name)) err("initialResidents.name duplicate");
    residentNames.add(name);
    const profile = needString(row["profile"], "initialResidents.profile");
    if (!profileNames.has(profile)) err("initialResidents.profile unknown");
    needString(row["brief"], "initialResidents.brief");
  }

  const quota = closedRecord(cfg["quota"], [
    "societyAgents", "lineageAgents", "societyUnits", "lineageUnits",
    "principalReservedUnits", "inferenceSlots", "principalReservedSlots", "storageBytes",
  ], "quota");
  for (const k of Object.keys(quota)) needInt(quota[k], `quota.${k}`, 0);
  const societyAgents = needInt(quota["societyAgents"], "quota.societyAgents", 0);
  const lineageAgents = needInt(quota["lineageAgents"], "quota.lineageAgents", 0);
  const societyUnits = needInt(quota["societyUnits"], "quota.societyUnits", 0);
  const principalReservedUnits = needInt(quota["principalReservedUnits"], "quota.principalReservedUnits", 0);
  const inferenceSlots = needInt(quota["inferenceSlots"], "quota.inferenceSlots", 1);
  const principalReservedSlots = needInt(quota["principalReservedSlots"], "quota.principalReservedSlots", 0);
  needInt(quota["storageBytes"], "quota.storageBytes", 1);
  if (lineageAgents > societyAgents) err("quota.lineageAgents exceeds quota.societyAgents");
  if (initialResidents.length > societyAgents) err("initialResidents exceed quota.societyAgents");
  if (principalReservedUnits > societyUnits) err("quota.principalReservedUnits exceeds quota.societyUnits");
  if (principalReservedSlots > inferenceSlots) err("quota.principalReservedSlots exceeds quota.inferenceSlots");

  const integration = closedRecord(cfg["integration"],
    ["policyRevision", "protectedPaths", "checks"], "integration");
  const policyRevision = needString(integration["policyRevision"], "integration.policyRevision");
  const protectedPaths = needArray(integration["protectedPaths"], "integration.protectedPaths");
  if (protectedPaths.some((x) =>
    typeof x !== "string" ||
    (x !== "/" && !isValidWirePath(x.endsWith("/") ? x.slice(0, -1) : x)) ||
    /[*?[\]{}!]/.test(x)))
    err("integration.protectedPaths must be safe literal paths");
  const checks = needArray(integration["checks"], "integration.checks");
  for (const [i, c] of checks.entries()) {
    const row = closedRecord(c, ["id", "argv", "env", "resources"], `integration.checks[${i}]`);
    needString(row["id"], `integration.checks[${i}].id`);
    const argv = needArray(row["argv"], `integration.checks[${i}].argv`);
    if (argv.some((x) => typeof x !== "string"))
      err(`integration.checks[${i}].argv must be strings`);
    const env = needRecord(row["env"], `integration.checks[${i}].env`);
    for (const [k, v] of Object.entries(env))
      if (typeof v !== "string") err(`integration.checks[${i}].env.${k} must be a string`);
    needIntegerFields(needRecord(row["resources"], `integration.checks[${i}].resources`),
      RESOURCE_FIELDS, `integration.checks[${i}].resources`);
  }

  const limits = needRecord(cfg["limits"], "limits");
  needIntegerFields(limits, PROTOCOL_LIMIT_FIELDS, "limits");
  const featureKeys = ["notmuch", "reflinkSeed", "formalApproval", "egress"];
  const features = closedRecord(cfg["features"], featureKeys, "features");
  for (const k of featureKeys) {
    if (features[k] !== false) err(`features.${k} must be false in Core v1 default build`);
  }

  return {
    schemaVersion: 1,
    society,
    installation: { node, libdir, rootfs, deploymentDigest },
    modelProfiles: Object.assign(Object.create(null), modelProfiles) as HostConfigV1["modelProfiles"],
    agentProfiles: Object.assign(Object.create(null), agentProfiles) as HostConfigV1["agentProfiles"],
    principalProfile,
    initialResidents: initialResidents as HostConfigV1["initialResidents"],
    quota: quota as HostConfigV1["quota"],
    integration: {
      policyRevision,
      protectedPaths: protectedPaths as string[],
      checks: checks as HostConfigV1["integration"]["checks"],
    },
    limits: limits as unknown as HostConfigV1["limits"],
    features: { notmuch: false, reflinkSeed: false, formalApproval: false, egress: false },
  };
}

/** MUST [CREATE-002]: broker-owned spec resolution from host policy only. */
export function resolveChildSpec(
  cfg: HostConfigV1,
  parent: { name: string; profile: string; capabilities: readonly Capability[] },
  input: { name: string; from: string; brief: string },
): { spec: ResolvedAgentSpec } | null {
  void parent.name;
  const parentProfile = cfg.agentProfiles[parent.profile];
  if (!parentProfile)
    throw new StoreError("UNSUPPORTED_PROFILE", `parent profile ${parent.profile} is not configured`);
  const childName = parentProfile.childProfile;
  if (childName === null) return null;
  const child = cfg.agentProfiles[childName];
  if (!child)
    throw new StoreError("UNSUPPORTED_PROFILE", `child profile ${childName} is not configured`);
  const intersection = parent.capabilities.filter((c) =>
    parentProfile.delegable.includes(c) && child.capabilities.includes(c));
  return {
    spec: {
      name: input.name,
      from: input.from,
      brief: input.brief,
      profile: childName,
      capabilities: [...new Set(intersection)].sort(),
      modelProfile: child.modelProfile,
      resources: { ...child.resources },
    },
  };
}
