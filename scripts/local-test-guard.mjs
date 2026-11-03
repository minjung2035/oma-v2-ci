/** Test-process backstop only; not a production sandbox or environment attestation. */
import childProcess from "node:child_process";
import { basename } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { readFileSync } from "node:fs";
// Carry the same self-contained backstop as data, not a checkout import. Installed
// runtime tests must still reject every checkout module without making an exception
// for this harness. Descendants retain the guard even with an explicit empty env.
const ownImport = `--import=${import.meta.url}`;
const guardImport = `--import=${import.meta.url.startsWith("data:") ? import.meta.url :
  `data:text/javascript;base64,${Buffer.from(readFileSync(new URL(import.meta.url))).toString("base64")}`}`;
function guardedEnvironment(env, addImport = true) {
  if (!addImport && env.NODE_OPTIONS === undefined) return { ...env };
  const options = (env.NODE_OPTIONS ?? "").replaceAll(ownImport, guardImport);
  return { ...env, NODE_OPTIONS: !addImport || options.includes(guardImport) ? options : `${options} ${guardImport}`.trim() };
}
// The programmatic test runner can inherit both the file import and its
// portable data copy. One process needs one patch: wrapping twice would add
// NODE_OPTIONS before the inner fixed-placement check requires an empty env.
const installed = Symbol.for("oma.local-test-guard.installed");
if (globalThis[installed] !== true) {
  Object.defineProperty(globalThis, installed, { value: true });
  for (const method of ["fork", "spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync"]) {
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
      // Preserve explicit Node child environment policy: carry the same portable
      // backstop in argv (execArgv for fork), not a forged NODE_OPTIONS channel.
      // Non-Node launchers still need env propagation for eventual Node descendants.
      const directNode = String(command) === process.execPath;
      const guarded = { ...(options ?? {}), env: guardedEnvironment(options?.env ?? process.env, !directNode && method !== "fork") };
      if (method === "fork") {
        const flags = options?.execArgv ?? process.execArgv;
        guarded.execArgv = flags.includes(guardImport) ? flags : [guardImport, ...flags];
      } else if (directNode && !(guarded.env.NODE_OPTIONS ?? "").includes(guardImport)) {
        if (Array.isArray(args[0])) args[0] = [guardImport, ...args[0]];
        else args.unshift([guardImport]);
      }
      const at = args.findIndex(value => value !== null && typeof value === "object" && !Array.isArray(value));
      if (at >= 0) args[at] = guarded;
      else args.splice(Array.isArray(args[0]) ? 1 : 0, 0, guarded);
      return original.apply(this, [command, ...args]);
    };
  }
  syncBuiltinESMExports();
}
