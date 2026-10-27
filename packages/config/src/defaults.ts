/** First-run configuration so `oma` works in a directory with no setup.
 *
 * Anything the engine already owns stays the engine's. Signing in, choosing a
 * model and remembering that choice are Pi's own flows, and OMA does not
 * rebuild them: the initial model profiles here resolve to "whatever connection
 * the engine currently has", so the first run prompts exactly the way the
 * engine normally would.
 *
 * What remains is OMA's own domain, which Pi has no concept of: the society,
 * per-role capabilities and activation policy. Those get conservative
 * values here rather than a setup command, and all of them are visible and
 * editable in the Control Panel (CFG-002, arch §23.6).
 */
import type { HostConfig } from "@oma/contracts";
import { HOST_CONFIGURATION_VERSION } from "@oma/domain/config-format";
import { StoreError } from "@oma/domain/errors";

export const DEFAULT_PRINCIPAL_PROFILE = "principal";
export const DEFAULT_RESIDENT_PROFILE = "resident";
export const DEFAULT_MODEL_PROFILE = "default";
export const DEFAULT_WORKER_MODEL_PROFILE = "worker";

export interface DefaultConfigInput {
  readonly society: string;
  readonly node: string;
  readonly libdir: string;
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

import { REFERENCE_PROTOCOL_LIMITS } from "@oma/domain/protocol-limits";

export function defaultHostConfig(input: DefaultConfigInput): HostConfig {
  if (input.society.length === 0)
    throw new StoreError("INVALID_REQUEST", "a default configuration needs a society name");
  return {
    schemaVersion: HOST_CONFIGURATION_VERSION,
    society: input.society,
    installation: {
      node: input.node,
      libdir: input.libdir,
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
      [DEFAULT_WORKER_MODEL_PROFILE]: { provider: "pi", model: "current", inferenceTimeoutSeconds: 600 },
    },
    agentProfiles: {
      [DEFAULT_PRINCIPAL_PROFILE]: {
        modelProfile: DEFAULT_MODEL_PROFILE,
        // DR27: the host bootstraps seeds. The Principal reviews, communicates
        // and controls safety; ordinary creation belongs to Workers.
        capabilities: ["mail.send", "agent.manage.descendants", "context.publish"],
        delegable: [],
        childProfile: null,
      },
      [DEFAULT_RESIDENT_PROFILE]: {
        // A stable, separate reference: Worker edits change its contents.
        modelProfile: DEFAULT_WORKER_MODEL_PROFILE,
        capabilities: ["mail.send", "route.follow", "git.submit", "agent.manage.self", "agent.create", "agent.manage.descendants"],
        delegable: ["mail.send", "route.follow", "git.submit", "agent.manage.self", "agent.create", "agent.manage.descendants"],
        childProfile: DEFAULT_RESIDENT_PROFILE,
      },
    },
    principalProfile: DEFAULT_PRINCIPAL_PROFILE,
    // LIFE-004: prepared by the host, activated only once GOAL is published.
    initialResidents: [{ name: "worker-1", profile: DEFAULT_RESIDENT_PROFILE,
      brief: "You have woken in an OMA society. Read /world/START.md for the map, then /inbox.md and the mail it lists. The shared objective is /world/context/current/GOAL.md -- find an unheld piece of it, say so on the board, and start." }],
    integration: {
      policyRevision: "default-1",
      protectedPaths: [],
      tiered: { repositoryFloor: "LOW", highPeerFloor: 2, principalDelegated: true, rules: [] },
      // Host-specific checks declare their executable, arguments and environment.
      // Integrating remains a separate explicit Human grant in Config.
      checks: [],
    },
    limits: { ...REFERENCE_PROTOCOL_LIMITS },
  };
}
