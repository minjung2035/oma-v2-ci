/** Replace this trusted setup process with the checked command. The existing
 * owned OS scope keeps the same child identity and observes its real result. */
import { accessSync, constants } from "node:fs";
import { delimiter, resolve } from "node:path";
import { StoreError } from "@oma/domain/errors";
import { snapshotCommand } from "./command.js";
export function replaceProcess(command: { executable: string; argv: readonly string[]; cwd: string; env: Readonly<NodeJS.ProcessEnv> }, beforeExec: () => void): never {
  const spec = snapshotCommand({ ...command, timeoutMs: null, stdoutBytes: 0, stderrBytes: 0 });
  if (typeof process.execve !== "function") throw new StoreError("UNSUPPORTED_PROFILE", "this runtime cannot replace a trusted setup process");
  const candidates = spec.executable.includes("/") ? [resolve(command.cwd, spec.executable)] :
    spec.env.PATH?.split(delimiter).map(directory => resolve(command.cwd, directory, spec.executable));
  if (!candidates?.length) throw new StoreError("UNSUPPORTED_PROFILE", "checked command has no explicit executable search path");
  let inaccessible: unknown;
  for (const candidate of candidates) {
    try { accessSync(candidate, constants.X_OK); }
    catch (error) {
      if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) continue;
      if ((error as NodeJS.ErrnoException).code === "EACCES") { inaccessible ??= error; continue; }
      throw error;
    }
    process.chdir(command.cwd);
    beforeExec();
    // execve does not run a shell, finalizers or a second child supervisor.
    // The setup has closed every owned file and awaited each Git command.
    process.execve(candidate, [spec.executable, ...spec.argv], Object.fromEntries(Object.entries(spec.env).filter((entry): entry is [string, string] => entry[1] !== undefined)));
  }
  throw inaccessible ?? new StoreError("UNSUPPORTED_PROFILE", "checked command executable is unavailable in its sandbox");
}
