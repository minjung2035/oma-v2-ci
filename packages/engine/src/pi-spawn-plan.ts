import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
/** How a Pi engine process is started — the argv, environment and working
 * directory — decided without starting anything.
 *
 * Kept apart from the delivery lifecycle in `pi-adapter.ts` so the plan can be
 * read and tested as data: whether a Resident is confined, what it is told
 * about its paths, and what reaches its environment are all visible here, and
 * none of it depends on a process having been spawned.
 */
import type { Actor, ProtocolLimits } from "@oma/contracts";
import { verifiedPaths } from "@oma/domain/extension-paths";
import { type VerifiedExtension } from "@oma/contracts/assets";
import type { PackageResourcePaths } from "@oma/contracts/assets";
import { PI_AGENT_DIR_ENV } from "./pi-runtime.js";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { RESIDENT_EGRESS_PORT, RESIDENT_INFERENCE_PORT } from "@oma/domain/resident-paths";
import type { ResidentSandbox, PiSpawnPlan } from "./ports.js";
import { type SandboxDirectories as ResidentDirectories, type SandboxHost, type PathView as ResidentPathView } from "@oma/contracts/runtime";
import type { ValidatedRunLease } from "@oma/protocol/run-lease";
import { StoreError } from "@oma/domain/errors";
import { storedMailBytes } from "@oma/domain/mail-values";
import { assertModelScope } from "@oma/domain/paths";
import { RESIDENT_SYSTEM_PROMPT } from "@oma/domain/role-prompts";
import { actorAddress } from "@oma/domain/actor-address";

/** Everything the adapter needs to run the engine inside the Resident sandbox.
 * Every Resident requires it; its absence is an unsupported profile. */
export interface PiConfinement {
  /** `libdir` is a host path; `node` and `pi` are paths inside the sandbox. */
  readonly host: SandboxHost;
  readonly lease: ValidatedRunLease;
  /** Host mount roots, checked against the actor's trusted roots by the builder. */
  readonly directories: ResidentDirectories;
  /** INF-005/006/008: the relay's host socket, the provider and model it
   * stands in for, and the placeholder key the engine inside is given. */
  readonly inference?: PiInference | undefined;
  /** UX-08/DR34: the CONNECT proxy's socket this delivery opened, bound at
   * RESIDENT_PATHS.egress. Absent -- a Human configured no egress for this
   * role -- and the Resident gets no proxy variables at all. */
  readonly egress?: PiEgress | undefined;
}
export interface PiEgress {
  readonly socketHostPath: string;
}
export interface PiInference {
  readonly socketHostPath: string;
  readonly provider: string;
  /** The concrete model. A confined engine has no settings of its own, so
   * "whatever the engine would pick" is resolved on the host and named here. */
  readonly model: string;
  /** Same shape as the real key, swapped back by the relay on the way out. */
  readonly placeholder: string;
  /** DR24: the engine's default effort, resolved on the host with the model. */
  readonly thinking?: string | undefined;
}

export interface PiAdapterProfile {
  readonly provider: string;
  readonly model: string;
  /** DR27/WP10: silence during one inference or compaction, not the sum of
   * a delivery's model requests and tools. Progress restarts this budget. */
  readonly inferenceSeconds: number;
  readonly prompt: string;
  /** DR24: the effort the engine runs with -- the profile's, else the engine's default. */
  readonly thinking?: string | undefined;
  /** Recorded at configuration load and re-verified immediately before spawn.
   * The digest travels with the path so the check cannot be skipped here. */
  readonly extensions: readonly VerifiedExtension[];
  /** DR25/C18: the installed packages' skills, prompt templates and themes, as
   * host paths inside the package store. The engine gets them by flag, so the
   * resources reach Pi's loader rather than only being mounted. */
  readonly packageResources?: PackageResourcePaths | undefined;
  /** TSP-005: the validated surface plan the trusted runtime hands the engine,
   * encoded; absent means the role's provenance filter alone decides. It is
   * runtime plumbing, never authored configuration (D23). */
  readonly toolSurface?: string | undefined;
}
export interface PiAdapterPaths {
  readonly piCommand: string;
  /** Arguments preceding Pi's own flags, e.g. the vendored bundle entry when
   * the engine is run through Node. Empty for a host-pinned executable. */
  readonly piArgs?: readonly string[] | undefined;
  /** OMA-owned agent directory. Keeps this engine's configuration, extensions
   * and sessions separate from any Pi the user installed. */
  readonly piAgentDir?: string | undefined;
  readonly coreExtension: string;
  readonly cli: string;
  readonly workspace: string;
  readonly sessionDir: string;
  readonly agentHome: string;
  readonly mailArchive: string;
  /** mail-v1: worker-only review mail archive (S/mail/workers/cur). */
  readonly workerArchive: string;
  /** The society's canonical repository, read-only to a Resident (oma merge). */
  readonly projectGit: string;
  readonly batchView: string;
  readonly socket: string;
}
export interface PiAdapterOptions {
  readonly actor: Actor;
  readonly society: string;
  readonly paths: PiAdapterPaths;
  readonly profile: PiAdapterProfile;
  readonly limits: Pick<
    ProtocolLimits,
    | "frameBytes"
    | "idleStreamSeconds"
    | "receiptWaitSeconds"
    | "batchMaxMessages"
    | "mailBodyBytes"
    | "addresses"
    | "contextBytes"
    | "bundleBytes"
  >;
  /** The engine always runs confined. `paths` stays host-side so the file
   * checks and digest verification below still read the real files; the argv
   * and environment handed to the engine are translated through the mount
   * table, so there is one authority for where a file is and one for what the
   * engine is told. */
  readonly confinement: PiConfinement;
}

export type { PiSpawnPlan } from "./ports.js";

/** Maps a host path to the path the engine is told, exclusively through
 * the confined Resident's mount translation. */
type PathView = (hostPath: string) => string;

/** AV13: set in a confined engine's environment, and nowhere else. The trusted
 * extension mirrors these two values (workspace-guard.ts; PI-001 keeps it from
 * importing this module) and a test binds the mirror to them (INV04). */
export const TOOL_SCOPE_ENV = "OMA_TOOL_SCOPE";
export const TOOL_SCOPE_SANDBOX = "sandbox";

/** D25: mirrors `VERIFIED_EXTENSIONS_ENV` in packages/tool-runtime/src/provenance.ts --
 * the same mirror discipline as TOOL_SCOPE_ENV above. */
export const VERIFIED_EXTENSIONS_ENV = "OMA_VERIFIED_EXTENSIONS";

/** The entries the trusted core extension reads. Nothing else is OMA's to set. */
function omaEnvironment(options: PiAdapterOptions, inside: PathView): Record<string, string> {
  return {
    OMA_ACTOR: options.actor,
    OMA_SOCIETY: options.society,
    OMA_SOCKET: inside(options.paths.socket),
    OMA_BATCH_VIEW: inside(options.paths.batchView),
    OMA_FRAME_BYTES: String(options.limits.frameBytes),
    OMA_BATCH_MAX_MESSAGES: String(options.limits.batchMaxMessages),
    // The mail tool reads stored messages, whose bound is not the body's (P0V-36).
    OMA_MAIL_BYTES: String(storedMailBytes(options.limits.mailBodyBytes)),
    // Its send schema names the wire's own recipient bound.
    OMA_MAIL_ADDRESSES: String(options.limits.addresses),
    // P0V-78: the streams the CLI prepares are read only up to these.
    OMA_CONTEXT_BYTES: String(options.limits.contextBytes),
    OMA_BUNDLE_BYTES: String(options.limits.bundleBytes),
    OMA_MAIL_ARCHIVE: inside(options.paths.mailArchive),
    // mail-v1: only Resident engines reach this builder; the Principal's host
    // engine is composed in tui/session.ts and gets neither of these.
    OMA_WORKER_ARCHIVE: inside(options.paths.workerArchive),
    OMA_PROJECT_GIT: inside(options.paths.projectGit),
    OMA_AGENT_HOME: inside(options.paths.agentHome),
    // DR25/C18: the package store's root as the confined engine sees it -- the
    // same mount translation every other env path takes, so the trusted
    // extension's readable roots are the same contract on host and inside. A
    // store the mount plan stopped carrying is refused by `inside`, not named.
    ...(options.confinement.host.packages === undefined ? {}
      : { OMA_PACKAGE_STORE: inside(options.confinement.host.packages) }),
    ...(options.profile.toolSurface === undefined ? {} : { OMA_TOOL_SURFACE: options.profile.toolSurface }),
    // D25: the extension paths this engine's `-e` argv carries, in the same
    // spelling -- the trusted extension authorizes tools by this provenance,
    // never by name (AV13 mirrors the constant; PI-001 keeps it import-free).
    [VERIFIED_EXTENSIONS_ENV]: JSON.stringify([
      inside(options.paths.coreExtension),
      ...verifiedPaths(options.profile.extensions)
        .filter(extension => extension !== options.paths.coreExtension)
        .map(inside),
    ]),
    // The extension reaches the broker through the in-process client library
    // (E27); the preload wires it before any extension module loads.
    NODE_OPTIONS: `--import=${pathToFileURL(inside(join(options.confinement.host.libdir, DEPLOYMENT_LAYOUT.clientPreload))).href}`,
  };
}

/** What the Resident's own commands read, beside the entries above.
 *
 * FI-1: Git commits as the actor, at the address its mail carries, so a
 * commit needs no `-c user.*` (the editor and prompt are RESIDENT_ENVIRONMENT's).
 *
 * DR37: there is no OMA CPU/memory/task hint or execution quota. */
function residentGitIdentity(options: PiAdapterOptions, actor: Actor): Record<string, string> {
  const address = actorAddress(actor, options.society);
  return {
    GIT_AUTHOR_NAME: actor, GIT_AUTHOR_EMAIL: address,
    GIT_COMMITTER_NAME: actor, GIT_COMMITTER_EMAIL: address,
  };
}

/** The confined spawn uses only its explicit environment in the argv.
 * `--clearenv` prevents inheritance from the host process. */
function engineArgv(options: PiAdapterOptions, inside: PathView): string[] {
  const args = [
    "--mode",
    "rpc",
    "--no-approve",
    "--no-extensions",
    // AV13: a confined Resident works with the shell its sandbox provides
    // (SB-001: the rootfs holds Git and a shell; arch §11.1 and CLI-001: it
    // commits and runs `oma` there, as its START tells it). Every Resident is
    // confined; the Principal's separate host engine keeps the shell excluded
    // through its own argv builder (PR-004).
    "--session-dir",
    inside(options.paths.sessionDir),
    // AV14, arch §7: the runner joins one Pi session to the mail queue, and an
    // activation resumes it ("resume Pi session or create a new session"): the most recent
    // session in this directory, or a new one when there is none.
    "--continue",
    "--name",
    `oma-${options.society}-${options.actor}`,
    "-e",
    inside(options.paths.coreExtension),
  ];
  // The core extension is already first; the recorded list may also contain it
  // so that its digest is verified, but it is never passed twice. Comparison is
  // on the host path, before translation, because that is what was verified.
  for (const extension of verifiedPaths(options.profile.extensions))
    if (extension !== options.paths.coreExtension) args.push("-e", inside(extension));
  // C18: package skills, prompt templates and themes ride the same flags the
  // engine's own CLI takes, so the loader owns their discovery. The mount plan
  // translates the store's host paths for a confined engine.
  for (const skill of options.profile.packageResources?.skills ?? []) args.push("--skill", inside(skill));
  for (const prompt of options.profile.packageResources?.prompts ?? []) args.push("--prompt-template", inside(prompt));
  for (const theme of options.profile.packageResources?.themes ?? []) args.push("--theme", inside(theme));
  // A confined engine resolves nothing on its own: the host named the model
  // when it resolved the credential, and that is the model it runs.
  const relay = options.confinement.inference;
  if (relay !== undefined) args.push("--model", `${relay.provider}/${relay.model}`);
  else if (
    !(options.profile.provider === "pi" && options.profile.model === "current")
  )
    args.push(
      "--model",
      `${options.profile.provider}/${options.profile.model}`,
    );
  if (options.profile.thinking !== undefined) args.push("--thinking", options.profile.thinking);
  // The role prompt is the engine's whole system prompt: pi's generated base
  // describes a lone coding agent, not a Resident. An authored-empty role runs
  // on the built-in rather than on that default.
  args.push("--system-prompt",
    options.profile.prompt.length > 0 ? options.profile.prompt : RESIDENT_SYSTEM_PROMPT);
  return args;
}

/** Every Resident command is wrapped in the sandbox mount plan,
 * with one builder for the argv the engine receives. */
export function planPiSpawn(sandbox: ResidentSandbox, options: PiAdapterOptions, preparedView?: ResidentPathView): PiSpawnPlan {
  if (options.confinement === undefined)
    throw new StoreError("UNSUPPORTED_PROFILE", "Resident execution requires confinement");
  // PR-004/SB-006, the same rule as the Principal's: the model's workspace
  // holds none of the engine's session history, its home (the confined
  // engine's own settings live there), its batch views or its credentials.
  assertModelScope(options.paths.workspace, [options.paths.sessionDir, options.paths.agentHome, options.paths.batchView,
    ...(options.paths.piAgentDir === undefined ? [] : [options.paths.piAgentDir])]);
  const confinement = options.confinement;
  const view = preparedView ?? sandbox.pathView(confinement.host, confinement.lease, confinement.directories, {
    ...(confinement.inference === undefined ? {} : { inference: confinement.inference.socketHostPath }),
    ...(confinement.egress === undefined ? {} : { egress: confinement.egress.socketHostPath }),
  });
  const inside: PathView = path => view.map(path);
  // `residentArgv` appends `node pi <piModeArgs>` itself, so the engine flags
  // travel as the host's Pi arguments and the entry is `host.pi`.
  const host = { ...confinement.host, piModeArgs: engineArgv(options, inside) };
  // The engine's own agent directory holds provider credentials, so PR-004
  // keeps it out of this mount plan (INF-007). The engine reaches a provider
  // through the relay socket instead, and the credential stays on the host.
  const relay = confinement.inference;
  const environment = {
    // The lease's actor, the one `residentArgv` sets OMA_ACTOR to.
    ...residentGitIdentity(options, confinement.lease.actor),
    ...omaEnvironment(options, inside),
    [PI_AGENT_DIR_ENV]: inside(join(options.paths.agentHome, "engine")),
    // The trusted extension's one statement of where it runs: inside the
    // sandbox, the mount plan is the boundary of its tools (TSP-009).
    [TOOL_SCOPE_ENV]: TOOL_SCOPE_SANDBOX,
    ...(relay === undefined ? {} : {
      OMA_INFERENCE_SOCKET: inside(relay.socketHostPath),
      OMA_INFERENCE_PROVIDER: relay.provider,
      OMA_INFERENCE_PORT: String(RESIDENT_INFERENCE_PORT),
      OMA_INFERENCE_KEY: relay.placeholder,
    }),
    // UX-08/DR34: the proxy variables every package manager and HTTPS Git
    // read -- the extension's loopback forwarder of the bound proxy socket.
    // NO_PROXY keeps the engine's own loopback (the inference bridge) direct;
    // These values route cooperating clients through the injected bridge;
    // the production recipe shares the host network and imposes no
    // namespace-based egress restriction.
    ...(confinement.egress === undefined ? {} : {
      OMA_EGRESS_PROXY_SOCKET: inside(confinement.egress.socketHostPath),
      OMA_EGRESS_PROXY_PORT: String(RESIDENT_EGRESS_PORT),
      HTTP_PROXY: `http://127.0.0.1:${RESIDENT_EGRESS_PORT}`,
      http_proxy: `http://127.0.0.1:${RESIDENT_EGRESS_PORT}`,
      HTTPS_PROXY: `http://127.0.0.1:${RESIDENT_EGRESS_PORT}`,
      https_proxy: `http://127.0.0.1:${RESIDENT_EGRESS_PORT}`,
      ALL_PROXY: `http://127.0.0.1:${RESIDENT_EGRESS_PORT}`,
      all_proxy: `http://127.0.0.1:${RESIDENT_EGRESS_PORT}`,
      NO_PROXY: "127.0.0.1,localhost,::1",
      no_proxy: "127.0.0.1,localhost,::1",
    }),
  };
  return sandbox.residentPlan(host, confinement.lease, confinement.directories,
    environment, relay?.socketHostPath, confinement.egress?.socketHostPath);
}
