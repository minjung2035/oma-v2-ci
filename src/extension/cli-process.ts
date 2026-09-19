/** The model-facing CLI as the trusted extension runs it.
 *
 * The engine's own `exec` cannot do this: it closes the child's stdin and
 * passes no descriptor beyond the three standard ones, which leaves the
 * environment as the only way to hand the CLI anything -- and an environment
 * is readable by every process of this user through /proc/<pid>/environ. So
 * the extension starts the CLI itself:
 *
 *  - The environment is exactly the one given, never an inherited one, so a
 *    provider key or session path in the engine's environment cannot travel.
 *  - A Principal credential goes on descriptor 3, a socketpair only this
 *    process and the child hold, and is written and closed before the child
 *    reads it. It is never in the child's environment or command line.
 *  - The child is bounded: its output is capped and it is terminated when the
 *    tool call is aborted or runs past its time.
 */
import { spawn } from "node:child_process";
import type { Socket } from "node:net";
import type { PrincipalGrant } from "./principal-channel.js";

/** The descriptor the CLI reads a credential from, named in its environment
 * only as a number. Mirrors `CLI_CREDENTIAL_FD_ENV` in src/cli/transport.ts. */
export const CLI_CREDENTIAL_FD_ENV = "OMA_PRINCIPAL_CREDENTIAL_FD";
const CREDENTIAL_FD = 3;
/** Output a CLI answer may take up. Anything longer is not an answer OMA writes. */
const OUTPUT_BYTES = 1024 * 1024;

export interface CliRun {
  readonly node: string;
  readonly cli: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly grant: PrincipalGrant | null;
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs: number;
}

export interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export function runCliProcess(run: CliRun): Promise<CliResult> {
  const env: Record<string, string> = { ...run.env };
  if (run.grant !== null) env[CLI_CREDENTIAL_FD_ENV] = String(CREDENTIAL_FD);
  return new Promise<CliResult>(resolve => {
    const child = spawn(run.node, [run.cli, ...run.args], {
      cwd: run.cwd, env, shell: false,
      stdio: run.grant === null ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "pipe", "pipe"],
    });
    let stdout = ""; let stderr = "";
    // Counted as bytes, not as decoded string length: a UTF-8 character is up
    // to four bytes, so a string-length cap would keep several times the
    // declared bound.
    let stdoutBytes = 0; let stderrBytes = 0;
    let settled = false;
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      run.signal?.removeEventListener("abort", abort);
      resolve({ code, stdout, stderr });
    };
    const terminate = (): void => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }, 5000).unref();
    };
    const abort = (): void => { terminate(); };
    const timer = setTimeout(terminate, run.timeoutMs);
    timer.unref();
    if (run.signal?.aborted) terminate();
    else run.signal?.addEventListener("abort", abort, { once: true });
    const collect = (append: (text: string, bytes: number) => void, current: () => number) => (chunk: Buffer) => {
      if (current() + chunk.byteLength > OUTPUT_BYTES) { terminate(); return; }
      append(chunk.toString("utf8"), chunk.byteLength);
    };
    child.stdout?.on("data", collect((text, bytes) => { stdout += text; stdoutBytes += bytes; }, () => stdoutBytes));
    child.stderr?.on("data", collect((text, bytes) => { stderr += text; stderrBytes += bytes; }, () => stderrBytes));
    if (run.grant !== null) {
      const channel = child.stdio[CREDENTIAL_FD] as unknown as Socket | null;
      if (!channel) { terminate(); finish(1); return; }
      channel.on("error", () => {});
      channel.end(`credential ${run.grant.credential} ${run.grant.sessionHandle}\n`);
    }
    child.once("error", () => finish(1));
    child.once("close", code => finish(code ?? 1));
  });
}
