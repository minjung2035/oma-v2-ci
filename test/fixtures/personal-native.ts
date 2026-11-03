/** Test-owned Personal PTY workload, not a production Personal sandbox.
 * The outer test retains local-test-guard. Actual SDK shell execution belongs
 * inside an owned PID namespace with only fixture state writable, no host bus
 * or host network namespace, and masked manager executables. No tool is replaced.
 */
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ExecutionJournal } from "@oma/storage/execution-journal";
import { ExecutionRuntime } from "#oma-test/app/runtime/execution-runtime";
import { removeTree } from "./cleanup.js";

export async function runPersonalPty(root: string, installation: string, harness: string, specification: string) {
  const state = mkdtempSync(join(tmpdir(), "oma-personal-execution-"));
  ExecutionJournal.initialize(state);
  const execution = new ExecutionRuntime(state);
  try {
    await execution.recover();
    const managers = ["/usr/bin/systemctl", "/usr/bin/systemd-run"].filter(path => existsSync(path));
    const result = await execution.run("preparation", {
      executable: "/usr/bin/bwrap",
      argv: ["--unshare-all",
        "--new-session", "--die-with-parent", "--ro-bind", "/", "/", "--proc", "/proc", "--dev", "/dev",
        "--tmpfs", "/tmp", "--tmpfs", "/var/tmp", "--tmpfs", "/run",
        "--bind", root, root, "--ro-bind", installation, installation,
        ...managers.flatMap(path => ["--ro-bind", "/dev/null", path]),
        // The native workload has an explicit environment, like the existing
        // quarantine/Worker mount plans. JS guard remains on the outer launcher;
        // its host-shell refusal is not a substitute for this physical boundary.
        "--clearenv", "--setenv", "PATH", `${dirname(process.execPath)}:/usr/bin:/bin`,
        "--setenv", "HOME", root, "--setenv", "TERM", "xterm-256color",
        "--", "/usr/bin/python3", harness, specification],
      env: {}, timeoutMs: 55_000, stdoutBytes: 16 * 1024 * 1024, stderrBytes: 1024 * 1024,
    }, undefined, () => {});
    if (!execution.confirmDead("preparation") || ExecutionJournal.inspect(state).length !== 0)
      throw new Error(`Personal PTY scope death remains unknown; preserve ${state}`);
    return result;
  } finally {
    // Unknown cleanup must preserve the original journal, not erase its witness.
    await execution.close();
    removeTree(state);
  }
}
