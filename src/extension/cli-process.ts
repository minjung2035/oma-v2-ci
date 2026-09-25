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
 *  - It inherits the society lease, so it cannot outlive this society's
 *    ownership (REC-007).
 */
import { spawn } from "node:child_process";
import { fstatSync } from "node:fs";
import type { Socket } from "node:net";
import type { PrincipalGrant } from "./principal-channel.js";

/** The descriptor the CLI reads a credential from, named in its environment
 * only as a number. Mirrors `CLI_CREDENTIAL_FD_ENV` in src/cli/transport.ts. */
export const CLI_CREDENTIAL_FD_ENV = "OMA_PRINCIPAL_CREDENTIAL_FD";
const CREDENTIAL_FD = 3;
/** The society lease this process inherited, and the descriptor a child of
 * this process receives it on. Mirrors `SOCIETY_FENCE_ENV` and
 * `SOCIETY_FENCE_FD` in src/process/async.ts.
 *
 * This CLI is not a reader of the society. It writes the Principal's private
 * state: its agent home is `<stateRoot>/principal/private` and its request
 * cache is written underneath it. A CLI still running after the `oma` that
 * started this engine is gone is therefore exactly the second writer the lease
 * exists to prevent -- and it can run for its whole timeout after the host and
 * the engine have been killed, because a signal to the engine is not a signal
 * to its children. So it inherits the lease like everything else the tenure
 * pays for, and the society cannot pass to another host until it exits. */
export const SOCIETY_FENCE_ENV = "OMA_SOCIETY_FENCE_FD";
export const SOCIETY_FENCE_FD = 4;
/** Output a CLI answer may take up. Anything longer is not an answer OMA writes. */
const OUTPUT_BYTES = 1024 * 1024;

/** The inherited lease descriptor, or null when this engine was not started
 * under one -- a Pi run by hand outside a society owns nothing and fences
 * nothing.
 *
 * A declaration that cannot be honoured is an error rather than a shrug. If
 * the environment names a fence and the descriptor is not there, or is not the
 * lease's kind of object, this process cannot give a child the lease it was
 * told to pass on; starting the child anyway would start the unfenced writer
 * the declaration existed to prevent. */
function inheritedFence(env: Readonly<Record<string, string | undefined>>): number | null {
  const declared = env[SOCIETY_FENCE_ENV];
  if (declared === undefined) return null;
  if (!/^[0-9]{1,4}$/.test(declared)) throw new Error(`${SOCIETY_FENCE_ENV} is not a descriptor number`);
  const fd = Number(declared);
  let kind;
  try { kind = fstatSync(fd); }
  catch { throw new Error(`${SOCIETY_FENCE_ENV} names descriptor ${fd}, which is not open`); }
  if (!kind.isSocket()) throw new Error(`${SOCIETY_FENCE_ENV} names descriptor ${fd}, which is not the society lease`);
  return fd;
}

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
  /** DR13, P0-5: the CLI ended by itself with an exit status. False when this
   * process stopped it (abort, timeout, output bound) or it could not be
   * started: then its answer was never given, and a mutation's outcome is
   * unknown -- not failed. */
  readonly finished: boolean;
}

export function runCliProcess(run: CliRun): Promise<CliResult> {
  const env: Record<string, string> = { ...run.env };
  if (run.grant !== null) env[CLI_CREDENTIAL_FD_ENV] = String(CREDENTIAL_FD);
  const fence = inheritedFence(process.env);
  // The child is told where its own lease is, on the same rule as this
  // process: a fenced child never has to work out how its parent was started
  // to find the descriptor it must pass on.
  if (fence !== null) env[SOCIETY_FENCE_ENV] = String(SOCIETY_FENCE_FD);
  return new Promise<CliResult>(resolve => {
    const child = spawn(run.node, [run.cli, ...run.args], {
      cwd: run.cwd, env, shell: false,
      stdio: childStdio(run.grant !== null, fence),
    });
    let stdout = ""; let stderr = "";
    // Counted as bytes, not as decoded string length: a UTF-8 character is up
    // to four bytes, so a string-length cap would keep several times the
    // declared bound.
    let stdoutBytes = 0; let stderrBytes = 0;
    let settled = false;
    let stopped = false;
    const finish = (code: number, finished: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      run.signal?.removeEventListener("abort", abort);
      resolve({ code, stdout, stderr, finished: finished && !stopped });
    };
    const terminate = (): void => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      stopped = true;
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
      if (!channel) { terminate(); finish(1, false); return; }
      channel.on("error", () => {});
      channel.end(`credential ${run.grant.credential} ${run.grant.sessionHandle}\n`);
    }
    child.once("error", () => finish(1, false));
    child.once("close", code => finish(code ?? 1, code !== null));
  });
}

/** The credential always at `CREDENTIAL_FD` and the lease always at
 * `SOCIETY_FENCE_FD`, so both are where the child expects them whether or not
 * the other one is there. */
function childStdio(credential: boolean, fence: number | null): ("ignore" | "pipe" | number)[] {
  const stdio: ("ignore" | "pipe" | number)[] = ["ignore", "pipe", "pipe"];
  if (!credential && fence === null) return stdio;
  stdio.push(credential ? "pipe" : "ignore");
  if (fence !== null) stdio.push(fence);
  return stdio;
}
