/** TUI-004/014: the Principal Pi session that the product owns.
 *
 * Pi runs in RPC mode only. Its built-in interactive surface, project
 * extensions, skills, prompt templates and shell tools are switched off at
 * argv, so there is nothing to hide afterwards. Peer content is never dressed
 * as a Human turn; this module only relays what the user typed here.
 */
import { spawnOwnedRpc, type ChildProcessWithoutNullStreams } from "../process/async.js";
import { PiRpcClient, type PiEvent, type PiRpcLimits } from "../runtime/pi-rpc.js";

export interface SessionPaths {
  readonly piCommand: string;
  readonly coreExtension: string;
  readonly sessionDir: string;
  readonly workspace: string;
  readonly home: string;
}

export interface SessionProfile {
  readonly society: string;
  readonly provider: string;
  readonly model: string;
  readonly extensions: readonly string[];
}

export interface SessionSink {
  readonly onLine: (line: string) => void;
  readonly onBusy: (busy: boolean) => void;
  readonly onEnd: (reason: string) => void;
}

/** Mirrors the Resident adapter's discovery blocking. A flag removed here would
 * let a Pi surface reach the product UI (TUI-014).
 */
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
  for (const extension of profile.extensions)
    if (extension !== paths.coreExtension) args.push("-e", extension);
  if (!(profile.provider === "pi" && profile.model === "current"))
    args.push("--model", `${profile.provider}/${profile.model}`);
  return Object.freeze(args);
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
    const child = spawnOwnedRpc(paths.piCommand, sessionArgv(paths, profile), paths.workspace, env);
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
