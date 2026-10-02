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
 *    tool call is aborted. A caller may also bound a single phase.
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
 * exists to prevent -- and it can keep running after the host and the engine
 * have been killed, because a signal to the engine is not a signal
 * to its children. So it inherits the lease like everything else the tenure
 * pays for, and the society cannot pass to another host until it exits. */
export const SOCIETY_FENCE_ENV = "OMA_SOCIETY_FENCE_FD";
export const SOCIETY_FENCE_FD = 4;
/** Model-facing output budget, not the terminal CLI's receipt reassembly limit.
 * A larger answer is unobserved here, never evidence that its effect failed. */
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
  readonly timeoutMs?: number;
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
  if (run.timeoutMs !== undefined && (!Number.isSafeInteger(run.timeoutMs) || run.timeoutMs < 1 || run.timeoutMs > 2_147_483_647))
    throw new RangeError("CLI phase timeout must be a positive timer-safe integer");
  if (run.signal?.aborted) return Promise.resolve({ code: 1, stdout: "", stderr: "", finished: false });
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
    // Counted and kept as bytes, and decoded once when the child is done
    // (P0V-35, P0-2). A string-length cap would keep several times the declared
    // bound, and a chunk ends wherever the pipe did, not where a character
    // does: decoding each chunk alone turned a character split between two of
    // them into replacement characters.
    const stdout: Buffer[] = []; const stderr: Buffer[] = [];
    let stdoutBytes = 0; let stderrBytes = 0;
    let settled = false;
    let stopped = false;
    let errored = false;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const finish = (code: number, finished: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(escalation);
      run.signal?.removeEventListener("abort", abort);
      resolve({ code, stdout: Buffer.concat(stdout, stdoutBytes).toString("utf8"),
        stderr: Buffer.concat(stderr, stderrBytes).toString("utf8"), finished: finished && !stopped && !errored });
    };
    const terminate = (): void => {
      if (stopped || child.exitCode !== null || child.signalCode !== null) return;
      stopped = true;
      child.kill("SIGTERM");
      escalation = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }, 5000);
      escalation.unref();
    };
    const abort = (): void => { terminate(); };
    // P0V-27, P0-4: an error can be a failed signal, not child death.
    // Even spawn failure emits close; that observation alone releases this owner.
    child.on("error", () => { errored = true; terminate(); });
    const timer = run.timeoutMs === undefined ? undefined : setTimeout(terminate, run.timeoutMs);
    timer?.unref();
    if (run.signal?.aborted) terminate();
    else run.signal?.addEventListener("abort", abort, { once: true });
    const collect = (kept: Buffer[], add: (bytes: number) => void, current: () => number) => (chunk: Buffer) => {
      if (settled) return;
      if (current() + chunk.byteLength > OUTPUT_BYTES) { terminate(); return; }
      kept.push(chunk); add(chunk.byteLength);
    };
    child.stdout?.on("data", collect(stdout, bytes => { stdoutBytes += bytes; }, () => stdoutBytes));
    child.stderr?.on("data", collect(stderr, bytes => { stderrBytes += bytes; }, () => stderrBytes));
    if (run.grant !== null) {
      const channel = child.stdio[CREDENTIAL_FD] as unknown as Socket | null;
      if (!channel) terminate();
      else {
        channel.on("error", () => {});
        channel.end(`credential ${run.grant.credential} ${run.grant.sessionHandle}\n`);
      }
    }
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
