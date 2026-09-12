// MUST [UNIT-001/RUN-001]: command completion is not observation or death proof.
import { spawnSync } from "node:child_process";
import { runProcess, decodeProcessText } from "../process/run.js";

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

/** Only the fixed administration executables are accepted; never invokes a shell. */
export function executeUnitCommand(
  executable: "systemctl" | "systemd-analyze",
  argv: readonly string[],
): UnitCommandOutcome {
  try {
    const result = spawnSync(executable, [...argv], {
      ...UNIT_COMMAND_LIMITS, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    return Object.freeze({
      kind: result.error || result.status === null || result.signal !== null
        ? "unknown" : result.status === 0 ? "succeeded" : "failed",
      stdout: result.stdout ?? "", stderr: result.stderr ?? "",
      status: result.status, signal: result.signal,
    });
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
