import { constants, closeSync, fstatSync, mkdtempSync, openSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PublicMethods } from "@oma/contracts";
import { StoreError } from "@oma/domain/errors";
import { exportRefForRequestKey } from "@oma/domain/derived";
import { runGitText } from "@oma/process/policies";
import { fail } from "@oma/client/errors";
import { currentContext } from "@oma/client/context";
import { readBounded } from "../effects.js";
import { bundleBytes as cliBundleBytes } from "@oma/client/settings";

function git(cwd: string, args: string[]): string {
  const result = runGitText(args, { cwd });
  if (result.status !== 0) fail(`git ${args[0] ?? "?"}: ${result.stderr.slice(0, 200)}`, 2);
  return result.stdout.trim();
}

/** GIT-004: only an observed local ancestor advertised by the broker is usable. */
function submitPrerequisites(cwd: string, candidate: string, known: readonly string[]): string[] {
  for (const oid of new Set(known)) {
    if (oid === candidate || oid.length !== candidate.length) continue;
    const local = runGitText(["rev-parse", "--verify", "--quiet", `${oid}^{commit}`], { cwd });
    if (local.status === 1) continue;
    if (local.status !== 0 || local.stdout.trim() !== oid)
      throw new StoreError("INVALID_OID", "cannot observe advertised prerequisite locally");
    const ancestry = runGitText(["merge-base", "--is-ancestor", oid, candidate], { cwd });
    if (ancestry.status === 0) return [oid];
    if (ancestry.status !== 1)
      throw new StoreError("REF_STATE_UNKNOWN", "cannot observe candidate ancestry");
  }
  return [];
}

/** The random 0700 directory owns the Git output; no key-derived shared path.
 * Throw rather than process.exit inside this scope so every settled error cleans up. */
function submitBundle(cwd: string, exportRef: string, prerequisites: readonly string[]): Buffer {
  const directory = mkdtempSync(join(tmpdir(), "oma-submit-"));
  try {
    const path = join(directory, "candidate.bundle");
    const result = runGitText(
      ["bundle", "create", path, exportRef, ...prerequisites.map((oid) => `^${oid}`)],
      { cwd },
    );
    if (result.status !== 0)
      throw new StoreError("INVALID_REQUEST", `git bundle: ${result.stderr.slice(0, 200)}`);
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1)
        throw new StoreError("INVALID_REQUEST", "bundle output is not an owned regular file");
      // P0V-78: the bundle is the submission's stream, read only up to its bound.
      const bundleBytes = cliBundleBytes();
      return readBounded(fd, bundleBytes, true, refusal => {
        throw refusal === "size"
          ? new StoreError("LIMIT_EXCEEDED", `bundle is larger than a request can carry (${bundleBytes} bytes)`)
          : new StoreError("INVALID_REQUEST", refusal === "grew" ? "bundle output grew while it was read"
            : refusal === "changed" ? "bundle output changed while it was read" : "bundle output is not an owned regular file");
      });
    } finally {
      closeSync(fd);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export interface SubmitEffects {
  exportRef: string;
  prerequisites: string[];
  content?: Buffer;
}

/** Local Git preparation only. Broker transport stays in the command orchestrator. */
export function prepareSubmitEffects(
  candidate: string,
  key: string,
  known: PublicMethods["git.known"]["result"],
): SubmitEffects {
  const cwd = currentContext().cwd;
  const exportRef = exportRefForRequestKey(key);
  const prerequisites = known.hasCandidate
    ? []
    : submitPrerequisites(cwd, candidate, known.prerequisites);
  git(cwd, ["update-ref", exportRef, candidate]);
  if (known.hasCandidate) return { exportRef, prerequisites };
  return { exportRef, prerequisites, content: submitBundle(cwd, exportRef, prerequisites) };
}
