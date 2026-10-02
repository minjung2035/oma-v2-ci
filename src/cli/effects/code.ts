/** DR27/PR-004: a code view is an observation, never a shell or checkout.
 * Only canonical main/published history can be named. Paths and patterns are
 * data; no caller-selected Git option, program, filter or configuration runs. */
import { isAbsolute } from "node:path";
import { isValidFullOid, isValidWirePath } from "../../domain/identifiers.js";
import { StoreError } from "../../domain/errors.js";
import { GitObserver, observed } from "../../git/observe.js";
import { CANONICAL_SAFE_ARGS } from "../../git/canonical-command.js";
import { GIT_ENV, runGitText } from "../../process/policies.js";
import { runProcessSync } from "../../process/run.js";

const SAFE = CANONICAL_SAFE_ARGS;
const MAXIMUM = 768 * 1024;
export interface CodeView {
  readonly action: "show" | "diff" | "log" | "ls-tree" | "grep" | "merge-diff";
  readonly revision: string;
  readonly base?: string;
  readonly path?: string;
  readonly pattern?: string;
}
export function readCode(repository: string, input: CodeView): { revision: string; base?: string; text: string } {
  if (!isAbsolute(repository)) throw new StoreError("INVALID_REQUEST", "code repository must be absolute");
  if (!["show", "diff", "log", "ls-tree", "grep", "merge-diff"].includes(input.action))
    throw new StoreError("INVALID_REQUEST", "unsupported code view");
  if (input.path !== undefined && (!isValidWirePath(input.path) || input.path.split("/").some(part => part.toLowerCase() === ".git")))
    throw new StoreError("INVALID_REQUEST", "code path must be repository-relative");
  if ((input.action === "grep") !== (input.pattern !== undefined) ||
      (input.pattern !== undefined && (input.pattern.length === 0 || input.pattern.includes("\0"))))
    throw new StoreError("INVALID_REQUEST", "a grep view requires a nonempty text pattern");
  if ((input.action === "diff" || input.action === "merge-diff") !== (input.base !== undefined))
    throw new StoreError("INVALID_REQUEST", "only a diff view requires a base revision");
  if (input.action === "show" && input.path === undefined)
    throw new StoreError("INVALID_REQUEST", "a show view requires a file path");
  const observer = new GitObserver(args => {
    const result = runProcessSync({ executable: "/usr/bin/git", argv: [...SAFE, ...args], env: GIT_ENV,
      timeoutMs: 30_000, stdoutBytes: MAXIMUM, stderrBytes: 8192 });
    return { status: result.kind === "exited" ? result.exitCode : null, signal: null, stdout: result.stdout, stderr: result.stderr };
  });
  // Freeze main once: output names the actual commit, not a moving alias.
  const main = observed(observer.ref(repository, "refs/heads/main"), "code main");
  let tips: readonly string[] | undefined;
  const revision = (name: string): string => {
    if (name === "main") return main;
    if (!isValidFullOid(name) || name.length !== main.length)
      throw new StoreError("INVALID_OID", "code revision must be main or a full published commit id");
    if (name === main) return name;
    tips ??= observed(observer.published(repository), "code published refs");
    // Published history is readable too; private/unreachable submitted objects
    // are not made public merely because someone guessed their object id.
    for (const tip of [main, ...tips])
      if (name === tip || observed(observer.ancestry(repository, name, tip), "code history")) return name;
    throw new StoreError("INVALID_REQUEST", "code revision is not in published history");
  };
  const target = revision(input.revision);
  const base = input.base === undefined ? undefined : revision(input.base);
  const path = input.path === undefined ? [] : [input.path];
  let args: string[];
  switch (input.action) {
    case "show": args = ["show", "--no-ext-diff", "--no-textconv", `${target}:${input.path}`]; break;
    case "diff": args = ["diff", "--no-ext-diff", "--no-textconv", "--no-color", base!, target, "--", ...path]; break;
    // mail-v1 `merge diff`: the byte-exact patch a reviewer applies elsewhere.
    case "merge-diff": args = ["diff", "--binary", "--full-index", "--no-ext-diff", "--no-textconv", "--no-color",
      base!, target, "--", ...path]; break;
    case "log": args = ["log", "--no-show-signature", "--no-color", "--format=%H %s", "-n", "100", target, "--", ...path]; break;
    case "ls-tree": args = ["ls-tree", "-r", "--long", target, "--", ...path]; break;
    case "grep": args = ["grep", "--no-textconv", "--no-ext-grep", "-I", "-n", "-F", "-e", input.pattern!, target, "--", ...path]; break;
  }
  const result = runGitText([...SAFE, ...args], { gitDir: repository, maxBuffer: MAXIMUM, env: { GIT_LITERAL_PATHSPECS: "1" } });
  if (result.status !== 0 && !(input.action === "grep" && result.status === 1 && result.stderr === ""))
    throw new StoreError("INVALID_REQUEST", `code view could not be read: ${result.stderr.trim().slice(0, 200)}`);
  return { revision: target, ...(base === undefined ? {} : { base }), text: result.stdout };
}
