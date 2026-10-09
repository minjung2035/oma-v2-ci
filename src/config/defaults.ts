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
 * the entry's single realpath observation of the project directory and
 * `pathSha256` the SHA-256 (lowercase hex) of that path, computed by the entry
 * adapter; this derivation is pure. Up to 15 ASCII slug characters of the
 * directory name (`project` when none survive), then `-`, then the first 16
 * hex digits of the digest: 32 characters at most. Truncation is not
 * collision-proof, so every mutation first compares the full path recorded in
 * the society's project binding.
 */
export function defaultSocietyFor(canonicalProjectPath: string, pathSha256: string): string {
  if (!/^[0-9a-f]{64}$/.test(pathSha256)) throw new StoreError("INVALID_REQUEST", "a project path digest is 64 lowercase hex digits");
  const base = canonicalProjectPath.split("/").filter(Boolean).pop() ?? "";
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^[^a-z]+/, "").slice(0, 15).replace(/-+$/, "");
  return `${slug.length > 0 ? slug : "project"}-${pathSha256.slice(0, 16)}`;
}

/** DR24: the society of one session of `project` (its defaultSocietyFor
 * name), started at `stamp` (ms): the project's slug and a shortened digest,
 * then the start time in base 36, within the 32 characters a society name
 * has. A shortened digest can collide; the project binding, which compares the
 * full path, refuses that. */
export function sessionSocietyName(project: string, stamp: number): string {
  const digest = /-([0-9a-f]{16})$/.exec(project);
  const slug = digest ? project.slice(0, -17) : project;
  const short = `${slug.slice(0, 13).replace(/-+$/, "")}-${(digest?.[1] ?? "").slice(0, 8)}`.replace(/-+$/, "");
  return `${short}-${Math.max(0, Math.trunc(stamp)).toString(36)}`;
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

// DR37: zero denotes unrestricted execution. The fields remain readable for
// historical v1 configuration and accepted specs; they impose no new limits.
const RESOURCES = Object.freeze({
  memoryBytes: 0, tasks: 0, cpuQuotaPercent: 0, tmpBytes: 0,
  workspaceBytes: 0, stagingBytes: 0, checkTimeoutSeconds: 0,
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
      // provider or credential of its own. Real usage bounds belong to the
      // engine.
      [DEFAULT_MODEL_PROFILE]: {
        provider: "pi",
        model: "current",
        inferenceTimeoutSeconds: 600,
      },
    },
    agentProfiles: {
      [DEFAULT_PRINCIPAL_PROFILE]: {
        modelProfile: DEFAULT_MODEL_PROFILE,
        // DR27: the host bootstraps seeds. The Principal reviews, communicates
        // and controls safety; ordinary creation belongs to Workers.
        capabilities: ["mail.send", "agent.manage.descendants", "context.publish"],
        delegable: [],
        childProfile: null,
        resources: { ...RESOURCES },
      },
      [DEFAULT_RESIDENT_PROFILE]: {
        // No code.integrate by default: canonical main stays a deliberate grant.
        modelProfile: DEFAULT_MODEL_PROFILE,
        capabilities: ["mail.send", "route.follow", "git.submit", "agent.manage.self", "agent.create", "agent.manage.descendants"],
        delegable: ["mail.send", "route.follow", "git.submit", "agent.manage.self", "agent.create", "agent.manage.descendants"],
        childProfile: DEFAULT_RESIDENT_PROFILE,
        resources: { ...RESOURCES },
      },
    },
    principalProfile: DEFAULT_PRINCIPAL_PROFILE,
    // LIFE-004: prepared by the host, activated only once GOAL is published.
    initialResidents: [{ name: "worker-1", profile: DEFAULT_RESIDENT_PROFILE,
      brief: "You have woken in an OMA society. Read /world/START.md for the map, then /inbox.md and the mail it lists. The shared objective is /world/context/current/GOAL.md -- find an unheld piece of it, say so on the board, and start." }],
    quota: {
      societyAgents: 0,
      lineageAgents: 0,
      storageBytes: 0,
    },
    integration: {
      policyRevision: "default-1",
      protectedPaths: [],
      tiered: { repositoryFloor: "LOW", highPeerFloor: 2, principalDelegated: true, rules: [], review: "mail-v1" },
      // Host-specific checks can be configured with complete resource limits.
      // Integrating remains a separate explicit Human grant in Config.
      checks: [],
    },
    limits: { ...LIMITS },
  };
}
