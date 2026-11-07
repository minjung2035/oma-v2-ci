/** The git a caller's own preparation runs (submit, merge, code views, goal
 * context). /usr/bin/git on macOS is the xcrun shim: it selects
 * DEVELOPER_DIR/usr/bin/git when DEVELOPER_DIR is set and otherwise asks
 * xcode-select, but GIT_ENV clears DEVELOPER_DIR and a Seatbelt Worker can
 * neither read the xcode-select state nor execute the shim's tools beyond its
 * broker-observed developer git. That Worker's launch fixes DEVELOPER_DIR and
 * GIT_EXEC_PATH to those tools, so a caller carrying both runs the same git
 * the shim would select, directly, after the same closed developer-tools
 * grammar the Broker applied. Every other caller keeps /usr/bin/git. */
import { describeMacDeveloperTools } from "@oma/protocol/mac-developer-tools";
import { runGitText, type GitTextOptions, type TextExit } from "@oma/process/policies";
import { currentContext } from "@oma/client/context";

export interface CallerGit { readonly executable: string; readonly env: Readonly<Record<string, string>> }
export function callerGit(env: Readonly<NodeJS.ProcessEnv> = currentContext().env): CallerGit {
  const developer = env.DEVELOPER_DIR, execPath = env.GIT_EXEC_PATH;
  if (process.platform !== "darwin" || developer === undefined || execPath === undefined) return { executable: "/usr/bin/git", env: {} };
  const tools = describeMacDeveloperTools(developer, `${developer}/usr/bin/git`, execPath);
  return { executable: tools.git, env: { DEVELOPER_DIR: tools.developer, GIT_EXEC_PATH: tools.execPath } };
}
export function runCallerGit(argv: readonly string[], options: GitTextOptions = {}): TextExit {
  const git = callerGit();
  return runGitText(argv, { ...options, executable: git.executable, env: { ...git.env, ...options.env } });
}
