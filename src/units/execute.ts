// MUST [UNIT-001/RUN-001]: command completion is not observation or death proof.
import { spawnSync } from "node:child_process";

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
  } catch {
    return Object.freeze({ kind: "unknown", stdout: "", stderr: "", status: null, signal: null });
  }
}
