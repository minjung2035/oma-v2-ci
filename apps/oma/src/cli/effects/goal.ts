/** DR27/CTX-001: explicit GOAL mail replaces only GOAL.md. Other context
 * documents come from the exact expected revision, never a moving current. */
import { isAbsolute } from "node:path";
import { contextFileCheck, contextPathsCheck } from "@oma/domain/context-policy";
import { runGitText } from "@oma/process/policies";
import { contextBytes as cliContextBytes } from "@oma/client/settings";
import { currentContext } from "@oma/client/context";
import { readLocalFile, sha256Hex } from "../effects.js";
import { fail } from "@oma/client/errors";
import type { PreparedContextEffects } from "./context.js";

export function prepareGoalEffects(file: string, expected: string | null): PreparedContextEffects {
  const maximum = cliContextBytes();
  const files = new Map<string, Buffer>([["GOAL.md", readLocalFile(file)]]);
  let total = files.get("GOAL.md")!.length;
  if (expected !== null) {
    const repo = currentContext().env.OMA_CONTEXT_GIT;
    if (!repo || !isAbsolute(repo)) fail("no canonical context repository was provided", 2);
    const read = (args: string[], maxBuffer: number) => {
      const result = runGitText(["--no-pager", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args],
        { gitDir: repo, maxBuffer });
      if (result.status !== 0) fail("cannot read the expected context revision", 2);
      return result.stdout;
    };
    const list = read(["ls-tree", "-rz", "--name-only", expected], maximum);
    if (!list.endsWith("\0")) fail("expected context manifest is incomplete", 2);
    const paths = list.slice(0, -1).split("\0");
    const invalid = contextPathsCheck(paths); if (invalid) fail(invalid, 2);
    for (const path of paths) {
      if (path === "GOAL.md") continue;
      if (total > maximum) fail("context exceeds its byte limit", 2);
      const data = Buffer.from(read(["show", "--no-ext-diff", "--no-textconv", `${expected}:${path}`], maximum - total));
      total += data.length; files.set(path, data);
    }
  }
  if (total > maximum) fail("context exceeds its byte limit", 2);
  const sorted = [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  for (const [path, data] of sorted) { const invalid = contextFileCheck(path, data); if (invalid) fail(invalid, 2); }
  const content = Buffer.concat(sorted.map(([, data]) => data));
  return { entries: sorted.map(([path, data]) => ({ path, bytes: data.length, sha256: sha256Hex(data) })), content,
    digest: { bytes: content.length, sha256: sha256Hex(content) } };
}
