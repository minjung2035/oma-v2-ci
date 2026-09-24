/** First-run configuration so `oma` works in a directory with no setup.
 *
 * Anything the engine already owns stays the engine's. Signing in, choosing a
 * model and remembering that choice are Pi's own flows, and OMA does not
 * rebuild them: the single model profile here resolves to "whatever connection
 * the engine currently has", so the first run prompts exactly the way the
 * engine normally would.
 *
 * What remains is OMA's own domain, which Pi has no concept of: the society,
 * per-role capabilities and the multi-agent budget. Those get conservative
 * values here rather than a setup command, and all of them are visible and
 * editable in the Control Panel (CFG-002, arch §23.6).
 */
import { createHash } from "node:crypto";
import type { HostConfigV1 } from "../../implementation/contracts.js";
import { StoreError } from "../domain/errors.js";

export const DEFAULT_PRINCIPAL_PROFILE = "principal";
export const DEFAULT_RESIDENT_PROFILE = "resident";
export const DEFAULT_MODEL_PROFILE = "default";

export interface DefaultConfigInput {
  readonly society: string;
  readonly node: string;
  readonly libdir: string;
  readonly rootfs: string;
  readonly deploymentDigest: string;
}

/** D05/WP16.01: the default society of a project. `canonicalProjectPath` is
 * the entry's single realpath observation of the project directory; this
 * derivation is pure. Up to 15 ASCII slug characters of the directory name
 * (`project` when none survive), then `-`, then the first 16 hex digits of the
 * SHA-256 of the canonical path: 32 characters at most. Truncation is not
 * collision-proof, so every mutation first compares the full path recorded in
 * the society's project binding.
 */
export function defaultSocietyFor(canonicalProjectPath: string): string {
  const base = canonicalProjectPath.split("/").filter(Boolean).pop() ?? "";
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^[^a-z]+/, "").slice(0, 15).replace(/-+$/, "");
  return `${slug.length > 0 ? slug : "project"}-${createHash("sha256").update(canonicalProjectPath).digest("hex").slice(0, 16)}`;
}

/** The pre-D05 default: a slug of the directory name alone. Kept only to find
 * a society an earlier version created for this project, which is never
 * renamed or rebound implicitly.
 */
export function societyFromDirectory(directory: string): string {
  const base = directory.split("/").filter(Boolean).pop() ?? "";
  const slug = base.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  const trimmed = slug.replace(/^[^a-z]+/, "");
  return trimmed.length > 0 ? trimmed : "workspace";
}

const RESOURCES = Object.freeze({
  memoryBytes: 3 * 1024 * 1024 * 1024,
  tasks: 128,
  cpuQuotaPercent: 200,
  tmpBytes: 512 * 1024 * 1024,
  workspaceBytes: 2 * 1024 * 1024 * 1024,
  stagingBytes: 1024 * 1024 * 1024,
  checkTimeoutSeconds: 600,
});

/** CFG-003's reference values. Stated here rather than inferred so the written
 * configuration shows the operator exactly what is in force.
 */
const LIMITS = Object.freeze({
  frameBytes: 256 * 1024,
  mailBodyBytes: 256 * 1024,
  subjectBytes: 512,
  addresses: 64,
  replyReferences: 64,
  contextFiles: 256,
  contextBytes: 8 * 1024 * 1024,
  bundleBytes: 256 * 1024 * 1024,
  logBytes: 1024 * 1024,
  batchMaxMessages: 24,
  idleStreamSeconds: 30,
  receiptWaitSeconds: 30,
});

export function defaultHostConfig(input: DefaultConfigInput): HostConfigV1 {
  if (input.society.length === 0)
    throw new StoreError("INVALID_REQUEST", "a default configuration needs a society name");
  return {
    schemaVersion: 1,
    society: input.society,
    installation: {
      node: input.node,
      libdir: input.libdir,
      rootfs: input.rootfs,
      deploymentDigest: input.deploymentDigest,
    },
    modelProfiles: {
      // "pi/current" means the engine picks the connection, so OMA states no
      // provider or credential of its own. The remaining fields exist only
      // because the schema is closed; they are placeholders, not a pricing or
      // context claim. Real usage bounds belong to the engine, and nothing
      // reads these on this path today.
      [DEFAULT_MODEL_PROFILE]: {
        provider: "pi",
        model: "current",
        credentialRef: "engine-managed",
        codecRevision: "engine-current",
        pricingRevision: "unpinned",
        maxInputTokens: 1,
        maxOutputTokens: 1,
        inferenceTimeoutSeconds: 600,
      },
    },
    agentProfiles: {
      [DEFAULT_PRINCIPAL_PROFILE]: {
        modelProfile: DEFAULT_MODEL_PROFILE,
        capabilities: ["mail.send", "route.follow", "agent.create", "agent.manage.descendants", "context.publish"],
        delegable: ["mail.send", "route.follow", "git.submit", "agent.manage.self"],
        childProfile: DEFAULT_RESIDENT_PROFILE,
        resources: { ...RESOURCES },
      },
      [DEFAULT_RESIDENT_PROFILE]: {
        // No code.integrate by default: canonical main stays a deliberate grant.
        modelProfile: DEFAULT_MODEL_PROFILE,
        capabilities: ["mail.send", "route.follow", "git.submit", "agent.manage.self"],
        delegable: [],
        childProfile: null,
        resources: { ...RESOURCES },
      },
    },
    principalProfile: DEFAULT_PRINCIPAL_PROFILE,
    // Residents are created when they are asked for, not at first start.
    initialResidents: [],
    quota: {
      societyAgents: 8,
      lineageAgents: 4,
      societyUnits: 1000000,
      lineageUnits: 250000,
      principalReservedUnits: 200000,
      inferenceSlots: 4,
      principalReservedSlots: 1,
      storageBytes: 8 * 1024 * 1024 * 1024,
    },
    integration: {
      policyRevision: "default-1",
      protectedPaths: [],
      // Explicitly empty: this society has no integration policy yet, and a
      // Resident cannot integrate without code.integrate anyway.
      checks: [],
    },
    limits: { ...LIMITS },
    features: { notmuch: false, reflinkSeed: false, formalApproval: false, egress: false },
  };
}
