/** Test-process backstop only; not a production sandbox or environment attestation. */
import childProcess from "node:child_process";
import { basename } from "node:path";
import { syncBuiltinESMExports } from "node:module";
for (const method of ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync"]) {
  const original = childProcess[method];
  childProcess[method] = function (command, ...args) {
    const executable = basename(String(command));
    const options = args.find(value => value !== null && typeof value === "object" && !Array.isArray(value));
    // Fixed pre-exec placement only. The owned runner closes this inherited
    // cgroup capability before exec; arbitrary shell scripts remain refused.
    const argv = args[0];
    const placement = method === "spawn" && String(command) === "/bin/bash" && Array.isArray(argv) &&
      argv[0] === "--noprofile" && argv[1] === "--norc" && argv[2] === "-c" && argv[4] === "oma-workload" &&
      /^builtin printf 0 >&([3-9][0-9]*|[12][0-9]+) \|\| builtin exit 125; builtin exec \1>&-; builtin exec \/usr\/bin\/env -i "\$@"$/.test(argv[3] ?? "") &&
      options?.shell === false && Object.keys(options.env ?? {}).length === 0 &&
      Array.isArray(options.stdio) && Number.isInteger(options.stdio[Number(/>&(\d+)/.exec(argv[3])?.[1])]);
    if (method === "exec" || method === "execSync" || options?.shell ||
      (!placement && ["sh", "bash", "dash", "zsh", "fish", "ksh", "csh", "tcsh", "cmd", "cmd.exe", "powershell", "pwsh"].includes(executable)))
      throw new Error("BLOCKED: local tests require direct argv, not shell execution; use direct argv through an owned native execution");
    if (["env", "nice", "timeout", "nohup"].includes(executable) && Array.isArray(args[0]) &&
      args[0].some(value => ["systemctl", "systemd-run", "sh", "bash", "dash", "zsh", "fish", "ksh"].includes(basename(String(value)))))
      throw new Error("BLOCKED: local tests cannot invoke manager or shell commands through launchers");
    if (["systemctl", "systemd-run"].includes(executable))
      throw new Error(
        "BLOCKED: native tests cannot invoke the retired user manager",
      );
    return original.apply(this, [command, ...args]);
  };
}
syncBuiltinESMExports();
