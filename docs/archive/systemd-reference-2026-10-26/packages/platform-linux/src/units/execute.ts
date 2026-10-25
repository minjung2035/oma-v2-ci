// MUST [UNIT-001/RUN-001]: command completion is not observation or death proof.
import { runProcess, runProcessSync, decodeProcessText } from "@oma/process/run";

export type UnitCommandOutcome = Readonly<{
  kind: "succeeded" | "failed" | "unknown";
  stdout: string;
  stderr: string;
  status: number | null;
  signal: NodeJS.Signals | null;
}>;
export const UNIT_COMMAND_LIMITS = Object.freeze({
  timeout: 30_000,
  maxBuffer: 1024 * 1024,
  killSignal: "SIGKILL" as const,
});
function unknown(): UnitCommandOutcome {
  return Object.freeze({ kind: "unknown", stdout: "", stderr: "", status: null, signal: null });
}
/** Only the fixed administration executables are accepted; never invokes a shell.
 * Native spawning is owned by process/run.ts, not independently by this adapter.
 */
export function executeUnitCommand(executable: "systemctl" | "systemd-analyze", argv: readonly string[]): UnitCommandOutcome {
  try {
    const result = runProcessSync({ executable, argv, env: { ...process.env },
      timeoutMs: UNIT_COMMAND_LIMITS.timeout,
      stdoutBytes: UNIT_COMMAND_LIMITS.maxBuffer, stderrBytes: UNIT_COMMAND_LIMITS.maxBuffer });
    if (result.kind !== "exited") return unknown();
    return Object.freeze({ kind: result.exitCode === 0 ? "succeeded" : "failed",
      stdout: decodeProcessText(result.stdout), stderr: decodeProcessText(result.stderr),
      status: result.exitCode, signal: result.signal });
  } catch { return unknown(); }
}
/** Read-only show command. This API cannot start/stop/enable a unit. The caller
 * must recheck current durable identity before acting on a completed observation.
 * It never certifies descendant death or replaces confirmDead's Store binding.
 */
export async function observeUnitCommand(argv: readonly string[]): Promise<UnitCommandOutcome> {
  if (argv[0] !== "--user" || argv[1] !== "show") return unknown();
  try {
    const result = await runProcess({ executable: "/usr/bin/systemctl", argv,
      env: { ...process.env }, timeoutMs: UNIT_COMMAND_LIMITS.timeout,
      stdoutBytes: UNIT_COMMAND_LIMITS.maxBuffer, stderrBytes: UNIT_COMMAND_LIMITS.maxBuffer },
      { processGroup: true });
    if (result.kind !== "exited") return unknown();
    return Object.freeze({ kind: result.exitCode === 0 ? "succeeded" : "failed",
      stdout: decodeProcessText(result.stdout), stderr: decodeProcessText(result.stderr),
      status: result.exitCode, signal: result.signal });
  } catch { return unknown(); }
}
