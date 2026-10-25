import { spawnOwnedRpc } from "@oma/process/async";
import { inheritedFence, SOCIETY_FENCE_ENV, SOCIETY_FENCE_FD } from "@oma/process/fence";

export interface CliRun {
  node: string; cli: string; args: readonly string[]; cwd: string;
  env: Readonly<Record<string, string>>;
  signal?: AbortSignal | undefined; timeoutMs?: number;
}
export interface CliResult { code: number; stdout: string; stderr: string; finished: boolean }
export function runCliProcess(run: CliRun): Promise<CliResult> {
  if (run.timeoutMs !== undefined && (!Number.isSafeInteger(run.timeoutMs) || run.timeoutMs < 1 || run.timeoutMs > 0x7fffffff))
    throw new RangeError("CLI phase timeout must be a positive timer-safe integer");
  if (run.signal?.aborted) return Promise.resolve({ code: 1, stdout: "", stderr: "", finished: false });
  const fence = inheritedFence();
  const env = { ...run.env,
    ...(fence === undefined ? {} : { [SOCIETY_FENCE_ENV]: String(SOCIETY_FENCE_FD) }) };
  return new Promise(resolve => {
    const child = spawnOwnedRpc(run.node, [run.cli, ...run.args], run.cwd, env, false, fence);
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let outBytes = 0, errBytes = 0, stopped = false;
    const stop = () => { stopped = true; child.kill("SIGKILL"); };
    child.on("error", stop);
    const collect = (chunks: Buffer[], output: boolean) => (bytes: Buffer) => {
      if ((output ? outBytes : errBytes) + bytes.length > 1024 * 1024) { stop(); return; }
      chunks.push(bytes); if (output) outBytes += bytes.length; else errBytes += bytes.length;
    };
    child.stdout.on("data", collect(stdout, true)); child.stderr.on("data", collect(stderr, false));
    const timer = run.timeoutMs === undefined ? undefined : setTimeout(stop, run.timeoutMs);
    if (run.signal?.aborted) stop(); else run.signal?.addEventListener("abort", stop, { once: true });
    child.once("close", code => {
      clearTimeout(timer); run.signal?.removeEventListener("abort", stop);
      resolve({ code: code ?? 1, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), finished: code !== null && !stopped });
    });
  });
}
