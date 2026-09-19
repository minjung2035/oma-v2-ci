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
import { spawnOwnedRpc, type ChildProcessWithoutNullStreams } from "../process/async.js";
import { DEPLOYMENT_LAYOUT } from "../domain/deployment.js";
import { PRINCIPAL_CREDENTIAL_ENV } from "../protocol/principal-credential.js";
import { PiRpcClient, type PiEvent, type PiRpcLimits } from "../runtime/pi-rpc.js";
import { assertExtensionIntegrity, verifiedPaths, type VerifiedExtension } from "../runtime/extension-integrity.js";
import { PI_AGENT_DIR_ENV } from "../runtime/pi-runtime.js";
import { loadConfiguration } from "../config.js";
import { StoreError } from "../domain/errors.js";
import { encodeToolSurfacePlan } from "../domain/tool-surface.js";

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

export interface PrincipalCredential {
  /** This broker run's secret, or null when no broker published one. Without it
   * the engine still starts and the CLI still refuses every request, which is
   * the truthful outcome of a society with no broker. */
  readonly credential: string | null;
  /** Names this session for the broker, so a society keeps one Principal. */
  readonly sessionHandle: string;
}

/** A fresh handle per started session. It identifies the session, not the user
 * and not the society, so nothing about the deployment can be derived from it
 * and an old one names a session that no longer exists. */
export function newSessionHandle(): string { return randomBytes(16).toString("hex"); }

export function principalEnvironment(
  paths: PrincipalPaths,
  profile: SessionProfile,
  limits: Pick<ProtocolLimits, "frameBytes" | "mailBodyBytes">,
  session: PrincipalCredential,
): Record<string, string> {
  const home = join(paths.stateRoot, "principal", "private");
  return {
    HOME: home,
    PATH: "/usr/bin:/bin",
    OMA_ACTOR: "principal",
    OMA_SOCIETY: profile.society,
    OMA_SOCKET: join(paths.runRoot, "principal.sock"),
    OMA_AGENT_HOME: home,
    OMA_MAIL_ARCHIVE: join(paths.stateRoot, "mail", "archive", "cur"),
    OMA_CLI_PATH: join(paths.libdir, DEPLOYMENT_LAYOUT.cli),
    OMA_FRAME_BYTES: String(limits.frameBytes),
    OMA_MAIL_BYTES: String(limits.mailBodyBytes),
    OMA_WORKSPACE_BYTES: String(profile.workspaceBytes),
    OMA_PRINCIPAL_SESSION: session.sessionHandle,
    // Deliberately absent: the batch view and its message bound. No runner
    // prepares batches for the Principal, so the delivery command stays
    // unavailable rather than being made to look wired (TRACE-002).
    ...(session.credential === null ? {} : { [PRINCIPAL_CREDENTIAL_ENV]: session.credential }),
  };
}

export interface SessionSink {
  readonly onLine: (line: string) => void;
  readonly onBusy: (busy: boolean) => void;
  readonly onEnd: (reason: string) => void;
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
  paths?: Pick<SessionPaths, "piAgentDir">,
): Record<string, string> {
  return {
    ...base,
    ...(profile.toolSurface === undefined ? {} : { OMA_TOOL_SURFACE: profile.toolSurface }),
    ...(paths?.piAgentDir === undefined ? {} : { [PI_AGENT_DIR_ENV]: paths.piAgentDir }),
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
 * a real Pi process.
 */
export function projectEvent(event: PiEvent): { readonly line?: string; readonly busy?: boolean } {
  if (event.type === "turn_start") return { busy: true };
  if (event.type === "agent_settled") return { busy: false };
  if (event.type === "message_end") {
    const message = event.message;
    if (message === null || typeof message !== "object" || Array.isArray(message)) return {};
    const record = message as Record<string, unknown>;
    const role = record.role;
    const text = textOf(record).trim();
    if (role === "assistant") {
      const stop = String(record.stopReason ?? "");
      if (stop === "error" || stop === "aborted")
        return { busy: false, line: `⚠ 응답이 ${stop} 상태로 끝났습니다.` };
      return text.length > 0 ? { line: text } : {};
    }
    if (role === "custom" && text.length > 0) return { line: `[알림] ${text}` };
    return {};
  }
  return {};
}

export class PrincipalSession {
  private readonly rpc: PiRpcClient;
  private sequence = 0;
  private closed = false;

  private constructor(child: ChildProcessWithoutNullStreams, limits: PiRpcLimits, private readonly sink: SessionSink) {
    this.rpc = new PiRpcClient(child, limits);
    this.rpc.onEvent(event => {
      const projected = projectEvent(event);
      if (projected.line !== undefined) this.sink.onLine(projected.line);
      if (projected.busy !== undefined) this.sink.onBusy(projected.busy);
    });
    void this.rpc.completion.then(result => {
      this.closed = true;
      this.sink.onBusy(false);
      this.sink.onEnd(result.state === "failed"
        ? `세션이 오류로 종료되었습니다: ${result.error instanceof Error ? result.error.message : String(result.error)}`
        : "세션이 종료되었습니다.");
    });
  }

  static start(paths: SessionPaths, profile: SessionProfile, limits: PiRpcLimits, env: Readonly<Record<string, string>>, sink: SessionSink): PrincipalSession {
    // TUI-010: the digests recorded for this role are checked again here, at the
    // last moment before the file is handed to Pi.
    assertExtensionIntegrity(profile.extensions);
    const child = spawnOwnedRpc(
      paths.piCommand,
      [...(paths.piArgs ?? []), ...sessionArgv(paths, profile)],
      paths.workspace,
      sessionEnv(env, profile, paths),
    );
    return new PrincipalSession(child, limits, sink);
  }

  get running(): boolean { return !this.closed; }

  async submit(text: string): Promise<void> {
    if (this.closed) { this.sink.onEnd("세션이 종료되어 전송할 수 없습니다."); return; }
    this.sequence += 1;
    this.sink.onBusy(true);
    await this.rpc.send({ id: `oma-tui-${this.sequence}`, type: "prompt", message: text });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.rpc.close();
  }
}
