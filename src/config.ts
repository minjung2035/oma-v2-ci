// MUST [CFG-001/002/005]: closed host configuration. Every field is required;
// unknown fields and unsafe integers are rejected. No unlimited defaults.
import { readFileSync } from "node:fs";
import type { HostConfigV1, Capability, ResolvedAgentSpec } from "../implementation/contracts.js";
import { StoreError } from "./store.js";
import { isValidActorName, isValidSocietyName, isValidWirePath } from "./ids.js";
import { parseJsonObject } from "./frame.js";

function err(message: string): never {
  throw new StoreError("INVALID_REQUEST", `config: ${message}`);
}

function needString(v: unknown, what: string): string {
  if (typeof v !== "string" || v.length === 0)
    err(`${what} must be a non-empty string`);
  return v;
}

function needInt(v: unknown, what: string, minInclusive: number): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < minInclusive) {
    err(`${what} must be a safe integer >= ${minInclusive}`);
  }
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

function requireKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
  what: string,
 ): void {
  for (const key of keys)
    if (!Object.prototype.hasOwnProperty.call(record, key))
      err(`${what}.${key} is required`);
}

export function loadConfig(path: string): HostConfigV1 {
  let raw: unknown;
  try {
    raw = parseJsonObject(readFileSync(path)).raw;
  } catch (e) {
    throw new StoreError(
      "INVALID_REQUEST",
      `config unreadable: ${(e as Error).message}`,
    );
  }
  const cfg = needRecord(raw, "root");
  for (const k of Object.keys(cfg)) {
    if (
      ![
        "schemaVersion",
        "society",
        "installation",
        "modelProfiles",
        "agentProfiles",
        "principalProfile",
        "initialResidents",
        "quota",
        "integration",
        "limits",
        "features",
      ].includes(k)
    ) {
      err(`unknown top-level field ${k}`);
    }
  }
  requireKeys(
    cfg,
    [
      "schemaVersion",
      "society",
      "installation",
      "modelProfiles",
      "agentProfiles",
      "principalProfile",
      "initialResidents",
      "quota",
      "integration",
      "limits",
      "features",
    ],
    "root",
  );
  if (cfg["schemaVersion"] !== 1) err("schemaVersion must be 1");
  const society = needString(cfg["society"], "society");
  if (!isValidSocietyName(society)) err("invalid society name");

  const installation = needRecord(cfg["installation"], "installation");
  for (const k of Object.keys(installation)) {
    if (!["node", "libdir", "rootfs", "deploymentDigest"].includes(k))
      err(`installation.${k} unknown`);
  }
  requireKeys(
    installation,
    ["node", "libdir", "rootfs", "deploymentDigest"],
    "installation",
  );
  const node = needString(installation["node"], "installation.node");
  const libdir = needString(installation["libdir"], "installation.libdir");
  const rootfs = needString(installation["rootfs"], "installation.rootfs");
  const deploymentDigest = needString(
    installation["deploymentDigest"],
    "installation.deploymentDigest",
  );

  const modelProfiles = needRecord(cfg["modelProfiles"], "modelProfiles");
  for (const [name, p] of Object.entries(modelProfiles)) {
    const prof = needRecord(p, `modelProfiles.${name}`);
    for (const k of Object.keys(prof)) {
      if (
        ![
          "provider",
          "model",
          "credentialRef",
          "codecRevision",
          "pricingRevision",
          "maxInputTokens",
          "maxOutputTokens",
          "inferenceTimeoutSeconds",
        ].includes(k)
      )
        err(`modelProfiles.${name}.${k} unknown`);
    }
    requireKeys(
      prof,
      [
        "provider",
        "model",
        "credentialRef",
        "codecRevision",
        "pricingRevision",
        "maxInputTokens",
        "maxOutputTokens",
        "inferenceTimeoutSeconds",
      ],
      `modelProfiles.${name}`,
    );
    for (const k of [
      "provider",
      "model",
      "credentialRef",
      "codecRevision",
      "pricingRevision",
    ])
      needString(prof[k], `modelProfiles.${name}.${k}`);
    needInt(
      prof["maxInputTokens"],
      `modelProfiles.${name}.maxInputTokens`,
      1,
    );
    needInt(
      prof["maxOutputTokens"],
      `modelProfiles.${name}.maxOutputTokens`,
      1,
    );
    needInt(
      prof["inferenceTimeoutSeconds"],
      `modelProfiles.${name}.inferenceTimeoutSeconds`,
      1,
    );
  }
  const agentProfiles = needRecord(cfg["agentProfiles"], "agentProfiles");
  const profileNames = new Set(Object.keys(agentProfiles));
  const allowedCapabilities = new Set<Capability>([
    "mail.send",
    "route.follow",
    "agent.create",
    "agent.manage.self",
    "agent.manage.descendants",
    "git.submit",
    "code.integrate",
    "context.publish",
  ]);
  for (const [name, p] of Object.entries(agentProfiles)) {
    const prof = needRecord(p, `agentProfiles.${name}`);
    for (const k of Object.keys(prof)) {
      if (
        ![
          "modelProfile",
          "capabilities",
          "delegable",
          "childProfile",
          "resources",
        ].includes(k)
      )
        err(`agentProfiles.${name}.${k} unknown`);
    }
    requireKeys(
      prof,
      ["modelProfile", "capabilities", "delegable", "childProfile", "resources"],
      `agentProfiles.${name}`,
    );
    const modelProfile = needString(
      prof["modelProfile"],
      `agentProfiles.${name}.modelProfile`,
    );
    if (!Object.prototype.hasOwnProperty.call(modelProfiles, modelProfile))
      err(`agentProfiles.${name}.modelProfile unknown`);
    if (
      !Array.isArray(prof["capabilities"]) ||
      !Array.isArray(prof["delegable"])
    )
      err(`agentProfiles.${name} capabilities/delegable arrays required`);
    if (
      !prof["capabilities"].every(
        (c) => typeof c === "string" && allowedCapabilities.has(c as Capability),
      ) ||
      !prof["delegable"].every(
        (c) => typeof c === "string" && allowedCapabilities.has(c as Capability),
      )
    )
      err(`agentProfiles.${name} contains unknown capability`);
    if (
      prof["childProfile"] !== null &&
      typeof prof["childProfile"] !== "string"
    )
      err(`agentProfiles.${name}.childProfile must be a string or null`);
    if (
      typeof prof["childProfile"] === "string" &&
      !profileNames.has(prof["childProfile"] as string)
    )
      err(`agentProfiles.${name}.childProfile unknown`);
    const resources = needRecord(
      prof["resources"],
      `agentProfiles.${name}.resources`,
    );
    const resourceKeys = [
      "memoryBytes",
      "tasks",
      "cpuQuotaPercent",
      "tmpBytes",
      "workspaceBytes",
      "stagingBytes",
      "checkTimeoutSeconds",
    ];
    requireKeys(resources, resourceKeys, `agentProfiles.${name}.resources`);
    for (const k of Object.keys(resources)) {
      if (!resourceKeys.includes(k)) err(`agentProfiles.${name}.resources.${k} unknown`);
      needInt(
        resources[k],
        `agentProfiles.${name}.resources.${k}`,
        1,
      );
    }
  }

  const principalProfile = needString(
    cfg["principalProfile"],
    "principalProfile",
  );
  if (!profileNames.has(principalProfile)) err("principalProfile unknown");

  const initialResidents = needArray(
    cfg["initialResidents"],
    "initialResidents",
  );
  const residentNames = new Set<string>();
  for (const r of initialResidents) {
    const row = needRecord(r, "initialResidents entry");
    requireKeys(row, ["name", "profile", "brief"], "initialResidents entry");
    for (const k of Object.keys(row))
      if (!["name", "profile", "brief"].includes(k))
        err(`initialResidents.${k} unknown`);
    const name = needString(row["name"], "initialResidents.name");
    if (!isValidActorName(name)) err("initialResidents.name invalid");
    if (!residentNames.add(name)) err("initialResidents.name duplicate");
    const profile = needString(row["profile"], "initialResidents.profile");
    if (!profileNames.has(profile)) err("initialResidents.profile unknown");
    needString(row["brief"], "initialResidents.brief");
  }

  const quota = needRecord(cfg["quota"], "quota");
  const quotaKeys = [
    "societyAgents",
    "lineageAgents",
    "societyUnits",
    "lineageUnits",
    "principalReservedUnits",
    "inferenceSlots",
    "principalReservedSlots",
    "storageBytes",
  ];
  for (const k of Object.keys(quota)) {
    if (!quotaKeys.includes(k)) err(`quota.${k} unknown`);
    needInt(quota[k], `quota.${k}`, 0);
  }
  requireKeys(quota, quotaKeys, "quota");
  const societyAgents = needInt(quota["societyAgents"], "quota.societyAgents", 0);
  const lineageAgents = needInt(quota["lineageAgents"], "quota.lineageAgents", 0);
  const societyUnits = needInt(quota["societyUnits"], "quota.societyUnits", 0);
  const principalReservedUnits = needInt(
    quota["principalReservedUnits"],
    "quota.principalReservedUnits",
    0,
  );
  const inferenceSlots = needInt(quota["inferenceSlots"], "quota.inferenceSlots", 1);
  const principalReservedSlots = needInt(
    quota["principalReservedSlots"],
    "quota.principalReservedSlots",
    0,
  );
  needInt(quota["storageBytes"], "quota.storageBytes", 1);
  if (lineageAgents > societyAgents)
    err("quota.lineageAgents exceeds quota.societyAgents");
  if (initialResidents.length > societyAgents)
    err("initialResidents exceed quota.societyAgents");
  if (principalReservedUnits > societyUnits)
    err("quota.principalReservedUnits exceeds quota.societyUnits");
  if (principalReservedSlots > inferenceSlots)
    err("quota.principalReservedSlots exceeds quota.inferenceSlots");

  const integration = needRecord(cfg["integration"], "integration");
  requireKeys(
    integration,
    ["policyRevision", "protectedPaths", "checks"],
    "integration",
  );
  const policyRevision = needString(
    integration["policyRevision"],
    "integration.policyRevision",
  );
  const protectedPaths = needArray(
    integration["protectedPaths"],
    "integration.protectedPaths",
  );
  if (
    protectedPaths.some(
      (x) =>
        typeof x !== "string" ||
        (x !== "/" && !isValidWirePath(x.endsWith("/") ? x.slice(0, -1) : x)) ||
        /[*?[\]{}!]/.test(x),
    )
  )
    err("integration.protectedPaths must be safe literal paths");
  const checks = needArray(integration["checks"], "integration.checks");
  for (const [i, c] of checks.entries()) {
    const row = needRecord(c, `integration.checks[${i}]`);
    requireKeys(
      row,
      ["id", "argv", "env", "resources"],
      `integration.checks[${i}]`,
    );
    for (const k of Object.keys(row)) {
      if (!["id", "argv", "env", "resources"].includes(k))
        err(`integration.checks[${i}].${k} unknown`);
    }
    needString(row["id"], `integration.checks[${i}].id`);
    const argv = needArray(row["argv"], `integration.checks[${i}].argv`);
    if (argv.some((x) => typeof x !== "string"))
      err(`integration.checks[${i}].argv must be strings`);
    const env = needRecord(row["env"], `integration.checks[${i}].env`);
    for (const [k, v] of Object.entries(env))
      if (typeof v !== "string")
        err(`integration.checks[${i}].env.${k} must be a string`);
    const resources = needRecord(
      row["resources"],
      `integration.checks[${i}].resources`,
    );
    const resourceKeys = [
      "memoryBytes",
      "tasks",
      "cpuQuotaPercent",
      "tmpBytes",
      "workspaceBytes",
      "stagingBytes",
      "checkTimeoutSeconds",
    ];
    requireKeys(
      resources,
      resourceKeys,
      `integration.checks[${i}].resources`,
    );
    for (const k of Object.keys(resources)) {
      if (!resourceKeys.includes(k))
        err(`integration.checks[${i}].resources.${k} unknown`);
      needInt(
        resources[k],
        `integration.checks[${i}].resources.${k}`,
        1,
      );
    }
  }

  const limits = needRecord(cfg["limits"], "limits");
  const limitKeys = [
    "frameBytes",
    "mailBodyBytes",
    "subjectBytes",
    "addresses",
    "replyReferences",
    "contextFiles",
    "contextBytes",
    "bundleBytes",
    "logBytes",
    "batchMaxMessages",
    "idleStreamSeconds",
    "receiptWaitSeconds",
  ];
  for (const k of Object.keys(limits)) {
    if (!limitKeys.includes(k)) err(`limits.${k} unknown`);
    needInt(limits[k], `limits.${k}`, 1);
  }
  requireKeys(limits, limitKeys, "limits");

  const features = needRecord(cfg["features"], "features");
  const featureKeys = ["notmuch", "reflinkSeed", "formalApproval", "egress"];
  for (const k of Object.keys(features))
    if (!featureKeys.includes(k)) err(`features.${k} unknown`);
  requireKeys(features, featureKeys, "features");
  for (const k of featureKeys) {
    if (features[k] !== false)
      err(`features.${k} must be false in Core v1 default build`);
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
    features: {
      notmuch: false,
      reflinkSeed: false,
      formalApproval: false,
      egress: false,
    },
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
    throw new StoreError(
      "UNSUPPORTED_PROFILE",
      `parent profile ${parent.profile} is not configured`,
    );
  const childName = parentProfile.childProfile;
  if (childName === null) return null;
  const child = cfg.agentProfiles[childName];
  if (!child)
    throw new StoreError(
      "UNSUPPORTED_PROFILE",
      `child profile ${childName} is not configured`,
    );
  const intersection = parent.capabilities.filter(
    (c) =>
      parentProfile.delegable.includes(c) && child.capabilities.includes(c),
  );
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