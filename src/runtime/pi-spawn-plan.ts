/** How a Pi engine process is started — the argv, environment and working
 * directory — decided without starting anything.
 *
 * Kept apart from the delivery lifecycle in `pi-adapter.ts` so the plan can be
 * read and tested as data: whether a Resident is confined, what it is told
 * about its paths, and what reaches its environment are all visible here, and
 * none of it depends on a process having been spawned.
 */
import type { Actor, ProtocolLimits } from "../../implementation/contracts.js";
import { verifiedPaths, type VerifiedExtension } from "./extension-integrity.js";
import { PI_AGENT_DIR_ENV } from "./pi-runtime.js";
import { join } from "node:path";
import { RESIDENT_INFERENCE_PORT, RESIDENT_PATHS, SANDBOX_EXECUTABLE, confinedPath, residentArgv, type ResidentDirectories, type SandboxHost } from "../sandbox.js";
import type { ValidatedRunLease } from "../protocol/run-lease.js";
import { StoreError } from "../domain/errors.js";
import { storedMailBytes } from "../domain/mail-values.js";
import { assertModelScope } from "../storage/paths.js";
import { sandboxSeccompFilter } from "./sandbox-seccomp.js";

/** Everything the adapter needs to run the engine inside the Resident sandbox.
 * Its absence is the unconfined profile, which the runner states explicitly. */
export interface PiConfinement {
  /** `libdir` is a host path; `node` and `pi` are paths inside the sandbox. */
  readonly host: SandboxHost;
  readonly lease: ValidatedRunLease;
  /** Host mount roots, checked against the actor's trusted roots by the builder. */
  readonly directories: ResidentDirectories;
  /** INF-005/006/008: the relay's host socket, the provider and model it
   * stands in for, and the placeholder key the engine inside is given. */
  readonly inference?: PiInference | undefined;
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
  readonly workspaceBytes: number;
  /** Recorded at configuration load and re-verified immediately before spawn.
   * The digest travels with the path so the check cannot be skipped here. */
  readonly extensions: readonly VerifiedExtension[];
  /** TSP-005: the validated projection for this role, or null to show every
   * registered tool. The adapter forwards it; it never computes one. */
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
    | "contextBytes"
    | "bundleBytes"
  >;
  /** When present the engine runs confined. `paths` stays host-side so the file
   * checks and digest verification below still read the real files; the argv
   * and environment handed to the engine are translated through the mount
   * table, so there is one authority for where a file is and one for what the
   * engine is told. */
  readonly confinement?: PiConfinement | undefined;
}

export interface PiSpawnPlan {
  readonly command: string;
  readonly args: string[];
  readonly cwd: string;
  readonly env: Record<string, string>;
  /** A confined engine's sandbox filter: the bytes descriptor 3 carries to
   * bubblewrap (SANDBOX_FILTER_FD, DR18). */
  readonly filter?: Uint8Array;
}

/** Maps a host path to the path the engine is told. Identity when the engine
 * runs on the host; the mount translation when it runs confined. */
type PathView = (hostPath: string) => string;

function pathView(options: PiAdapterOptions): PathView {
  const confinement = options.confinement;
  if (confinement === undefined) return path => path;
  return path =>
    // The lease socket is bind-mounted at a fixed path rather than under one of
    // the directory roots, so it is the one entry the table cannot resolve.
    path === confinement.lease.socketHostPath
      ? RESIDENT_PATHS.socket
      : confinedPath(confinement.host, confinement.directories, path);
}

/** AV13: set in a confined engine's environment, and nowhere else. The trusted
 * extension mirrors these two values (workspace-guard.ts; PI-001 keeps it from
 * importing this module) and a test binds the mirror to them (INV04). */
export const TOOL_SCOPE_ENV = "OMA_TOOL_SCOPE";
export const TOOL_SCOPE_SANDBOX = "sandbox";

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
    // P0V-78: the streams the CLI prepares are read only up to these.
    OMA_CONTEXT_BYTES: String(options.limits.contextBytes),
    OMA_BUNDLE_BYTES: String(options.limits.bundleBytes),
    OMA_WORKSPACE_BYTES: String(options.profile.workspaceBytes),
    OMA_MAIL_ARCHIVE: inside(options.paths.mailArchive),
    OMA_AGENT_HOME: inside(options.paths.agentHome),
    OMA_CLI_PATH: inside(options.paths.cli),
    ...(options.profile.toolSurface === undefined
      ? {}
      : { OMA_TOOL_SURFACE: options.profile.toolSurface }),
  };
}

/** Environment for an engine spawned directly on the host. The confined spawn
 * does not use this: `--clearenv` means its environment is its argv. */
function childEnvironment(options: PiAdapterOptions): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env))
    if (value !== undefined) env[key] = value;
  for (const key of [
    "PI_SESSION_ID",
    "PI_SESSION_FILE",
    "PI_SESSION_CWD",
    "PI_SESSION_REASON",
  ] as const)
    delete env[key];
  return Object.assign(env, omaEnvironment(options, path => path), {
    ...(options.paths.piAgentDir === undefined ? {} : { [PI_AGENT_DIR_ENV]: options.paths.piAgentDir }),
  });
}
function engineArgv(options: PiAdapterOptions, inside: PathView = path => path): string[] {
  const args = [
    "--mode",
    "rpc",
    "--no-approve",
    "--no-context-files",
    "--no-skills",
    "--no-prompt-templates",
    "--no-extensions",
    // AV13: a confined Resident works with the shell its sandbox provides
    // (SB-001: the rootfs holds Git and a shell; arch §11.1 and CLI-001: it
    // commits and runs `oma` there, as its START tells it). An engine outside a
    // sandbox -- an unsealed deployment -- keeps the shell excluded, like the
    // Principal (PR-004).
    ...(options.confinement === undefined ? ["--exclude-tools", "bash,powershell"] : []),
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
  // A confined engine resolves nothing on its own: the host named the model
  // when it resolved the credential, and that is the model it runs.
  const relay = options.confinement?.inference;
  if (relay !== undefined) args.push("--model", `${relay.provider}/${relay.model}`);
  else if (
    !(options.profile.provider === "pi" && options.profile.model === "current")
  )
    args.push(
      "--model",
      `${options.profile.provider}/${options.profile.model}`,
    );
  if (options.profile.thinking !== undefined) args.push("--thinking", options.profile.thinking);
  if (options.profile.prompt.length > 0)
    args.push("--append-system-prompt", options.profile.prompt);
  return args;
}

/** The two branches differ only in whether the mount plan wraps the command,
 * so the argv the engine receives is built once. */
export function planPiSpawn(options: PiAdapterOptions): PiSpawnPlan {
  // PR-004/SB-006, the same rule as the Principal's: the model's workspace
  // holds none of the engine's session history, its home (the confined
  // engine's own settings live there), its batch views or its credentials.
  assertModelScope(options.paths.workspace, [options.paths.sessionDir, options.paths.agentHome, options.paths.batchView,
    ...(options.paths.piAgentDir === undefined ? [] : [options.paths.piAgentDir])]);
  const confinement = options.confinement;
  if (confinement === undefined)
    return {
      command: options.paths.piCommand,
      args: [...(options.paths.piArgs ?? []), ...engineArgv(options)],
      cwd: options.paths.workspace,
      env: childEnvironment(options),
    };
  const inside = pathView(options);
  // `residentArgv` appends `node pi <piModeArgs>` itself, so the engine flags
  // travel as the host's Pi arguments and the entry is `host.pi`.
  const host = { ...confinement.host, piModeArgs: engineArgv(options, inside) };
  // The engine's own agent directory holds provider credentials, so PR-004
  // keeps it out of this mount plan (INF-007). The engine reaches a provider
  // through the relay socket instead, and the credential stays on the host.
  const relay = confinement.inference;
  const environment = {
    ...omaEnvironment(options, inside),
    [PI_AGENT_DIR_ENV]: inside(join(options.paths.agentHome, "engine")),
    // The trusted extension's one statement of where it runs: inside the
    // sandbox, the mount plan is the boundary of its tools (TSP-009).
    [TOOL_SCOPE_ENV]: TOOL_SCOPE_SANDBOX,
    ...(relay === undefined ? {} : {
      OMA_INFERENCE_SOCKET: RESIDENT_PATHS.inference,
      OMA_INFERENCE_PROVIDER: relay.provider,
      OMA_INFERENCE_PORT: String(RESIDENT_INFERENCE_PORT),
      OMA_INFERENCE_KEY: relay.placeholder,
    }),
  };
  const plan = residentArgv(host, confinement.lease, confinement.directories,
    environment, relay?.socketHostPath);
  // WP27: the delivery path starts this plan through the owned spawn, which
  // takes only an absolute executable; a bare `bwrap` was refused there, so no
  // confined Resident could ever deliver a batch.
  if (plan[0] !== "bwrap") throw new StoreError("UNSUPPORTED_PROFILE", "resident sandbox recipe does not start bubblewrap");
  return { command: SANDBOX_EXECUTABLE, args: plan.slice(1), cwd: options.paths.workspace, env: {}, filter: sandboxSeccompFilter() };
}
