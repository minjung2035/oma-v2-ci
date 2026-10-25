/** The trusted runner keeps the host path view. Its untrusted engine still
 * uses the separate confined Worker mount plan and seccomp policy. */
import type { CommandSpec } from "@oma/process/command";
export function runnerScope(command: CommandSpec): CommandSpec {
  return { ...command, executable: "/usr/bin/bwrap", argv: [
    "--unshare-user", "--unshare-pid", "--new-session", "--die-with-parent",
    "--bind", "/", "/", "--proc", "/proc", "--dev-bind", "/dev", "/dev",
    "--", command.executable, ...command.argv,
  ] };
}
