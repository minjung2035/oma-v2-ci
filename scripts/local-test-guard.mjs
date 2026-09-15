/** Test-process backstop only; not a production sandbox or environment attestation. */
import childProcess from "node:child_process";
import { basename } from "node:path";
import { syncBuiltinESMExports } from "node:module";
for (const method of ["spawn", "spawnSync", "execFile", "execFileSync"]) {
  const original = childProcess[method];
  childProcess[method] = function (command, ...args) {
    if (["systemctl", "systemd-run"].includes(basename(String(command))))
      throw new Error(
        "BLOCKED: local tests cannot invoke a user manager; use the explicit systemd-required lane",
      );
    return original.apply(this, [command, ...args]);
  };
}
syncBuiltinESMExports();
