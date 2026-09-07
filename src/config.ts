// MUST [CFG-001/002/005]: closed host configuration. Every field is required;
// unknown fields and unsafe integers are rejected. No unlimited defaults.
import { readFileSync } from "node:fs";
import type { HostConfigV1, Capability } from "../implementation/contracts.js";
import { StoreError } from "./store.js";
import { isValidActorName, isValidSocietyName } from "./ids.js";

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

export function loadConfig(path: string): HostConfigV1 {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
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
  if (cfg["schemaVersion"] !== 1) err("schemaVersion must be 1");
  const society = needString(cfg["society"], "society");
  if (!isValidSocietyName(society)) err("invalid society name");

  const installation = needRecord(cfg["installation"], "installation");
  for (const k of Object.keys(installation)) {
    if (!["node", "libdir", "rootfs", "deploymentDigest"].includes(k))
      err(`installation.${k} unknown`);
  }
  const node = needString(installation["node"], "installation.node");
  const libdir = needString(installation["libdir"], "installation.libdir");
  const rootfs = needString(installation["rootfs"], "installation.rootfs");
  const deploymentDigest = needString(
    installation["deploymentDigest"],
    "installation.deploymentDigest",
  );

  const modelProfiles = needRecord(cfg["modelProfiles"], "modelProfiles");
  const agentProfiles = needRecord(cfg["agentProfiles"], "agentProfiles");
  const profileNames = new Set(Object.keys(agentProfiles));
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
    const modelProfile = needString(
      prof["modelProfile"],
      `agentProfiles.${name}.modelProfile`,
    );
    if (!(modelProfile in modelProfiles))
      err(`agentProfiles.${name}.modelProfile unknown`);
    if (
      !Array.isArray(prof["capabilities"]) ||
      !Array.isArray(prof["delegable"])
    )
      err(`agentProfiles.${name} capabilities/delegable arrays required`);
    if (
      prof["childProfile"] !== null &&
      typeof prof["childProfile"] !== "string"
    )
      err(`agentProfiles.${name}.childProfile must be a string or null`);
    needRecord(prof["resources"], `agentProfiles.${name}.resources`);
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
  for (const r of initialResidents) {
    const row = needRecord(r, "initialResidents entry");
    const name = needString(row["name"], "initialResidents.name");
    if (!isValidActorName(name)) err("initialResidents.name invalid");
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
  const societyUnits = needInt(quota["societyUnits"], "quota.societyUnits", 0);
  const principalReservedUnits = needInt(
    quota["principalReservedUnits"],
    "quota.principalReservedUnits",
    0,
  );
  if (principalReservedUnits > societyUnits)
    err("quota.principalReservedUnits exceeds quota.societyUnits");

  const integration = needRecord(cfg["integration"], "integration");
  const policyRevision = needString(
    integration["policyRevision"],
    "integration.policyRevision",
  );
  const protectedPaths = needArray(
    integration["protectedPaths"],
    "integration.protectedPaths",
  );
  if (protectedPaths.some((x) => typeof x !== "string"))
    err("integration.protectedPaths must be strings");
  const checks = needArray(integration["checks"], "integration.checks");
  for (const [i, c] of checks.entries()) {
    const row = needRecord(c, `integration.checks[${i}]`);
    for (const k of Object.keys(row)) {
      if (!["id", "argv", "env", "resources"].includes(k))
        err(`integration.checks[${i}].${k} unknown`);
    }
    needString(row["id"], `integration.checks[${i}].id`);
    const argv = needArray(row["argv"], `integration.checks[${i}].argv`);
    if (argv.some((x) => typeof x !== "string"))
      err(`integration.checks[${i}].argv must be strings`);
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

  const features = needRecord(cfg["features"], "features");
  for (const k of ["notmuch", "reflinkSeed", "formalApproval", "egress"]) {
    if (features[k] !== false)
      err(`features.${k} must be false in Core v1 default build`);
  }

  return {
    schemaVersion: 1,
    society,
    installation: { node, libdir, rootfs, deploymentDigest },
    modelProfiles: modelProfiles as HostConfigV1["modelProfiles"],
    agentProfiles: agentProfiles as HostConfigV1["agentProfiles"],
    principalProfile,
    initialResidents: initialResidents as HostConfigV1["initialResidents"],
    quota: quota as HostConfigV1["quota"],
    integration: {
      policyRevision,
      protectedPaths: protectedPaths as string[],
      checks: checks as HostConfigV1["integration"]["checks"],
    },
    // SAFETY: every limits.* key was validated via needInt above; the cast
    // only narrows the already-checked record to the contract type.
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
  parent: { name: string; profile: string },
  input: { name: string; from: string; brief: string },
): {
  spec: {
    name: string;
    from: string;
    brief: string;
    profile: string;
    capabilities: Capability[];
  };
} | null {
  void parent.name;
  const parentProfile = cfg.agentProfiles[parent.profile];
  if (!parentProfile) return null;
  const childName = parentProfile.childProfile;
  if (childName === null) return null;
  const child = cfg.agentProfiles[childName];
  if (!child) return null;
  const intersection = parentProfile.capabilities.filter(
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
    },
  };
}
