/** Replace this trusted setup process with the checked command. The existing
 * owned OS scope keeps the same child identity and observes its real result. */
import { accessSync, constants, statSync, type Stats } from "node:fs";
import { delimiter, resolve } from "node:path";
import { StoreError } from "@oma/domain/errors";
import { processErrorCode, snapshotCommand } from "./command.js";
/** A refused execve ends this process instead of throwing, so a candidate
 * already known not to be executable must never be submitted: a same-named
 * directory passes X_OK and would otherwise abort the whole setup, masking
 * the later PATH entry. Selection therefore requires a regular, executable
 * file. The kernel keeps the final decision -- its own executable-format
 * rules (including registered binary handlers), mount flags and any change
 * between this probe and the exec; those are not observations available
 * here. */
const NOT_STARTABLE = new Set(["ENOENT", "ENOTDIR", "ELOOP", "ENAMETOOLONG", "EACCES"]);
function answered(error: unknown): boolean {
  const code = processErrorCode(error);
  return code !== null && NOT_STARTABLE.has(code);
}
/** Whether the candidate is a regular file this process may execute. */
function startable(candidate: string): boolean {
  let stats: Stats;
  try { stats = statSync(candidate); }
  catch (error) { if (answered(error)) return false; throw error; }
  if (!stats.isFile()) return false;
  try { accessSync(candidate, constants.X_OK); }
  catch (error) { if (answered(error)) return false; throw error; }
  return true;
}
export function replaceProcess(command: { executable: string; argv: readonly string[]; cwd: string; env: Readonly<NodeJS.ProcessEnv> }, beforeExec: () => void): never {
  const spec = snapshotCommand({ ...command, timeoutMs: null, stdoutBytes: 0, stderrBytes: 0 });
  if (typeof process.execve !== "function") throw new StoreError("UNSUPPORTED_PROFILE", "this runtime cannot replace a trusted setup process");
  const candidates = spec.executable.includes("/") ? [resolve(command.cwd, spec.executable)] :
    spec.env.PATH?.split(delimiter).map(directory => resolve(command.cwd, directory, spec.executable));
  if (!candidates?.length) throw new StoreError("UNSUPPORTED_PROFILE", "checked command has no explicit executable search path");
  for (const candidate of candidates) {
    if (!startable(candidate)) continue;
    process.chdir(command.cwd);
    beforeExec();
    // execve does not run a shell, finalizers or a second child supervisor.
    // The setup has closed every owned file and awaited each Git command.
    process.execve(candidate, [spec.executable, ...spec.argv], Object.fromEntries(Object.entries(spec.env).filter((entry): entry is [string, string] => entry[1] !== undefined)));
  }
  throw new StoreError("UNSUPPORTED_PROFILE", "checked command executable is unavailable in its sandbox");
}
