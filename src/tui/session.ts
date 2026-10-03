/** TUI-004/014: the Principal Pi session that the product owns.
 *
 * The Principal uses Open TUI or the headless RPC test/adapter path. Both
 * keep run admission here; interactive rendering adds no model authority.
 * Skills, prompt templates and context files are discovered as Pi ships them
 * (C15-C17); the trusted extension, not the launcher, owns what of that the
 * model's prompt and tools may show. Shell and write tools stay excluded.
 * Peer content is never dressed as a Human turn.
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { ProtocolLimits } from "../../implementation/contracts.js";
import { SOCIETY_FENCE_ENV, SOCIETY_FENCE_FD, stopOwnedChild, spawnOwnedRpc, spawnOwnedInteractive, type ChildProcess } from "../process/async.js";
import { InteractiveChannel, INTERACTIVE_RPC_FD, INTERACTIVE_UI_FD } from "../runtime/interactive-channel.js";
import type { FencedEngine } from "../runtime/host-tenure.js";
import type { PiRpcStreams } from "../runtime/pi-rpc.js";
import { DEPLOYMENT_LAYOUT } from "../domain/deployment.js";
import type { Socket } from "node:net";
import { HOST_CHANNEL_ENV, HOST_CHANNEL_FD, encodeHostMessage } from "../protocol/host-channel.js";
import { assertModelScope, modelWorkspacePathAt, projectGitPathAt, runnerViewPathAt, sessionDirPathAt } from "../storage/paths.js";
import { PiRpcClient, SKIPPED_EVENT, alarm, assertPiRpcLimits, commandWasNotWritten, type PiEvent, type PiRpcLimits } from "../runtime/pi-rpc.js";
import { assertExtensionIntegrity, verifiedPaths, type VerifiedExtension } from "../runtime/extension-integrity.js";
import { PI_AGENT_DIR_ENV, preparePiRetry } from "../runtime/pi-runtime.js";
import { loadConfiguration } from "../config.js";
import { StoreError } from "../domain/errors.js";
import { errorWords } from "./words.js";
import { storedMailBytes } from "../domain/mail-values.js";
import { packageResourcePaths, type PackageResourcePaths } from "../runtime/pi-packages.js";
import { CONVERSATION_BOUNDS, TERMINAL_BOUNDS, humanPromptFitsFrame, humanPromptRequestId } from "./limits.js";
import type { PromptOutcome } from "./prompt.js";
import { PRINCIPAL_SYSTEM_PROMPT } from "../config/role-prompts.js";

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
  /** The role's prompt, appended exactly as the Resident path appends it. A
   * Principal that silently ran without its role prompt would behave unlike the
   * configuration the operator wrote. */
  readonly prompt?: string | undefined;
  /** The role's workspace quota. The trusted extension refuses every write and
   * edit until it knows one, so a Principal started without it could not write
   * in its own private space. */
  readonly workspaceBytes: number;
}

/** Everything the Principal's engine is told about the society it belongs to.
 *
 * A Resident gets this from the runner, translated through its mount table. The
 * Principal is not confined and has no runner, so the product assembles it
 * here — and it has to be assembled: the trusted extension registers OMA's mail
 * and status tools only when it is complete, and refuses writes without the
 * quota, so a session started with a bare `HOME` and `PATH` is an engine that
 * can neither reach the society nor write a file (TUI-004).
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
  limits: Pick<ProtocolLimits, "frameBytes" | "mailBodyBytes" | "batchMaxMessages" | "contextBytes" | "bundleBytes">,
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
    OMA_CLI_PATH: join(paths.libdir, DEPLOYMENT_LAYOUT.cli),
    // DR27: fixed read-only code views, never a model-facing shell.
    OMA_PROJECT_GIT: projectGitPathAt(paths.stateRoot),
    OMA_CONTEXT_GIT: join(paths.stateRoot, "repos", "context.git"),
    OMA_FRAME_BYTES: String(limits.frameBytes),
    // The mail tool reads stored messages, whose bound is not the body's (P0V-36).
    OMA_MAIL_BYTES: String(storedMailBytes(limits.mailBodyBytes)),
    // P0V-78: the streams the CLI prepares are read only up to these.
    OMA_CONTEXT_BYTES: String(limits.contextBytes),
    OMA_BUNDLE_BYTES: String(limits.bundleBytes),
    OMA_WORKSPACE_BYTES: String(profile.workspaceBytes),
    // PR-002: where the broker publishes the Principal's prepared batches, and
    // how large one may be. The host delivers them; the extension reads them.
    OMA_BATCH_VIEW: runnerViewPathAt(paths.stateRoot, "principal"),
    OMA_BATCH_MAX_MESSAGES: String(limits.batchMaxMessages),
    [HOST_CHANNEL_ENV]: String(HOST_CHANNEL_FD),
  };
}

export interface SessionSink {
  /** P0-4: ownership begins before fallible RPC/UI setup, not at constructor return. */
  readonly onAcquire?: (engine: FencedEngine) => void;
  readonly onLine: (line: string) => void;
  readonly onUi?: (event: PiEvent) => void;
  readonly onBusy: (busy: boolean) => void;
  readonly onEnd: (reason: string) => void;
  /** One named prompt did not reach the engine, with the text it was.
   *
   * `reason` is the bare cause, not a sentence: the surface says what failed
   * and where the text went, and a second copy of "could not be sent" here
   * would push that answer off a narrow screen.
   *
   * A prompt typed while a run was going is echoed as sent the moment the
   * session takes it, because that is when the Human is told it was taken. If
   * the write behind it later fails, saying only that "a prompt" failed leaves
   * the Human holding three echoed prompts and no way to tell which of them
   * the Principal never got -- and nothing to resend it from. The text comes
   * back with the failure so the surface can give it back. */
  readonly onPromptFailed: (text: string, reason: string) => void;
  /** D06/WP09: a Human prompt that was written, but whose acceptance the
   * engine never answered before the session ended. It is not handed back as
   * unsent and never resent automatically: the engine may have taken it. */
  readonly onPromptUnconfirmed?: (text: string, reason: string) => void;
}

/** Mirrors the Resident adapter's remaining blocking: approval prompts,
 * extension discovery and the shell/write tools stay suppressed (TUI-014).
 * Context files, skills and prompt templates are discovered and filtered by
 * the trusted extension instead (C15–C17).
 */
/** TUI-004: the Principal runs under the same role contract as a Resident —
 * its model, extensions, prompt and tool surface come from its role in the
 * configuration, never from defaults. An undeclared model is refused. */
export function principalSessionProfile(configPath: string, society: string): SessionProfile & { readonly inferenceSeconds: number } {
  const configuration = loadConfiguration(configPath);
  const config = configuration.config;
  const modelName = config.agentProfiles[config.principalProfile]?.modelProfile ?? "";
  const model = config.modelProfiles[modelName];
  if (!model) throw new StoreError("UNSUPPORTED_PROFILE", `principal model profile ${modelName} is not declared`);
  const role = configuration.roles[config.principalProfile];
  const prompt = role?.prompt ?? "";
  const workspaceBytes = config.agentProfiles[config.principalProfile]?.resources.workspaceBytes;
  if (!Number.isSafeInteger(workspaceBytes) || (workspaceBytes ?? 0) <= 0)
    throw new StoreError("UNSUPPORTED_PROFILE", "the principal role declares no workspace quota");
  const packageResources = packageResourcePaths(config.installation.packages);
  return {
    society, provider: model.provider, model: model.model, inferenceSeconds: model.inferenceTimeoutSeconds, workspaceBytes: workspaceBytes!,
    extensions: (role?.extensions ?? []).map(extension => ({ path: extension.path, sha256: extension.sha256 })),
    ...(packageResources === undefined ? {} : { packageResources }),
    ...(prompt.length > 0 ? { prompt } : {}),
  };
}

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

/** D25: mirrors `VERIFIED_EXTENSIONS_ENV` in src/extension/provenance.ts --
 * the trusted extension's files may not be imported here, so a test binds the
 * two spellings, as it does for TOOL_SCOPE_ENV (INV04). */
const VERIFIED_EXTENSIONS_ENV = "OMA_VERIFIED_EXTENSIONS";

/** The environment only the engine sees: which extension paths were
 * digest-verified for this role, so the core extension can authorize tools by
 * provenance rather than by name (D25). The list is exactly the `-e` argv --
 * the core extension first, then the role's extensions -- in the same
 * spelling the engine's source metadata reports. */
export function sessionEnv(
  base: Readonly<Record<string, string>>,
  profile: SessionProfile,
  paths?: Partial<Pick<SessionPaths, "piAgentDir" | "fence" | "coreExtension">>,
): Record<string, string> {
  return {
    ...base,
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
  };
}


function textOf(message: unknown): string {
  if (typeof message === "string") return message;
  if (message === null || typeof message !== "object") return "";
  const content = (message as Record<string, unknown>).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === "string") { parts.push(part); continue; }
    if (part === null || typeof part !== "object") continue;
    const value = (part as Record<string, unknown>).text;
    if (typeof value === "string") parts.push(value);
  }
  return parts.join("");
}

/** Pure event projection so transcript behaviour is testable without spawning
 * a real Pi process. What is running is not decided here: the session owns
 * that, and this only turns an event into the line the transcript shows.
 */
export function projectEvent(event: PiEvent): { readonly line?: string } {
  // DR15, P0-5: an event too large to hold was skipped; what it said is not
  // shown, and the screen says so rather than showing nothing.
  if (event.type === SKIPPED_EVENT)
    return { line: `⚠ An engine event (${String(event.bytes)} bytes) exceeded the display limit.` };
  if (event.type === "auto_retry_start")
    return { line: `⚠ Temporary model API error: waiting for retry ${String(event.attempt)}/${String(event.maxAttempts)}` };
  if (event.type === "auto_retry_end")
    return { line: event.success === true ? "Model API connection restored." : `⚠ Model API failed after ${String(event.attempt)} retries.` };
  if (event.type === "message_end") {
    const message = event.message;
    if (message === null || typeof message !== "object" || Array.isArray(message)) return {};
    const record = message as Record<string, unknown>;
    const role = record.role;
    const text = textOf(record).trim();
    if (role === "assistant") {
      const stop = String(record.stopReason ?? "");
      if (stop === "error" || stop === "aborted")
        return { line: `⚠ Response ended with status: ${stop}.` };
      return text.length > 0 ? { line: text } : {};
    }
    if (role === "custom" && text.length > 0) return { line: `[Notice] ${text}` };
    return {};
  }
  return {};
}

export class PrincipalSession {
  private readonly rpc: PiRpcClient;
  private ui: InteractiveChannel | null = null;
  private ready = true;

  sendUi(event: PiEvent): void { this.ui?.send(event); }
  private readonly channel: Socket;
  private sequence = 0;
  private closed = false;
  private readonly frameBytes: number;
  /** Who owns the agent run the engine is performing, or null when it performs
   * none.
   *
   * Observing "not running" and starting a run have to be one step. The engine
   * only reports `turn_start` after it has read the prompt, so a delivery that
   * looked at an event-driven flag could see an idle session between the
   * Human's prompt being written and that report, and put its own command into
   * the same run -- which is exactly the mixed attribution S-03 has not
   * settled. Ownership is taken here, synchronously, before anything is
   * written, so there is no window between the check and the claim. */
  private owner: "human" | "delivery" | null = null;
  /** Human prompts waiting for the session, in the order they were typed.
   *
   * They wait here and not in the engine's own follow-up queue. Pi drains that
   * queue inside the run it is already performing and reports one
   * `agent_settled` for the whole run, however many messages it drained. A
   * prompt left there while a delivery was running would therefore become part
   * of the delivery's run, and the boundary the trusted extension records for
   * that run would cover the Human's turn as well. Held here, every run has
   * exactly one owner and one boundary. */
  private readonly waiting: string[] = [];
  /** How many may wait. The Human can type while a run they cannot interrupt
   * is going, so without a ceiling the length of that run decides how much is
   * held here. A prompt over the ceiling is refused and said, not dropped
   * quietly. */
  private static readonly WAITING = CONVERSATION_BOUNDS.waitingPrompts.value;
  /** The prompt whose acceptance the engine has not answered yet. Pi answers a
   * `prompt` command at preflight, before the run, and a rejection -- no model,
   * no key, a compaction in progress -- is the only notice that the message was
   * never accepted and that no run will start or settle for it. At most one is
   * outstanding, because a prompt is only ever written to an idle engine. */
  private unanswered: { readonly id: string; readonly role: "human" | "delivery"; readonly text: string } | null = null;
  /** Set once the unsent prompts have been handed back. */
  private handedBack = false;

  /** Resolves when the operating system has reaped the engine, not when this
   * process asked it to stop. `close()` sends a signal; a teardown that took
   * the signal for the death could release the society while the engine it
   * paid for was still running. */
  readonly exited: Promise<void>;

  private constructor(private readonly child: ChildProcess, limits: PiRpcLimits, private readonly sink: SessionSink,
    streams?: PiRpcStreams, uiSocket?: Socket) {
    this.frameBytes = limits.frameBytes;
    this.exited = new Promise<void>(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
      child.once("exit", () => { resolve(); });
      // P0V-73, P0-4: a spawn that failed never had a process -- `error` with no
      // pid, then `close`, and no `exit` -- and that is its terminal fact. An
      // error from a process that did start (a kill that failed) is not its end.
      child.once("error", () => { if (child.pid === undefined) resolve(); });
    });
    let rpc: PiRpcClient | null = null;
    let startup: ReturnType<typeof alarm> | null = null;
    try {
      sink.onAcquire?.({
        exited: this.exited,
        close: () => {
          if (rpc === null || this.closed) stopOwnedChild(child);
          else this.close();
        },
      });
      rpc = this.rpc = new PiRpcClient(child, limits, streams, uiSocket ? () => {
        child.kill("SIGTERM");
        const deadline = alarm(TERMINAL_BOUNDS.interactiveExitSeconds.value, () => {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        });
        void this.exited.then(() => deadline.cancel());
      } : undefined);
      if (uiSocket) {
        this.ready = false;
        startup = alarm(limits.receiptWaitSeconds, () => this.close());
        let sequence = 0;
        let last: PiEvent | undefined;
        this.ui = new InteractiveChannel(uiSocket, limits, event => {
          if (event.type === "ready") {
            if (this.ready) { this.close(); return; }
            startup?.cancel(); this.ready = true; this.sink.onBusy(this.busy);
          } else if (!this.ready) { this.close(); return; }
          if (event.type === "human_input") {
            if (last && event.id === last.id) { this.ui?.send(last); return; }
            if (event.id !== `ui-${sequence + 1}` || typeof event.text !== "string") { this.close(); return; }
            sequence += 1;
            // Said so the screen can tell the Human the prompt waits its turn.
            const queued = this.busy;
            const outcome = this.submit(event.text);
            last = { type: "input_result", id: event.id, accepted: outcome.kind === "accepted",
              ...(outcome.kind === "refused" ? { reason: outcome.reason } : { queued }) };
            this.ui?.send(last);
          } else if (["ready", "quit", "panel_open", "panel_size", "panel_key", "sessions_request", "switch", "engine_state", "worker_model"].includes(event.type))
            this.sink.onUi?.(event);
          else this.close();
        }, () => { startup?.cancel(); this.close(); });
      }
      // The private socket the credential travels on. Kept open for the life of
      // the session so a restarted broker's credential can replace the old one.
      this.channel = child.stdio[HOST_CHANNEL_FD] as unknown as Socket;
      this.channel.on("error", () => {});
      this.rpc.onEvent(event => this.observe(event));
      void this.rpc.completion.then(async result => {
        this.closed = true;
        this.ui?.close();
        const reason = result.state === "failed"
          ? `Session ended with an error: ${errorWords(result.error)}`
          : "Session ended.";
        this.handBack(reason);
        this.owner = null;
        this.sink.onBusy(false);
        if (uiSocket) await this.exited;
        this.sink.onEnd(reason);
      });
    } catch (error) {
      // No completed session was handed to the host. Returning partial owners
      // must not emit onEnd or invite another prompt into this failed session.
      this.closed = true;
      startup?.cancel();
      const errors: unknown[] = [error];
      try { this.ui?.close(); } catch (cleanup) { errors.push(cleanup); }
      try { rpc?.close(); } catch (cleanup) { errors.push(cleanup); }
      try { stopOwnedChild(child); } catch (cleanup) { errors.push(cleanup); }
      if (errors.length > 1) throw new AggregateError(errors, "Principal setup and cleanup failed");
      throw error;
    }
  }

  static start(paths: SessionPaths, profile: SessionProfile, limits: PiRpcLimits, env: Readonly<Record<string, string>>, sink: SessionSink): PrincipalSession {
    // Validate before spawn: a constructor refusal must leave no ownerless child.
    assertPiRpcLimits(limits);
    // TUI-010: the digests recorded for this role are checked again here, at the
    // last moment before the file is handed to Pi.
    assertExtensionIntegrity(profile.extensions);
    // PR-004: the model's tools are confined to `workspace`, which holds
    // neither the Human's session history nor the engine's credentials.
    assertModelScope(paths.workspace, [paths.sessionDir, ...(paths.piAgentDir === undefined ? [] : [paths.piAgentDir])]);
    if (paths.piAgentDir !== undefined) preparePiRetry(paths.piAgentDir);
    if (paths.interactiveEntry !== undefined) {
      if (paths.fence === undefined) throw new StoreError("UNSUPPORTED_PROFILE", "interactive session requires its lease descriptor");
      const child = spawnOwnedInteractive(paths.piCommand, [paths.interactiveEntry, ...sessionArgv(paths, profile)], paths.workspace,
        { ...sessionEnv(env, profile, paths), OMA_UI_IDLE_SECONDS: String(limits.idleStreamSeconds),
          OMA_UI_RECEIPT_SECONDS: String(limits.receiptWaitSeconds), OMA_PROJECT_DISPLAY: paths.project ?? paths.workspace,
          ...(paths.sessionFile === undefined ? {} : { OMA_SESSION_FILE: paths.sessionFile }),
          TERM: process.env.TERM ?? "xterm-256color", ...(process.env.COLORTERM ? { COLORTERM: process.env.COLORTERM } : {}) }, paths.fence);
      const channels: readonly unknown[] = child.stdio;
      const rpc = channels[INTERACTIVE_RPC_FD] as Socket;
      return new PrincipalSession(child, limits, sink, { stdin: rpc, stdout: rpc, stderr: child.stderr! },
        channels[INTERACTIVE_UI_FD] as Socket);
    }
    const child = spawnOwnedRpc(
      paths.piCommand,
      [...(paths.piArgs ?? []), ...sessionArgv(paths, profile)],
      paths.workspace,
      sessionEnv(env, profile, paths),
      true,
      paths.fence,
    );
    return new PrincipalSession(child, limits, sink);
  }

  /** The one place the session's state moves in answer to the engine. */
  private observe(event: PiEvent): void {
    if (event.type === "response" && event.command === "prompt" &&
      this.unanswered !== null && event.id === this.unanswered.id) {
      const { role, text } = this.unanswered;
      this.unanswered = null;
      if (event.success !== true) {
        // Refused before acceptance: no run starts and none settles, so the
        // claim has to be given back here or the session would stay the
        // refused prompt's for the rest of its life -- and the Human would
        // never learn that what they typed was not taken.
        const detail = typeof event.error === "string" && event.error.length > 0 ? event.error : "Unknown reason";
        // A Human prompt is named and handed back; a delivery command is the
        // product's own text and there is nothing to give back.
        if (role === "human") this.sink.onPromptFailed(text, `The engine did not accept the input: ${detail}`);
        else this.sink.onLine(`⚠ The engine rejected the input: ${detail}`);
        this.release(role);
      }
    }
    // Pi settles a whole run, retries and queued continuations included, not
    // one prompt. One of these ends whatever this session was running.
    if (event.type === "agent_settled") this.free();
    const projected = projectEvent(event);
    if (projected.line !== undefined) this.sink.onLine(projected.line);
  }

  /** Every move of the session's ownership goes through here, and every report
   * of whether it is busy comes out of here. Two owners of that answer -- a
   * caller announcing "busy" before it claims, an event announcing "idle"
   * after it releases -- is how the screen ends up saying the engine is
   * working on a session that is in fact free. */
  private own(next: "human" | "delivery" | null): void {
    this.owner = next;
    this.sink.onBusy(this.busy);
  }

  /** The run is over. A Human prompt that was waiting takes the session here,
   * synchronously, so nothing can start between the two steps. */
  private free(): void {
    if (this.closed) return;
    this.unanswered = null;
    const next = this.waiting.shift();
    if (next === undefined) { this.own(null); return; }
    this.own("human");
    this.write(next);
  }

  /** Writes one Human prompt the session already belongs to. A prompt refused
   * before any byte was written is handed back and the next one goes; one
   * whose write began and failed ended the transport, so the session's end
   * reports it as unconfirmed rather than unsent (D06). */
  private write(text: string): void {
    void this.sendPrompt(this.nextRequestId(), text, "human").catch((error: unknown) => {
      if (!commandWasNotWritten(error)) return;
      this.sink.onPromptFailed(text, errorWords(error));
      this.release("human");
    });
  }

  /** D06/WP09: once, when the session ends or is closed. Waiting prompts were
   * never written: each goes back, in the order typed. A written prompt the
   * engine never answered is reported apart and is not resent. */
  private handBack(reason: string): void {
    if (this.handedBack) return;
    this.handedBack = true;
    const unanswered = this.unanswered;
    this.unanswered = null;
    if (unanswered !== null && unanswered.role === "human") this.sink.onPromptUnconfirmed?.(unanswered.text, reason);
    for (const text of this.waiting.splice(0)) this.sink.onPromptFailed(text, reason);
  }

  private nextRequestId(): string {
    this.sequence += 1;
    return humanPromptRequestId(this.sequence);
  }

  /** Writes one prompt and remembers that the engine has yet to accept it. */
  private async sendPrompt(id: string, message: string, role: "human" | "delivery"): Promise<void> {
    this.unanswered = { id, role, text: message };
    try { await this.rpc.send({ id, type: "prompt", message }); }
    catch (error) {
      // Only a command that was provably not written is no longer awaiting an
      // answer; after a partial write acceptance stays unknown.
      if (commandWasNotWritten(error) && this.unanswered?.id === id) this.unanswered = null;
      throw error;
    }
  }

  get running(): boolean { return !this.closed; }

  /** The engine's pid, which the broker checks is this process's own child
   * before it accepts the engine as the Principal. */
  get pid(): number | null { return this.closed ? null : this.child.pid ?? null; }

  /** True while the session is spoken for. A Human prompt that arrives while it
   * is takes the session the moment the run ends, in the same step that ends
   * it, so this never reads false with one still waiting. Delivery waits for
   * it to clear so a batch's boundary is never confused with a Human's turn. */
  get busy(): boolean { return this.ready === false || this.owner !== null; }

  /** Hands the engine its credential on the private socket. A new one simply
   * replaces the previous one; the old broker that minted it is gone. */
  grant(credential: string, sessionHandle: string): void {
    if (this.closed || this.channel.destroyed) return;
    this.channel.write(encodeHostMessage({ kind: "credential", credential, sessionHandle }));
  }

  /** Every event the engine emits, for the delivery owner. */
  onEvent(listener: (event: PiEvent) => void): () => void { return this.rpc.onEvent(listener); }

  /** PR-002: asks the trusted extension to present a prepared batch. The
   * session is claimed first, so the run this starts is the batch's alone and
   * the boundary the extension reports for it belongs to no one else. */
  async deliver(batchId: string): Promise<void> {
    if (this.closed) throw new StoreError("PRINCIPAL_DISCONNECTED", "the principal session has ended");
    // Claimed before the command is written, and given back if it cannot be.
    if (this.busy)
      throw new StoreError("BATCH_CONFLICT", "the principal session is already spoken for");
    this.own("delivery");
    try { await this.sendPrompt(batchId, `/oma-deliver ${batchId}`, "delivery"); }
    catch (error) {
      // A command that was never written starts no run; any other failure
      // ended the transport, and the claim ends with the session.
      if (commandWasNotWritten(error)) this.release("delivery");
      throw error;
    }
  }

  /** Gives the session back if this owner still holds it, and lets whatever
   * the Human has waiting take it. D06/WP09: only for a run that provably did
   * not start -- a command refused before it was written, or refused by the
   * engine. An unanswered command is not one: its run may be going, and
   * handing the session to a waiting Human prompt would put that prompt into
   * it. Settlement, refusal or the session's end ends that claim. */
  release(owner: "human" | "delivery"): void {
    if (this.owner === owner) this.free();
  }

  /** The Human is never made to wait for mail, and never has to retype. A
   * prompt typed while the session is spoken for waits here in order and is
   * written the moment the session is free; it is never folded into the run
   * already going, so that run keeps its own boundary.
   *
   * Whether this session took the prompt is answered here, synchronously, for
   * the same reason ownership is claimed synchronously: the screen shows what
   * was accepted, and an answer that arrives after the screen has drawn is an
   * answer about a prompt the Human has already been told was sent. Everything
   * that decides acceptance -- closed, over the frame, no room left to wait --
   * is known in this call. What cannot be known here is whether the write
   * itself will succeed; that failure is reported into the transcript the same
   * way a failed write from the waiting queue is.
   */
  submit(text: string): PromptOutcome {
    if (this.ready === false) return { kind: "refused", reason: "Preparing the conversation UI." };
    if (this.closed) {
      this.sink.onEnd("Cannot send: the session has ended.");
      return { kind: "refused", reason: "Session ended." };
    }
    if (!humanPromptFitsFrame(text, this.frameBytes))
      return { kind: "refused", reason: "Input exceeds this session's UTF-8 prompt limit." };
    if (this.busy) {
      if (this.waiting.length >= PrincipalSession.WAITING)
        return { kind: "refused", reason: `Only ${PrincipalSession.WAITING} prompts may wait. Try again after the current response finishes.` };
      this.waiting.push(text);
      return { kind: "accepted" };
    }
    this.own("human");
    this.write(text);
    return { kind: "accepted" };
  }

  /** Quitting hands back what never reached the engine before the transport
   * closes; the completion that follows finds nothing left to hand back. */
  close(): void {
    if (this.closed) return;
    this.handBack("Session closed.");
    this.closed = true;
    this.ui?.close();
    this.rpc.close();
  }
}
