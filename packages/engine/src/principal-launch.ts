import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
/** Principal launch inputs, verified role profile and environment construction.
 * Session admission and child lifetime are owned by PrincipalSession. */
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ProtocolLimits } from "@oma/contracts";
import { SOCIETY_FENCE_ENV, SOCIETY_FENCE_FD } from "@oma/process/async";
import { HOST_CHANNEL_ENV, HOST_CHANNEL_FD } from "@oma/protocol/host-channel";
import { modelWorkspacePathAt, projectGitPathAt, runnerViewPathAt, sessionDirPathAt } from "@oma/domain/paths";
import { verifiedPaths } from "@oma/domain/extension-paths";
import { type VerifiedExtension } from "@oma/contracts/assets";
import { PI_AGENT_DIR_ENV } from "./pi-runtime.js";
import { storedMailBytes } from "@oma/domain/mail-values";
import { type PackageResourcePaths } from "@oma/contracts/assets";
import { PRINCIPAL_SYSTEM_PROMPT } from "@oma/domain/role-prompts";

export interface SessionPaths {
  readonly piCommand: string;
  readonly interactiveEntry?: string;
  /** DR24: the session file to reopen (`/resume`), when not the society's latest. */
  readonly sessionFile?: string;
  readonly project?: string;
  /** Arguments preceding Pi's own flags, e.g. the vendored bundle entry. */
  readonly piArgs?: readonly string[] | undefined;
  /** OMA-owned agent directory, isolating this engine from the user's own Pi. */
  readonly piAgentDir?: string | undefined;
  readonly coreExtension: string;
  readonly sessionDir: string;
  readonly workspace: string;
  readonly home: string;
  /** The society lease descriptor, inherited by the engine so that the society
   * cannot change hands while this engine is alive -- including when the host
   * is killed and runs no teardown (REC-007). Absent only where no lease
   * exists, which is every path that must not start an engine at all. */
  readonly fence?: number | undefined;
  /** D23/TSP-005: the surface plan's explicit hop into this engine, the same
   * channel the Resident arm declares on `RunnerProfile.toolSurface` (its
   * producer is the broker-owned runner launch environment, read once by the
   * runner entry). The Principal's host session carries the deployment's
   * principal plan -- oma-society.ts sets it -- so both roles run a declared
   * surface and a plan that names a missing tool refuses startup rather
   * than degrading it. It is never inherited and never authored
   * configuration. */
  readonly toolSurface?: string | undefined;
}

export interface SessionProfile {
  readonly society: string;
  readonly provider: string;
  readonly model: string;
  /** The Principal role's recorded extensions. The digest travels with the path
   * so it can be re-checked immediately before spawn, exactly as the Resident
   * path does. The core extension may appear here for verification; argv never
   * passes it twice. */
  readonly extensions: readonly VerifiedExtension[];
  /** DR25/C18: the installed packages' skills, prompt templates and themes, as
   * host paths inside the package store. Passed to the engine by flag, so the
   * resources reach Pi's loader rather than only being mounted. */
  readonly packageResources?: PackageResourcePaths | undefined;
  /** DR25/C18: the package store's real host root -- the same root
   * packageResourcePaths resolves the resources under. The trusted extension
   * permits reads beneath it; absent means no package store exists. */
  readonly packageStore?: string | undefined;
  /** The role's prompt, appended exactly as the Resident path appends it. A
   * Principal that silently ran without its role prompt would behave unlike the
   * configuration the operator wrote. */
  readonly prompt?: string | undefined;
}

/** Everything the Principal's engine is told about the society it belongs to.
 *
 * A Resident gets this from the runner, translated through its mount table. The
 * Principal is not confined and has no runner, so the product assembles it
 * here. The trusted extension registers OMA's mail and status tools only
 * when the society connection is complete (TUI-004).
 */
export interface PrincipalPaths {
  readonly stateRoot: string;
  readonly runRoot: string;
  readonly libdir: string;
}

/** A fresh handle per started session. It identifies the session, not the user
 * and not the society, so nothing about the deployment can be derived from it
 * and an old one names a session that no longer exists. */
export function newSessionHandle(): string { return randomBytes(16).toString("hex"); }

/** Where the Principal's engine keeps its session: under its own private
 * space, as PR-003 requires. The delivery receipt's validator asks the same
 * owner for this path, so keeping the Human's history private did not have to
 * be traded for a receipt the broker can check. */
export function principalSessionDir(stateRoot: string): string {
  return sessionDirPathAt(stateRoot, "principal");
}

/** The Principal's private scratch: where its model's tools work and, as for
 * a Resident's home, where its CLI keeps its request cache (FS-003). */
export function principalWorkspace(stateRoot: string): string {
  return modelWorkspacePathAt(stateRoot, "principal");
}

/** D25-style mirror: the trusted extension reads this name
 * (packages/tool-runtime/src/workspace-guard.ts; PI-001 keeps it from importing this
 * module) and a test binds the two spellings, as it does for TOOL_SCOPE_ENV. */
export const PACKAGE_STORE_ENV = "OMA_PACKAGE_STORE";

/** The environment the engine is started with.
 *
 * Nothing secret is in it. /proc/<pid>/environ is readable by any process of
 * this user, so the Principal's credential never enters an environment: it
 * reaches the engine on a private socket after the engine is running
 * (`OMA_HOST_CHANNEL` only names that descriptor). What is here is what the
 * trusted extension needs before it will register OMA's tools, allow a write,
 * or accept a delivery.
 */
export function principalEnvironment(
  paths: PrincipalPaths,
  profile: SessionProfile,
  limits: Pick<ProtocolLimits, "frameBytes" | "mailBodyBytes" | "batchMaxMessages" | "addresses" | "contextBytes" | "bundleBytes">,
): Record<string, string> {
  // FS-003: the CLI's cache is in the Principal's private scratch.
  const home = principalWorkspace(paths.stateRoot);
  return {
    HOME: home,
    PATH: "/usr/bin:/bin",
    OMA_ACTOR: "principal",
    OMA_SOCIETY: profile.society,
    OMA_SOCKET: join(paths.runRoot, "principal.sock"),
    OMA_AGENT_HOME: home,
    OMA_MAIL_ARCHIVE: join(paths.stateRoot, "mail", "archive", "cur"),
    // C18: the package store's real root, so the trusted extension can let the
    // model's reads reach the package skills its argv advertised -- read-only,
    // and nothing else of the host's.
    ...(profile.packageStore === undefined ? {} : { [PACKAGE_STORE_ENV]: profile.packageStore }),
    NODE_OPTIONS: `--import=${pathToFileURL(join(paths.libdir, DEPLOYMENT_LAYOUT.clientPreload)).href}`,
    // DR27: fixed read-only code views, never a model-facing shell.
    OMA_PROJECT_GIT: projectGitPathAt(paths.stateRoot),
    OMA_CONTEXT_GIT: join(paths.stateRoot, "repos", "context.git"),
    OMA_FRAME_BYTES: String(limits.frameBytes),
    // The mail tool reads stored messages, whose bound is not the body's (P0V-36).
    OMA_MAIL_BYTES: String(storedMailBytes(limits.mailBodyBytes)),
    // Its send schema names the wire's own recipient bound.
    OMA_MAIL_ADDRESSES: String(limits.addresses),
    // P0V-78: the streams the CLI prepares are read only up to these.
    OMA_CONTEXT_BYTES: String(limits.contextBytes),
    OMA_BUNDLE_BYTES: String(limits.bundleBytes),
    // PR-002: where the broker publishes the Principal's prepared batches, and
    // how large one may be. The host delivers them; the extension reads them.
    OMA_BATCH_VIEW: runnerViewPathAt(paths.stateRoot, "principal"),
    OMA_BATCH_MAX_MESSAGES: String(limits.batchMaxMessages),
    [HOST_CHANNEL_ENV]: String(HOST_CHANNEL_FD),
  };
}

/** Mirrors the Resident adapter's remaining blocking: approval prompts,
 * extension discovery and the shell/write tools stay suppressed (TUI-014).
 * Context files, skills and prompt templates are discovered and filtered by
 * the trusted extension instead (C15–C17).
 */
/** TUI-004: the Principal runs under the same role contract as a Resident —
 * its model, extensions, prompt and tool surface come from its role in the
 * configuration, never from defaults. An undeclared model is refused. */

export function sessionArgv(paths: SessionPaths, profile: SessionProfile): readonly string[] {
  const args = [
    "--mode", "rpc",
    "--no-approve",
    "--no-extensions",
    "--exclude-tools", "bash,powershell,write,edit",
    "--session-dir", paths.sessionDir,
    // AV14, PR-003/TUI-004: the Human's context stays in the existing session;
    // a new TUI run resumes the most recent one, or starts one when there is none.
    "--continue",
    "--name", `oma-${profile.society}-principal`,
    "-e", paths.coreExtension,
  ];
  for (const extension of verifiedPaths(profile.extensions))
    if (extension !== paths.coreExtension) args.push("-e", extension);
  // C18: package skills, prompt templates and themes ride the same flags the
  // engine's own CLI takes, so the loader owns their discovery.
  for (const skill of profile.packageResources?.skills ?? []) args.push("--skill", skill);
  for (const prompt of profile.packageResources?.prompts ?? []) args.push("--prompt-template", prompt);
  for (const theme of profile.packageResources?.themes ?? []) args.push("--theme", theme);
  if (!(profile.provider === "pi" && profile.model === "current"))
    args.push("--model", `${profile.provider}/${profile.model}`);
  // The role prompt replaces Pi's generated system prompt entirely: pi's base
  // describes a lone coding agent, not the Principal. An authored-empty role
  // runs on the built-in rather than on that default.
  args.push("--system-prompt",
    profile.prompt !== undefined && profile.prompt.length > 0 ? profile.prompt : PRINCIPAL_SYSTEM_PROMPT);
  return Object.freeze(args);
}

/** D25: mirrors `VERIFIED_EXTENSIONS_ENV` in packages/tool-runtime/src/provenance.ts --
 * the trusted extension's files may not be imported here, so a test binds the
 * two spellings, as it does for TOOL_SCOPE_ENV (INV04). */
const VERIFIED_EXTENSIONS_ENV = "OMA_VERIFIED_EXTENSIONS";

/** Mirrors the runner→Resident plumbing spelling in src/runtime/pi-spawn-plan.ts --
 * the trusted extension's files may not be imported here either. */
const TOOL_SURFACE_ENV = "OMA_TOOL_SURFACE";

/** The environment only the engine sees: which extension paths were
 * digest-verified for this role, so the core extension can authorize tools by
 * provenance rather than by name (D25). The list is exactly the `-e` argv --
 * the core extension first, then the role's extensions -- in the same
 * spelling the engine's source metadata reports. */
export function sessionEnv(
  base: Readonly<Record<string, string>>,
  profile: SessionProfile,
  paths?: Partial<Pick<SessionPaths, "piAgentDir" | "fence" | "coreExtension" | "toolSurface">>,
): Record<string, string> {
  // D23/TSP-005: the surface plan travels only the declared hop -- the
  // broker-owned runner launch environment for Residents, this paths field for
  // a host engine. A stray OMA_TOOL_SURFACE in the user's shell must not
  // reach the Principal's host engine -- where a malformed plan would exit(1)
  // at session_start and a crafted-valid one would narrow its tools -- so
  // the inherited set never carries it.
  const { OMA_TOOL_SURFACE: _ambientToolSurface, ...inherited } = base;
  return {
    ...inherited,
    ...(paths?.coreExtension === undefined ? {} : {
      [VERIFIED_EXTENSIONS_ENV]: JSON.stringify([
        paths.coreExtension,
        ...verifiedPaths(profile.extensions).filter(extension => extension !== paths.coreExtension),
      ]),
    }),
    ...(paths?.piAgentDir === undefined ? {} : { [PI_AGENT_DIR_ENV]: paths.piAgentDir }),
    // REC-007: the engine is told which of its descriptors is the society
    // lease, because the engine starts children of its own -- the model-facing
    // CLI, which writes this society's private state -- and a child started
    // without the lease can outlive it. The number is the child's view of the
    // descriptor, not this process's, and it names a descriptor rather than
    // carrying a secret: a process that does not already hold it gains nothing
    // by reading it in /proc.
    ...(paths?.fence === undefined ? {} : { [SOCIETY_FENCE_ENV]: String(SOCIETY_FENCE_FD) }),
    // The explicit plumbing hop emits after the ambient strip, so a plan a
    // spawn plan deliberately carries reaches the engine while anything merely
    // inherited does not.
    ...(paths?.toolSurface === undefined ? {} : { [TOOL_SURFACE_ENV]: paths.toolSurface }),
  };
}
