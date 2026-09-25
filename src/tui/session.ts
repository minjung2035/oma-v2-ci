/** TUI-004/014: the Principal Pi session that the product owns.
 *
 * Pi runs in RPC mode only. Its built-in interactive surface, project
 * extensions, skills, prompt templates and shell tools are switched off at
 * argv, so there is nothing to hide afterwards. Peer content is never dressed
 * as a Human turn; this module only relays what the user typed here.
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { ProtocolLimits } from "../../implementation/contracts.js";
import { SOCIETY_FENCE_ENV, SOCIETY_FENCE_FD, spawnOwnedRpc, type ChildProcessWithoutNullStreams } from "../process/async.js";
import { DEPLOYMENT_LAYOUT } from "../domain/deployment.js";
import type { Socket } from "node:net";
import { HOST_CHANNEL_ENV, HOST_CHANNEL_FD, encodeHostMessage } from "../protocol/host-channel.js";
import { assertModelScope, modelWorkspacePathAt, projectGitPathAt, runnerViewPathAt, sessionDirPathAt } from "../storage/paths.js";
import { PiRpcClient, commandWasNotWritten, type PiEvent, type PiRpcLimits } from "../runtime/pi-rpc.js";
import { assertExtensionIntegrity, verifiedPaths, type VerifiedExtension } from "../runtime/extension-integrity.js";
import { PI_AGENT_DIR_ENV } from "../runtime/pi-runtime.js";
import { loadConfiguration } from "../config.js";
import { StoreError } from "../domain/errors.js";
import { encodeToolSurfacePlan } from "../domain/tool-surface.js";
import { CONVERSATION_BOUNDS, humanPromptFitsFrame, humanPromptRequestId } from "./limits.js";
import type { PromptOutcome } from "./prompt.js";

export interface SessionPaths {
  readonly piCommand: string;
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
  /** TSP-005: the Principal role's validated tool surface plan, encoded for the
   * core extension. Absent means the role shows every registered tool. */
  readonly toolSurface?: string | undefined;
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
  limits: Pick<ProtocolLimits, "frameBytes" | "mailBodyBytes" | "batchMaxMessages">,
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
    // AV11: read by the trusted extension only, to name the society's main as
    // the base of an agent the Principal creates; the model's tools never see it.
    OMA_PROJECT_GIT: projectGitPathAt(paths.stateRoot),
    OMA_FRAME_BYTES: String(limits.frameBytes),
    OMA_MAIL_BYTES: String(limits.mailBodyBytes),
    OMA_WORKSPACE_BYTES: String(profile.workspaceBytes),
    // PR-002: where the broker publishes the Principal's prepared batches, and
    // how large one may be. The host delivers them; the extension reads them.
    OMA_BATCH_VIEW: runnerViewPathAt(paths.stateRoot, "principal"),
    OMA_BATCH_MAX_MESSAGES: String(limits.batchMaxMessages),
    [HOST_CHANNEL_ENV]: String(HOST_CHANNEL_FD),
  };
}

export interface SessionSink {
  readonly onLine: (line: string) => void;
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

/** Mirrors the Resident adapter's discovery blocking. A flag removed here would
 * let a Pi surface reach the product UI (TUI-014).
 */
/** TUI-004: the Principal runs under the same role contract as a Resident —
 * its model, extensions, prompt and tool surface come from its role in the
 * configuration, never from defaults. An undeclared model is refused. */
export function principalSessionProfile(configPath: string, society: string): SessionProfile {
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
  return {
    society, provider: model.provider, model: model.model, workspaceBytes: workspaceBytes!,
    extensions: (role?.extensions ?? []).map(extension => ({ path: extension.path, sha256: extension.sha256 })),
    ...(prompt.length > 0 ? { prompt } : {}),
    ...(role?.toolSurface ? { toolSurface: encodeToolSurfacePlan(role.toolSurface) } : {}),
  };
}

export function sessionArgv(paths: SessionPaths, profile: SessionProfile): readonly string[] {
  const args = [
    "--mode", "rpc",
    "--no-approve",
    "--no-context-files",
    "--no-skills",
    "--no-prompt-templates",
    "--no-extensions",
    "--exclude-tools", "bash,powershell",
    "--session-dir", paths.sessionDir,
    // AV14, PR-003/TUI-004: the Human's context stays in the existing session;
    // a new TUI run resumes the most recent one, or starts one when there is none.
    "--continue",
    "--name", `oma-${profile.society}-principal`,
    "-e", paths.coreExtension,
  ];
  for (const extension of verifiedPaths(profile.extensions))
    if (extension !== paths.coreExtension) args.push("-e", extension);
  if (!(profile.provider === "pi" && profile.model === "current"))
    args.push("--model", `${profile.provider}/${profile.model}`);
  if (profile.prompt !== undefined && profile.prompt.length > 0)
    args.push("--append-system-prompt", profile.prompt);
  return Object.freeze(args);
}

/** TSP-005: the Principal role's projection reaches its Pi process the same way
 * a Resident's does. Kept separate so the wiring is testable without spawning.
 */
export function sessionEnv(
  base: Readonly<Record<string, string>>,
  profile: SessionProfile,
  paths?: Pick<SessionPaths, "piAgentDir" | "fence">,
): Record<string, string> {
  return {
    ...base,
    ...(profile.toolSurface === undefined ? {} : { OMA_TOOL_SURFACE: profile.toolSurface }),
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  if (event.type === "message_end") {
    const message = event.message;
    if (message === null || typeof message !== "object" || Array.isArray(message)) return {};
    const record = message as Record<string, unknown>;
    const role = record.role;
    const text = textOf(record).trim();
    if (role === "assistant") {
      const stop = String(record.stopReason ?? "");
      if (stop === "error" || stop === "aborted")
        return { line: `⚠ 응답이 ${stop} 상태로 끝났습니다.` };
      return text.length > 0 ? { line: text } : {};
    }
    if (role === "custom" && text.length > 0) return { line: `[알림] ${text}` };
    return {};
  }
  return {};
}

export class PrincipalSession {
  private readonly rpc: PiRpcClient;
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

  private constructor(private readonly child: ChildProcessWithoutNullStreams, limits: PiRpcLimits, private readonly sink: SessionSink) {
    this.frameBytes = limits.frameBytes;
    this.exited = new Promise<void>(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
      child.once("exit", () => { resolve(); });
    });
    this.rpc = new PiRpcClient(child, limits);
    // The private socket the credential travels on. Kept open for the life of
    // the session so a restarted broker's credential can replace the old one.
    this.channel = child.stdio[HOST_CHANNEL_FD] as unknown as Socket;
    this.channel.on("error", () => {});
    this.rpc.onEvent(event => this.observe(event));
    void this.rpc.completion.then(result => {
      this.closed = true;
      const reason = result.state === "failed"
        ? `세션이 오류로 종료되었습니다: ${result.error instanceof Error ? result.error.message : String(result.error)}`
        : "세션이 종료되었습니다.";
      this.handBack(reason);
      this.owner = null;
      this.sink.onBusy(false);
      this.sink.onEnd(reason);
    });
  }

  static start(paths: SessionPaths, profile: SessionProfile, limits: PiRpcLimits, env: Readonly<Record<string, string>>, sink: SessionSink): PrincipalSession {
    // TUI-010: the digests recorded for this role are checked again here, at the
    // last moment before the file is handed to Pi.
    assertExtensionIntegrity(profile.extensions);
    // PR-004: the model's tools are confined to `workspace`, which holds
    // neither the Human's session history nor the engine's credentials.
    assertModelScope(paths.workspace, [paths.sessionDir, ...(paths.piAgentDir === undefined ? [] : [paths.piAgentDir])]);
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
        const detail = typeof event.error === "string" && event.error.length > 0 ? event.error : "사유를 알 수 없습니다";
        // A Human prompt is named and handed back; a delivery command is the
        // product's own text and there is nothing to give back.
        if (role === "human") this.sink.onPromptFailed(text, `엔진이 받지 않았습니다: ${detail}`);
        else this.sink.onLine(`⚠ 엔진이 입력을 받아들이지 않았습니다: ${detail}`);
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
      this.sink.onPromptFailed(text, messageOf(error));
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
  get busy(): boolean { return this.owner !== null; }

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
    if (this.closed) {
      this.sink.onEnd("세션이 종료되어 전송할 수 없습니다.");
      return { kind: "refused", reason: "세션이 종료되었습니다." };
    }
    if (!humanPromptFitsFrame(text, this.frameBytes))
      return { kind: "refused", reason: "입력이 이 세션의 UTF-8 prompt 한도를 넘습니다." };
    if (this.busy) {
      if (this.waiting.length >= PrincipalSession.WAITING)
        return { kind: "refused", reason: `${PrincipalSession.WAITING}개까지만 대기시킬 수 있습니다. 진행 중인 응답이 끝난 뒤 다시 보내 주세요.` };
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
    this.handBack("세션을 닫았습니다.");
    this.closed = true;
    this.rpc.close();
  }
}
