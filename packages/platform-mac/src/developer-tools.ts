/** Observed Apple developer tools, never an ambient PATH search or an
 * authority/exact-executable binding. The selected bundle is read-only; no
 * grant covers /Applications, /Library, a human home or an entire prefix. */
import { closeSync, realpathSync } from "node:fs";
import { StoreError } from "@oma/domain/errors";
import { trustedAbsolutePath } from "@oma/protocol/run-lease";
import { decodeProcessText } from "@oma/process/run";
import type { CommandSpec, ProcessObservation } from "@oma/process/command";
import { GIT_ENV } from "@oma/process/policies";
import { openDirectory } from "@oma/native/files";
import { describeMacDeveloperTools, macGitLocation, type MacDeveloperTools } from "@oma/protocol/mac-developer-tools";
function refuse(): never { throw new StoreError("UNSUPPORTED_PROFILE", "Mac developer tools could not be observed unambiguously"); }
function path(value: unknown): value is string {
  return trustedAbsolutePath(value) && !/[\r\n]/.test(value as string) && !(value as string).endsWith("/") &&
    Buffer.from(value as string).toString("utf8") === value;
}
/** Exact executable directories in the selected tool installation. Framework
 * mapping remains separate from process execution. */
export function developerToolDirectories(tools: MacDeveloperTools): readonly string[] {
  const selected = describeMacDeveloperTools(tools.developer, tools.git, tools.execPath);
  if (selected.contents !== tools.contents) refuse();
  return [selected.developer + "/usr/bin", selected.developer + "/Toolchains/XcodeDefault.xctoolchain/usr/bin"];
}
/** The caller owns this disposable HOME/TMPDIR for the entire observation.
 * Failure never substitutes /usr/bin/git or an unchecked lexical realpath.
 * Compare warren c1a6aa32: its exact Xcode Contents grant fixes the shim's
 * SharedFrameworks reads; OMA also limits execution to Git/its helper dir. */
export async function observeMacDeveloperTools(temporary: string,
  execute: (command: CommandSpec) => Promise<ProcessObservation>): Promise<MacDeveloperTools> {
  if (process.platform !== "darwin" || !path(temporary)) refuse();
  // The caller's OMA-owned temporary is resolved with the contained directory
  // primitive. Raw realpath is reserved for the external toolchain outputs;
  // neither observation claims to bind the later pathname-based exec/cwd.
  closeSync(openDirectory(temporary));
  const observe = async (executable: string, argv: readonly string[]): Promise<string> => {
    // The same execution owner that retains this staging runs every tool
    // observation. A timed-out/unknown reader cannot outlive scope retirement
    // and race collection of its HOME/TMPDIR. There is no unowned fallback.
    const result = await execute({ executable, argv, cwd: temporary,
      env: { ...GIT_ENV, HOME: temporary, TMPDIR: temporary }, timeoutMs: 10000, stdoutBytes: 8192, stderrBytes: 8192 });
    if (result.kind !== "exited" || result.exitCode !== 0 || result.stdoutTruncated || result.stderrTruncated) refuse();
    const output = decodeProcessText(result.stdout);
    if (!output.endsWith("\n") || !path(output.slice(0, -1))) refuse();
    const selected = output.slice(0, -1), canonical = realpathSync(selected);
    if (!path(canonical)) refuse();
    return canonical;
  };
  const developer = await observe("/usr/bin/xcode-select", ["-p"]);
  const git = await observe("/usr/bin/xcrun", ["--find", "git"]);
  macGitLocation(developer, git); // Validate the observed location before executing it.
  return describeMacDeveloperTools(developer, git, await observe(git, ["--exec-path"]));
}
